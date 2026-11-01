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
from typing import TYPE_CHECKING, Callable, Optional

import anthropic

from .models import HANDWRITING, Mark

if TYPE_CHECKING:
    from .outline import Node

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


SECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "integer"}, "context": {"type": "string"}},
                "required": ["id", "context"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["overview", "items"],
    "additionalProperties": False,
}

OVERVIEW_SCHEMA = {
    "type": "object",
    "properties": {"overview": {"type": "string"}},
    "required": ["overview"],
    "additionalProperties": False,
}

SECTION_PROMPT = """학생이 책을 공부하면서 형광펜·밑줄로 표시하고 메모한 부분만 모아 요약 노트를 만들고 있습니다.
표시한 문장만 따로 떼어 놓으면 문맥이 끊겨 무슨 말인지 알기 어렵기 때문에, 아래 단원 본문을 근거로
(1) 단원 개요와 (2) 표시한 부분마다 짧은 연결 설명을 써 주세요.

책: {book}
목차 위치: {path}

<단원_본문{abridged}>
{text}
</단원_본문>

<학생이_표시한_부분>
{marks}
</학생이_표시한_부분>

작성 방법
- overview: 이 단원이 무엇을 다루는지, 표시한 내용들이 그 흐름에서 어떤 위치에 있는지 2~4문장.
- items: 표시마다 id와 context. context는 그 표시를 이해하는 데 필요한 앞뒤 설명이나 앞 표시와의 연결을 1~2문장으로.
  예: 무엇에 대한 이야기인지, 앞에서 무엇을 설명한 뒤 나온 내용인지, 바로 앞 표시와 어떤 관계인지.
  표시한 문장만으로 충분히 이해되면 빈 문자열로 두세요.
- 표시한 문장을 그대로 다시 쓰거나 바꿔 쓰지 마세요. 노트에는 표시한 원문이 따로 들어갑니다.
- 단원 본문과 학생 메모에 근거한 내용만 쓰고, 본문에 없는 사실을 지어내지 마세요.
- 한국어로, 시험 공부 노트처럼 간결하게 쓰세요."""

PARENT_PROMPT = """학생의 공부 요약 노트에서 상위 단원의 개요를 쓰려고 합니다.
아래는 이 단원 아래 하위 단원들의 제목과 개요, 그리고 이 단원에서 직접 표시한 부분입니다.
이것들을 묶어 이 단원 전체가 무엇을 다루고 하위 단원들이 어떻게 이어지는지 2~4문장으로 쓰세요.
주어진 내용에 근거해서만 쓰고 한국어로 간결하게 쓰세요.

책: {book}
단원: {path}

{children}"""


def _mark_line(m: "Mark") -> str:
    from .models import KIND_LABELS

    body = m.body or "(글자 없음)"
    line = f"[{m.uid}] ({KIND_LABELS.get(m.kind, m.kind)}, {m.page_no}쪽) {body}"
    for n in m.notes:
        if n.body:
            line += f"\n    └ 학생 메모: {n.body}"
    return line


def section_prompt(book: str, node: "Node", text: str, abridged: bool) -> str:
    path = " > ".join(node.marks[0].heading_path) if node.marks and node.marks[0].heading_path else (node.title or "(제목 없음)")
    return SECTION_PROMPT.format(
        book=book,
        path=path,
        abridged=' 일부="표시가 있는 쪽만 남기고 줄임"' if abridged else "",
        text=text or "(본문 글자를 읽지 못함)",
        marks="\n".join(_mark_line(m) for m in node.marks),
    )


def parent_prompt(book: str, node: "Node") -> str:
    parts = []
    for c in node.children:
        parts.append(f"## {c.title}\n{c.overview or '(개요 없음)'}")
    if node.marks:
        parts.append("## 이 단원에서 직접 표시한 부분\n" + "\n".join(_mark_line(m) for m in node.marks))
    return PARENT_PROMPT.format(book=book, path=node.title or "(책 전체)", children="\n\n".join(parts))


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

    def explain_sections(
        self,
        book_title: str,
        sections: list[tuple["Node", str, bool]],
        parents: list["Node"],
        progress: Callable[[int, int], None] | None = None,
    ) -> None:
        """단원마다 개요와, 표시한 부분마다 앞뒤 연결 설명을 붙인다.

        sections: (단원, 단원 본문, 본문을 줄였는지) — 표시가 직접 달린 단원들
        parents : 하위 단원이 여러 개인 상위 단원들 (하위 단원 개요를 묶어 개요를 만든다)
        """
        if not self.available:
            return

        def work(item):
            node, text, abridged = item
            prompt = section_prompt(book_title, node, text, abridged)
            res = self._ask(None, prompt, SECTION_SCHEMA, max_tokens=8000)
            if res is None:
                return
            node.overview = res.get("overview", "").strip()
            by_id = {it["id"]: it.get("context", "").strip() for it in res.get("items", [])}
            for m in node.marks:
                m.ai_context = by_id.get(m.uid, "")

        self._run(sections, work, progress)
        # 상위 단원은 하위 단원 개요가 다 나온 뒤에, 깊은 것부터
        for node in sorted(parents, key=lambda n: -n.level):
            prompt = parent_prompt(book_title, node)
            res = self._ask(None, prompt, OVERVIEW_SCHEMA, max_tokens=4000)
            if res is not None:
                node.overview = res.get("overview", "").strip()
        self.save_cache()

    def save_cache(self) -> None:
        if not self.cache_path:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self._cache, ensure_ascii=False, indent=1), encoding="utf-8")

    # ── 내부 ─────────────────────────────────────────────────────────
    def _run(self, todo: list, work, progress) -> None:
        if not todo or not self.available:
            return
        done = 0
        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            for _ in ex.map(work, todo):
                done += 1
                if progress:
                    progress(done, len(todo))
        self.save_cache()

    def _ask(self, png: Optional[bytes], prompt: str, schema: dict, max_tokens: int) -> Optional[dict]:
        key = hashlib.sha256(self.model.encode() + b"\0" + prompt.encode() + b"\0" + (png or b"")).hexdigest()
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
                messages=[{"role": "user", "content": _content(png, prompt)}],
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


def _content(png: Optional[bytes], prompt: str) -> list[dict]:
    blocks: list[dict] = []
    if png:
        blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.standard_b64encode(png).decode("ascii"),
                },
            }
        )
    blocks.append({"type": "text", "text": prompt})
    return blocks


def has_credentials() -> bool:
    """API 키/토큰이 환경에 있는지 빠르게 확인 (없어도 `ant auth login` 프로필이 있을 수 있음)."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


_warn_sink = None


def set_warn(fn) -> None:
    """경고를 받을 곳 (명령줄은 표준 오류, 실행 화면은 진행 기록)."""
    global _warn_sink
    _warn_sink = fn


def _warn(msg: str) -> None:
    if _warn_sink is not None:
        _warn_sink(f"  ! {msg}")
    else:
        print(f"  ! {msg}", file=sys.stderr)
