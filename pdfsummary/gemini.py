"""Gemini(구글)로 AI 설명 — Claude 대신 Gemini로 시험하거나 쓸 때.

- 키: 환경 변수 GEMINI_API_KEY (또는 GOOGLE_API_KEY), 없으면 ~/.pdfsummary/gemini_key.txt 파일의 첫 줄.
  키는 로그·답 어디에도 남기지 않는다.
- 모델: PDFSUMMARY_GEMINI_MODEL (기본 gemini-3.6-flash — 2026-11 안정판. 3.8-flash는 시험한 키에서 503·시간 초과).
- 생각 수준: PDFSUMMARY_GEMINI_THINKING (기본 low). Gemini 3은 기본으로 오래 생각해서 한 번에 1~2분이 걸렸다
  (low면 몇 초). 빈 값이면 생각 설정을 보내지 않는다.
- 서버가 어느 AI를 쓸지: PDFSUMMARY_AI_BACKEND=gemini 이면 Gemini. 정하지 않으면 Claude 키가 있으면 Claude,
  없고 Gemini 키만 있으면 Gemini (app.py의 ai_reader).
- 표준 라이브러리(urllib)만 쓴다. AIReader.ask_content와 같은 모양으로 불러 explain.py가 그대로 쓴다.
- JSON 모양(스키마)과 생각 수준을 함께 보내되, Gemini가 받지 않으면(400) 생각 설정을 빼고, 그래도 안 되면
  스키마 칸도 빼고 글로 모양을 알려 주어 JSON으로만 받는다.
  답의 모양은 explain.clean_answer가 다시 확인한다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Optional

DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_OUTPUT = 32768


def gemini_key() -> str:
    key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if key:
        return key
    try:
        lines = (Path.home() / ".pdfsummary" / "gemini_key.txt").read_text(encoding="utf-8").split()
    except OSError:
        return ""
    return lines[0].strip() if lines else ""


class GeminiReader:
    backend = "gemini"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None,
                 opener: Optional[Callable] = None, timeout: float = 180):
        self.api_key = (api_key if api_key is not None else gemini_key()).strip()
        self.model = (model or os.environ.get("PDFSUMMARY_GEMINI_MODEL") or DEFAULT_GEMINI_MODEL).strip()
        self.timeout = timeout
        self.thinking = os.environ.get("PDFSUMMARY_GEMINI_THINKING", "low").strip()
        self._open = opener or urllib.request.urlopen
        self.disabled_reason: Optional[str] = None if self.api_key else "서버에 Gemini API 키가 없어요."
        self.last_error: Optional[str] = None   # 잠깐의 문제 (한도 초과 등) — 다시 해 볼 수 있음
        self.calls = 0

    @property
    def available(self) -> bool:
        return bool(self.api_key) and self.disabled_reason is None

    def _post(self, body: dict) -> dict:
        req = urllib.request.Request(
            ENDPOINT.format(model=self.model),
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            method="POST",
        )
        with self._open(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def ask_content(self, content: list[dict], schema: dict, max_tokens: int, effort: str = "medium",
                    stream: bool = False) -> Optional[dict]:
        """글 블록들을 보내고 JSON(스키마 모양) 답을 받는다. 실패하면 None (까닭은 disabled_reason·last_error)."""
        if not self.available:
            return None
        self.last_error = None
        text = "\n\n".join(b.get("text", "") for b in content if b.get("type") == "text")
        config = {"responseMimeType": "application/json", "maxOutputTokens": min(max_tokens, MAX_OUTPUT)}
        hint = "\n\n답은 아래 JSON 스키마 모양의 JSON 하나로만 쓴다:\n" + json.dumps(schema, ensure_ascii=False)
        tries = []   # 받지 않는 칸(400)이 있으면 다음 것으로: 생각 설정 → 스키마 칸 차례로 뺀다
        if self.thinking:
            tries.append((text, {**config, "responseJsonSchema": schema, "thinkingConfig": {"thinkingLevel": self.thinking}}))
        tries.append((text, {**config, "responseJsonSchema": schema}))
        tries.append((text + hint, config))
        try:
            for i, (prompt, cfg) in enumerate(tries):
                try:
                    data = self._post({"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": cfg})
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 400 or i == len(tries) - 1:
                        raise
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                self.disabled_reason = "Gemini API 키가 맞지 않거나 권한이 없어요. 키를 확인해 주세요."
            elif e.code == 404:
                self.disabled_reason = f"Gemini 모델 {self.model!r}을(를) 찾을 수 없어요 (PDFSUMMARY_GEMINI_MODEL 확인)."
            elif e.code == 429:
                self.last_error = "Gemini 요청 한도를 넘었어요. 잠시 뒤 다시 해 주세요."
            else:
                self.last_error = f"Gemini 오류 ({e.code}). 잠시 뒤 다시 해 주세요."
            return None
        except (urllib.error.URLError, TimeoutError, OSError):
            self.last_error = "Gemini에 연결하지 못했어요 (서버의 인터넷 연결 확인)."
            return None
        except json.JSONDecodeError:
            self.last_error = "Gemini의 답을 읽지 못했어요."
            return None

        self.calls += 1
        cands = data.get("candidates") or []
        if not cands:
            block = (data.get("promptFeedback") or {}).get("blockReason")
            self.last_error = f"Gemini가 답하지 않았어요 ({block or '까닭 모름'})."
            return None
        cand = cands[0]
        reason = cand.get("finishReason", "STOP")
        if reason == "MAX_TOKENS":
            self.last_error = "Gemini의 답이 너무 길어 잘렸어요. 항목을 줄여 다시 해 주세요."
            return None
        if reason not in ("STOP", "FINISH_REASON_UNSPECIFIED"):
            self.last_error = f"Gemini가 답을 멈췄어요 ({reason})."
            return None
        out = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts") or [] if not p.get("thought"))
        out = out.strip()
        if out.startswith("```"):   # 코드 블록으로 감싼 JSON
            out = out.strip("`").removeprefix("json").strip()
        try:
            res = json.loads(out)
        except json.JSONDecodeError:
            self.last_error = "Gemini의 답이 JSON 모양이 아니에요."
            return None
        return res if isinstance(res, dict) else None
