"""내 컴퓨터 AI: Ollama(https://ollama.com)로 돌리는 모델에 요약을 맡긴다. API 키·비용 없음.

    ollama pull gemma3:12b          # 예: 그림(쪽 이미지)도 읽는 모델
    pdfsummary 책.pdf --ai ollama --model gemma3:12b

Claude 쪽(AIReader)과 같은 함수를 그대로 쓰도록 만들었다. 다른 점:
- 요청은 Ollama REST API(/api/chat)로, 답은 JSON 스키마로 묶는다(format).
- 그림을 못 읽는 모델이면 쪽 이미지는 빼고 글자층·글자 인식(OCR) 결과만 보낸다.
- 내 컴퓨터는 느리므로 한 번에 하나씩, 묶음도 작게.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .ai import AIReader, _warn

DEFAULT_HOST = "http://127.0.0.1:11434"
NUM_CTX = int(os.environ.get("PDFSUMMARY_OLLAMA_CTX", "16384"))          # 기본 2~4천은 쪽 몇 장에 모자라다
MAX_PREDICT = int(os.environ.get("PDFSUMMARY_OLLAMA_MAX_TOKENS", "8192"))
TIMEOUT = int(os.environ.get("PDFSUMMARY_OLLAMA_TIMEOUT", "1200"))         # 큰 모델은 한 요청에 몇 분
MODEL_NAME = re.compile(r"^[A-Za-z0-9._:/@-]{1,120}$")

INSTALL_HINT = "https://ollama.com 에서 Ollama를 설치하고 실행한 뒤, 예) ollama pull gemma3:12b"


def host_url(host: Optional[str] = None) -> str:
    h = (host or os.environ.get("OLLAMA_HOST") or DEFAULT_HOST).strip().rstrip("/")
    if not h.startswith(("http://", "https://")):
        h = "http://" + h
    if re.match(r"^https?://[^/:]+$", h):   # 포트가 없으면 기본 포트
        h += ":11434"
    return h


def _call(host: str, path: str, body: Optional[dict] = None, timeout: float = 10) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(host + path, data=data, method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    # 내 컴퓨터 주소로 가는 요청은 회사·학교 프록시를 거치지 않게
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def list_models(host: Optional[str] = None) -> list[dict]:
    """설치된 모델 목록: [{name, vision, size_gb}]. Ollama가 꺼져 있으면 예외."""
    h = host_url(host)
    tags = _call(h, "/api/tags", timeout=5)
    out = []
    for m in tags.get("models", []):
        name = m.get("model") or m.get("name")
        if not name:
            continue
        try:
            caps = _call(h, "/api/show", {"model": name}, timeout=10).get("capabilities") or []
        except Exception:
            caps = []
        if "embedding" in caps and "completion" not in caps:
            continue   # 글 쓰기용이 아닌 모델
        out.append({"name": name, "vision": "vision" in caps, "size_gb": round((m.get("size") or 0) / 1e9, 1)})
    out.sort(key=lambda x: (not x["vision"], x["name"]))
    return out


# 작은 모델은 형식을 강제하면 같은 항목을 끝없이 되풀이하다 길이 제한에 걸리곤 한다 (실제 Ollama 시험에서 확인).
# Ollama는 답을 스키마대로 '생성 중에' 묶으므로, 목록 개수·글 길이에 상한을 걸어 두면 되풀이가 멈춘다.
ARRAY_LIMITS = {"units": 3, "sections": 4, "blocks": 6, "items": 6, "columns": 4, "rows": 6,
                "points": 6, "pages": 6, "unclear_parts": 5}
SHORT_FIELDS = {"title", "heading", "chapter", "topic", "evidence", "kind", "confidence", "type"}


def bounded_schema(schema: dict, key: str = "") -> dict:
    """스키마를 복사하면서 배열에 maxItems, 문자열에 maxLength를 붙인다 (내 컴퓨터 AI 전용)."""
    out = dict(schema)
    t = schema.get("type")
    if t == "object":
        out["properties"] = {k: bounded_schema(v, k) for k, v in schema.get("properties", {}).items()}
    elif t == "array":
        out["items"] = bounded_schema(schema.get("items", {}), key)
        out.setdefault("maxItems", ARRAY_LIMITS.get(key, 6))
    elif t == "string" and "enum" not in schema:
        out.setdefault("maxLength", 80 if key in SHORT_FIELDS else 400)
    return out


def _same_model(a: str, b: str) -> bool:
    def norm(x: str) -> str:
        return x[:-7] if x.endswith(":latest") else x

    return norm(a) == norm(b)


def to_messages(content: list[dict], vision: bool) -> list[dict]:
    """Claude 형식 블록(글·그림) → Ollama 메시지들. 그림은 바로 앞 글(예: '[책 3쪽]')과 같은 메시지에 붙인다."""
    msgs: list[dict] = []
    buf: list[str] = []
    for b in content:
        if b.get("type") == "text":
            buf.append(b["text"])
        elif b.get("type") == "image":
            if not vision:
                continue   # 그림을 못 읽는 모델: 글자층·글자 인식 결과만
            msgs.append({"role": "user", "content": "\n".join(buf) or "(그림)", "images": [b["source"]["data"]]})
            buf = []
    if buf:
        msgs.append({"role": "user", "content": "\n".join(buf)})
    return msgs


class OllamaReader(AIReader):
    backend = "ollama"

    def __init__(self, model: Optional[str] = None, cache_path: Optional[Path] = None, host: Optional[str] = None):
        # AIReader의 캐시·진행 함수는 그대로 쓰고, Claude 클라이언트는 만들지 않는다
        self.workers = 1
        self.cache_path = cache_path
        self._cache = {}
        import threading

        self._lock = threading.Lock()
        self.disabled_reason = None
        self.calls = 0
        self.client = None
        self.host = host_url(host)
        self.vision = False
        self.model = model or ""
        if cache_path and cache_path.exists():
            try:
                self._cache = json.loads(cache_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self._cache = {}
        try:
            models = list_models(self.host)
        except Exception:
            self.disabled_reason = f"내 컴퓨터 AI(Ollama)가 켜져 있지 않습니다 ({self.host}). {INSTALL_HINT}"
            return
        if not models:
            self.disabled_reason = f"Ollama에 설치된 모델이 없습니다. {INSTALL_HINT}"
            return
        if not self.model:
            self.model = models[0]["name"]   # 그림을 읽는 모델을 먼저
        if not MODEL_NAME.match(self.model):
            self.disabled_reason = f"모델 이름이 올바르지 않습니다: {self.model!r}"
            return
        found = next((m for m in models if _same_model(m["name"], self.model)), None)
        if found is None:
            names = ", ".join(m["name"] for m in models[:8])
            self.disabled_reason = f"모델 {self.model!r}이(가) 없습니다 (ollama pull {self.model}). 설치된 모델: {names}"
            return
        self.model = found["name"]
        self.vision = found["vision"]

    @property
    def available(self) -> bool:
        return self.disabled_reason is None

    def ask_content(self, content: list[dict], schema: dict, max_tokens: int, effort: str = "medium",
                    stream: bool = False) -> Optional[dict]:
        import hashlib

        key = hashlib.sha256(json.dumps(["ollama", self.model, self.vision, schema, content],
                                        ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        with self._lock:
            if key in self._cache:
                return self._cache[key]
            if not self.available:
                return None
        body = {
            "model": self.model,
            "messages": to_messages(content, self.vision),
            "stream": False,
            "format": bounded_schema(schema),    # 답을 이 JSON 모양으로 묶는다 (개수·길이 상한 포함)
            "options": {"num_ctx": NUM_CTX, "num_predict": min(max_tokens, MAX_PREDICT), "temperature": 0.2},
            "keep_alive": "10m",
        }
        try:
            res = _call(self.host, "/api/chat", body, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200]
            if e.code == 404:
                self._disable(f"Ollama에 모델 {self.model!r}이(가) 없습니다: {detail}")
            else:
                _warn(f"내 컴퓨터 AI 오류 {e.code}: {detail}")
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            self._disable(f"내 컴퓨터 AI(Ollama)와 연결이 끊겼거나 너무 오래 걸립니다: {e}")
            return None
        self.calls += 1
        if res.get("done_reason") == "length":
            _warn("내 컴퓨터 AI의 답이 길이 제한에 걸려 잘렸습니다 (PDFSUMMARY_OLLAMA_MAX_TOKENS로 늘릴 수 있음).")
            return None
        text = ((res.get("message") or {}).get("content") or "").strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            _warn("내 컴퓨터 AI가 형식에 맞지 않는 답을 했습니다. 이 부분은 건너뜁니다.")
            return None
        if not isinstance(data, dict):
            return None
        with self._lock:
            self._cache[key] = data
        return data
