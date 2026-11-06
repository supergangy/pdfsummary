"""내 컴퓨터 AI(Ollama) 연결 시험: 진짜 Ollama 대신 같은 모양으로 답하는 가짜 서버를 띄운다."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from pdfsummary.booklet import BOOKLET_SCHEMA
from pdfsummary.cli import main
from pdfsummary.local_ai import OllamaReader, list_models, to_messages

MODELS = {
    "gemma3:4b": (["completion", "vision"], 3.3e9),
    "qwen3:4b": (["completion", "thinking"], 2.5e9),
    "nomic-embed-text:latest": (["embedding"], 0.3e9),
}


def unit_json(title="광합성"):
    return {"units": [{"chapter": "", "title": title, "continues_previous": False, "intro": "개요",
                       "sections": [{"heading": "1. 개념 및 배경", "blocks": [
                           {"type": "paragraph", "text": "**명반응**은 틸라코이드에서", "items": [], "columns": [], "rows": []}]}],
                       "points": [{"topic": "명반응", "memo": "ATP 생성", "stars": 2, "evidence": "학생 표시"}], "pages": [1]}]}


@pytest.fixture()
def ollama():
    state = {"chats": [], "reply": None, "done_reason": "stop"}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj, code=200):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if self.path == "/api/tags":
                return self._json({"models": [{"model": k, "name": k, "size": v[1]} for k, v in MODELS.items()]})
            self._json({"error": "not found"}, 404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/api/show":
                caps = MODELS.get(body["model"], (None,))[0]
                return self._json({"capabilities": caps}) if caps else self._json({"error": "model not found"}, 404)
            if self.path == "/api/chat":
                state["chats"].append(body)
                props = body["format"]["properties"]
                if state["reply"] is not None:
                    reply = state["reply"]
                elif "units" in props:
                    reply = unit_json()
                elif "kind" in props:
                    reply = {"kind": "handwriting", "text": "물의 광분해", "confidence": "high", "unclear_parts": []}
                else:
                    reply = {"overview": "개요", "items": []}
                return self._json({"message": {"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)},
                                   "done": True, "done_reason": state["done_reason"]})
            self._json({"error": "not found"}, 404)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    state["host"] = f"http://127.0.0.1:{srv.server_address[1]}"
    yield state
    srv.shutdown()
    srv.server_close()


def test_list_models(ollama):
    ms = list_models(ollama["host"])
    assert [(m["name"], m["vision"]) for m in ms] == [("gemma3:4b", True), ("qwen3:4b", False)]   # 임베딩 모델은 뺌, 그림 읽는 것 먼저


def test_reader_picks_and_checks_model(ollama):
    r = OllamaReader(host=ollama["host"])
    assert r.available and r.model == "gemma3:4b" and r.vision
    r2 = OllamaReader(model="qwen3:4b", host=ollama["host"])
    assert r2.available and not r2.vision
    missing = OllamaReader(model="llama9:70b", host=ollama["host"])
    assert not missing.available and "ollama pull llama9:70b" in missing.disabled_reason
    off = OllamaReader(host="http://127.0.0.1:9")
    assert not off.available and "켜져 있지 않습니다" in off.disabled_reason


def test_to_messages_keeps_images_with_their_labels():
    content = [{"type": "text", "text": "[책 1쪽]"}, {"type": "image", "source": {"data": "AAA"}},
               {"type": "text", "text": "[책 2쪽]"}, {"type": "image", "source": {"data": "BBB"}},
               {"type": "text", "text": "정리해 주세요"}]
    assert to_messages(content, vision=True) == [
        {"role": "user", "content": "[책 1쪽]", "images": ["AAA"]},
        {"role": "user", "content": "[책 2쪽]", "images": ["BBB"]},
        {"role": "user", "content": "정리해 주세요"},
    ]
    assert to_messages(content, vision=False) == [{"role": "user", "content": "[책 1쪽]\n[책 2쪽]\n정리해 주세요"}]


def test_ask_content_request_and_cache(ollama, tmp_path):
    r = OllamaReader(host=ollama["host"], cache_path=tmp_path / "c.json")
    content = [{"type": "text", "text": "안녕"}]
    assert r.ask_content(content, BOOKLET_SCHEMA, max_tokens=32000)["units"][0]["title"] == "광합성"
    body = ollama["chats"][0]
    assert body["format"] == BOOKLET_SCHEMA and body["stream"] is False
    assert body["options"]["num_ctx"] >= 16384 and body["options"]["num_predict"] <= 8192
    r.ask_content(content, BOOKLET_SCHEMA, max_tokens=32000)
    assert len(ollama["chats"]) == 1   # 같은 요청은 캐시에서


def test_truncated_answer_is_skipped(ollama):
    ollama["done_reason"] = "length"
    r = OllamaReader(host=ollama["host"])
    assert r.ask_content([{"type": "text", "text": "x"}], BOOKLET_SCHEMA, 1000) is None


def test_text_only_model_does_not_get_handwriting_images(ollama):
    from pdfsummary.models import HANDWRITING, Mark

    r = OllamaReader(model="qwen3:4b", host=ollama["host"])
    m = Mark(0, HANDWRITING, (0, 0, 1, 1), "annotation", image=b"png")
    r.transcribe_handwriting([m])
    assert m.transcription is None and ollama["chats"] == []


@pytest.mark.parametrize("model,expect_images", [("gemma3:4b", True), ("qwen3:4b", False)])
def test_cli_booklet_with_ollama(ollama, textbook, tmp_path, model, expect_images):
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--ai", "ollama", "--model", model, "--ollama-host", ollama["host"],
                 "--format", "html"]) == 0
    assert "광합성 핵심 정리" in (out / "요약.html").read_text(encoding="utf-8")
    chats = ollama["chats"]
    assert chats
    has_images = any("images" in msg for c in chats for msg in c["messages"])
    assert has_images == expect_images
    # 글자층은 그림을 못 읽는 모델에게 꼭 들어가야 한다
    text = "\n".join(msg["content"] for c in chats for msg in c["messages"])
    assert "글자층" in text and "명반응" in text
    # 내 컴퓨터 AI는 한 번에 2쪽까지
    for c in chats:
        assert sum(msg["content"].count("[책 ") for msg in c["messages"]) <= 2


def test_cli_ollama_off_falls_back_to_list(textbook, tmp_path):
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--ai", "ollama", "--ollama-host", "http://127.0.0.1:9", "--format", "md"]) == 0
    assert "**목차**" in (out / "요약.md").read_text(encoding="utf-8")


# ── 실제 Ollama (CI의 ollama 작업에서만: PDFSUMMARY_REAL_OLLAMA_MODEL 이 있을 때) ──────────────

def _real_model():
    import os

    return os.environ.get("PDFSUMMARY_REAL_OLLAMA_MODEL")


@pytest.mark.real_ollama
def test_real_ollama_structured_answer():
    model = _real_model()
    if not model:
        pytest.skip("실제 Ollama 시험은 PDFSUMMARY_REAL_OLLAMA_MODEL 이 있을 때만")
    from pdfsummary.ai import HANDWRITING_SCHEMA

    assert any(m["name"].startswith(model.split(":")[0]) for m in list_models())
    r = OllamaReader(model=model)
    assert r.available, r.disabled_reason
    res = r.ask_content([{"type": "text", "text": "다음 메모를 그대로 옮기세요: '물의 광분해'"}], HANDWRITING_SCHEMA, 512)
    print(res)
    assert res is not None and set(res) >= {"kind", "text", "confidence", "unclear_parts"}


@pytest.mark.real_ollama
def test_real_ollama_accepts_booklet_schema(textbook):
    """요약집 스키마(꽤 복잡함)를 Ollama의 구조화된 출력이 받아 주는지. 작은 모델이라 내용 품질은 보지 않는다."""
    model = _real_model()
    if not model:
        pytest.skip("실제 Ollama 시험은 PDFSUMMARY_REAL_OLLAMA_MODEL 이 있을 때만")
    import pymupdf

    from pdfsummary.booklet import Chunk, chunk_content
    from pdfsummary.extract import TextCache

    doc = pymupdf.open(textbook)
    r = OllamaReader(model=model)
    content = chunk_content(doc, Chunk([0]), "all", TextCache(doc).get)
    res = r.ask_content(content, BOOKLET_SCHEMA, max_tokens=4096)
    print(json.dumps(res, ensure_ascii=False)[:1500])
    assert res is not None and isinstance(res.get("units"), list)
    for u in res["units"]:
        assert {"title", "sections", "points"} <= set(u)
