"""Claude로 손글씨를 읽고, 글자층이 없는 스캔 형광펜 부분을 읽는다.

- 같은 이미지는 다시 묻지 않도록 결과를 캐시 파일(JSON)에 저장한다.
- API 키가 없거나 인증에 실패하면 AI 없이(원본 이미지로) 계속 진행한다.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

import anthropic

from .models import HANDWRITING, Mark

DEFAULT_MODEL = "claude-opus-5-5"
# 서버 쪽 거절 대비(fallbacks="default")를 지원하는 모델
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

HANDWRITING_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {
            "type": "string",
            "enum": ["handwriting", "symbol"],
            "description": "handwriting: 글자·숫자·수식을 쓴 것. symbol: 별표, 체크, 화살표, 물음표 같은 기호나 선만 있는 것.",
        },
        "text": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "unclear_parts": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["kind", "text", "confidence", "unclear_parts"],
    "additionalProperties": False,
}

OCR_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["text", "confidence"],
    "additionalProperties": False,
}

HANDWRITING_PROMPT = """이 이미지는 책 PDF에 사용자가 직접 펜으로 쓴 손글씨 부분을 잘라낸 것입니다.
(배경에 책의 인쇄 글자가 함께 보일 수 있습니다. 인쇄 글자는 무시하고 손으로 쓴 것만 읽으세요.)

손글씨를 쓰인 그대로 옮겨 적으세요.
- 고치거나 다듬지 말고, 줄바꿈은 유지하세요. 수식은 a^2 + b^2 처럼 평문으로 쓰세요.
- 글자가 아니라 별표·체크·화살표·물음표 같은 기호나 선뿐이라면 kind를 "symbol"로 하고,
  text에는 괄호 안에 짧게 설명하세요. 예: "(별표)", "(오른쪽 화살표)", "(물음표)"
- 읽기 애매한 글자는 가장 그럴듯하게 읽되 unclear_parts에 그 부분을 적고 confidence를 낮추세요.
  전부 확실하면 high, 일부 추측이 섞이면 medium, 대부분 추측이면 low 입니다.

참고로 이 손글씨 주변의 책 본문은 다음과 같습니다 (단어를 추측할 때만 참고하세요):
<context>
{context}
</context>"""

OCR_PROMPT = """이 이미지는 스캔한 책 페이지에서 사용자가 형광펜을 칠한 부분을 잘라낸 것입니다.
형광펜 색이 칠해진 인쇄 글자만 쓰인 그대로 옮겨 적으세요. 색이 칠해지지 않은 글자는 빼세요.
줄이 바뀌는 곳은 띄어쓰기 한 칸으로 이으세요. 읽기 어려우면 confidence를 낮추세요."""


class AIReader:
    def __init__(self, model: str = DEFAULT_MODEL, cache_path: Optional[Path] = None, workers: int = 4):
        self.model = model
        self.workers = workers
        self.cache_path = cache_path
        self._cache: dict[str, dict] = {}
        self._lock = threading.Lock()
        self.disabled_reason: Optional[str] = None
        self.calls = 0
        if cache_path and cache_path.exists():
            try:
                self._cache = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self._cache = {}
        try:
            self.client = anthropic.Anthropic()
        except Exception as e:  # 자격 증명을 찾지 못한 경우 등
            self.client = None
            self.disabled_reason = f"Claude 클라이언트를 만들 수 없습니다: {e}"

    @property
    def available(self) -> bool:
        return self.client is not None and self.disabled_reason is None

    # ── 공개 함수 ────────────────────────────────────────────────────
    def transcribe_handwriting(self, marks: list[Mark], progress: Callable[[int, int], None] | None = None) -> None:
        todo = [m for m in marks if m.kind == HANDWRITING and m.image]

        def work(m: Mark):
            prompt = HANDWRITING_PROMPT.format(context=m.context.strip() or "(없음)")
            res = self._ask(m.image, prompt, HANDWRITING_SCHEMA, max_tokens=4000)
            if res is None:
                return
            m.transcription = res["text"].strip()
            m.confidence = res["confidence"]
            m.unclear = [u for u in res.get("unclear_parts", []) if u]
            if res["kind"] == "symbol":
                m.is_symbol = True
                m.unclear = []

        self._run(todo, work, progress)

    def read_highlighted(self, marks: list[Mark], progress: Callable[[int, int], None] | None = None) -> None:
        todo = [m for m in marks if not m.text and m.image]

        def work(m: Mark):
            res = self._ask(m.image, OCR_PROMPT, OCR_SCHEMA, max_tokens=4000)
            if res is None:
                return
            m.text = res["text"].strip()
            m.confidence = res["confidence"]

        self._run(todo, work, progress)

    def save_cache(self) -> None:
        if not self.cache_path:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self._cache, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 내부 ─────────────────────────────────────────────────────────
    def _run(self, todo: list[Mark], work, progress) -> None:
        if not todo or not self.available:
            return
        done = 0
        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            for _ in ex.map(work, todo):
                done += 1
                if progress:
                    progress(done, len(todo))
        self.save_cache()

    def _ask(self, png: bytes, prompt: str, schema: dict, max_tokens: int) -> Optional[dict]:
        key = hashlib.sha256(self.model.encode() + b"\0" + prompt.encode() + b"\0" + png).hexdigest()
        with self._lock:
            if key in self._cache:
                return self._cache[key]
            if not self.available:
                return None
        extra = {}
        if self.model in FALLBACK_MODELS:
            # 안전 분류기가 드물게 거절하면 서버가 알아서 다른 모델로 다시 시도한다
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                **extra,
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": schema},
                },
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": base64.standard_b64encode(png).decode("ascii"),
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            self._disable(f"Claude API 인증 실패 ({e.status_code}). API 키를 확인하세요.")
            return None
        except anthropic.NotFoundError:
            self._disable(f"모델 {self.model!r}을(를) 찾을 수 없습니다. --model 값을 확인하세요.")
            return None
        except anthropic.RateLimitError:
            _warn("요청 한도 초과로 한 부분을 건너뜁니다 (원본 이미지로 남깁니다).")
            return None
        except anthropic.APIStatusError as e:
            _warn(f"Claude API 오류 {e.status_code}: 한 부분을 원본 이미지로 남깁니다.")
            return None
        except anthropic.APIConnectionError:
            self._disable("Claude API에 연결할 수 없습니다 (네트워크 확인).")
            return None
        except TypeError as e:  # 자격 증명 없이 호출한 경우 SDK가 TypeError를 낸다
            self._disable(f"Claude API 자격 증명이 없습니다: {e}")
            return None

        self.calls += 1
        if resp.stop_reason in ("refusal", "max_tokens"):
            return None
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if not text:
            return None
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        with self._lock:
            self._cache[key] = data
        return data

    def _disable(self, reason: str) -> None:
        with self._lock:
            if self.disabled_reason is None:
                self.disabled_reason = reason
                _warn(reason + " 남은 부분은 AI 없이 원본 이미지로 정리합니다.")


def has_credentials() -> bool:
    """API 키/토큰이 환경에 있는지 빠르게 확인 (없어도 `ant auth login` 프로필이 있을 수 있음)."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


def _warn(msg: str) -> None:
    print(f"  ! {msg}", file=sys.stderr)
