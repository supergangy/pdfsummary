"""AI 설명을 Gemini로: 요청 모양, 스키마 칸을 못 받을 때 다시 묻기, 오류 글, 키 파일, 서버가 어느 AI를 고르는지."""

import io
import json
import urllib.error

import pdfsummary.app as app
from pdfsummary.explain import EXPLAIN_SCHEMA, explain_items
from pdfsummary.gemini import DEFAULT_GEMINI_MODEL, GeminiReader, gemini_key

from test_explain import ANSWER, ITEMS


class FakeOpen:
    """urllib.request.urlopen 흉내: 차례대로 답(dict) 또는 HTTP 오류 번호를 돌려준다"""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.reqs = []

    def __call__(self, req, timeout=None):
        self.reqs.append(req)
        r = self.replies.pop(0)
        if isinstance(r, int):
            raise urllib.error.HTTPError(req.full_url, r, "err", {}, io.BytesIO(b"{}"))
        return io.BytesIO(json.dumps(r, ensure_ascii=False).encode("utf-8"))


def reply(obj, finish="STOP"):
    return {"candidates": [{"finishReason": finish, "content": {"parts": [
        {"text": "생각 중…", "thought": True}, {"text": json.dumps(obj, ensure_ascii=False)}]}}]}


def body(req):
    return json.loads(req.data.decode("utf-8"))


def test_gemini_answers_and_request_shape():
    fake = FakeOpen(reply(ANSWER))
    r = GeminiReader(api_key="g-key", opener=fake)
    out = explain_items("컴퓨터일반", ITEMS, reader=r)
    assert [e["id"] for e in out] == ["a"] and out[0]["table"]["columns"][0] == "구조"
    req = fake.reqs[0]
    assert req.full_url.endswith(f"/models/{DEFAULT_GEMINI_MODEL}:generateContent")
    assert req.get_header("X-goog-api-key") == "g-key"
    assert "g-key" not in req.full_url   # 키는 주소에 넣지 않는다
    b = body(req)
    assert b["generationConfig"]["responseMimeType"] == "application/json"
    assert b["generationConfig"]["responseJsonSchema"] == EXPLAIN_SCHEMA
    assert "가상현실" in b["contents"][0]["parts"][0]["text"]


def test_schema_field_rejected_then_json_mode():
    fake = FakeOpen(400, reply(ANSWER))
    r = GeminiReader(api_key="g", opener=fake)
    out = explain_items("책", ITEMS, reader=r)
    assert out[0]["id"] == "a"
    second = body(fake.reqs[1])
    assert "responseJsonSchema" not in second["generationConfig"]
    assert "JSON 스키마" in second["contents"][0]["parts"][0]["text"]


def test_errors_are_readable():
    import pytest
    from pdfsummary.explain import ExplainError

    for code, word in ((401, "키"), (404, "모델"), (429, "한도"), (500, "오류")):
        r = GeminiReader(api_key="g", opener=FakeOpen(code))
        with pytest.raises(ExplainError, match=word):
            explain_items("책", ITEMS, reader=r)
    r = GeminiReader(api_key="g", opener=FakeOpen(reply(ANSWER, finish="MAX_TOKENS")))
    with pytest.raises(ExplainError, match="잘렸어요"):
        explain_items("책", ITEMS, reader=r)
    r = GeminiReader(api_key="g", opener=FakeOpen({"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(ExplainError, match="SAFETY"):
        explain_items("책", ITEMS, reader=r)
    r = GeminiReader(api_key="")
    assert not r.available
    with pytest.raises(ExplainError, match="Gemini API 키가 없어요"):
        explain_items("책", ITEMS, reader=r)


def test_key_from_env_or_file_and_backend_choice(tmp_path, monkeypatch):
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "PDFSUMMARY_AI_BACKEND"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    monkeypatch.setattr("pdfsummary.ai.has_credentials", lambda: False)
    assert gemini_key() == ""
    assert not app.explain_available()
    (tmp_path / ".pdfsummary").mkdir()
    (tmp_path / ".pdfsummary" / "gemini_key.txt").write_text("  file-key \n", encoding="utf-8")
    assert gemini_key() == "file-key"
    # Claude 키가 없고 Gemini 키만 있으면 Gemini
    assert app.explain_available()
    assert isinstance(app.ai_reader(), GeminiReader)
    # Claude 키가 있으면 Claude, 단 PDFSUMMARY_AI_BACKEND=gemini 이면 Gemini
    monkeypatch.setattr("pdfsummary.ai.has_credentials", lambda: True)
    assert not isinstance(app.ai_reader(), GeminiReader)
    monkeypatch.setenv("PDFSUMMARY_AI_BACKEND", "gemini")
    assert isinstance(app.ai_reader(), GeminiReader)
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")
    assert gemini_key() == "env-key"
    monkeypatch.setenv("PDFSUMMARY_GEMINI_MODEL", "gemini-test")
    assert GeminiReader().model == "gemini-test"
