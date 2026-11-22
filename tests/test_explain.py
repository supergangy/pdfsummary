"""나만의 노트의 AI 설명 (프리미엄): 요금제·횟수, Claude 답 다듬기, 서버 주소."""

import json
from types import SimpleNamespace

import pytest

import pdfsummary.app as app
from pdfsummary.accounts import AccountError, AccountStore
from pdfsummary.ai import AIReader
from pdfsummary.explain import EXPLAIN_SCHEMA, ExplainError, clean_answer, clean_request, explain_items
from pdfsummary.sync import SyncStore

from test_server import call, server  # noqa: F401

ITEMS = [
    {"id": "a", "tag": "핵심", "text": "스택을 이용하여 구현할 수 있는 것이 아닌 것은", "sentence": "2. 스택을 이용하여 구현할 수 있는 것이 아닌 것은?", "memo": ""},
    {"id": "b", "tag": "핵심", "text": "가상현실", "sentence": "② 가상현실", "memo": "왜 답?"},
]

ANSWER = {
    "items": [
        {"id": "a", "explain": "스택은 나중에 넣은 것을 먼저 꺼내는 구조예요.", "visual": "table", "title": "스택과 큐",
         "columns": ["구조", "꺼내는 순서", "쓰임새"], "rows": [["스택", "나중 것 먼저", "괄호 매칭"], ["큐", "먼저 것 먼저", "은행 대기열", "넘치는 칸"]],
         "labels": [], "values": [], "unit": "", "steps": []},
        {"id": "b", "explain": "", "visual": "none", "title": "", "columns": [], "rows": [], "labels": [], "values": [], "unit": "", "steps": []},
        {"id": "모르는", "explain": "버려야 함", "visual": "none", "title": "", "columns": [], "rows": [], "labels": [], "values": [], "unit": "", "steps": []},
    ]
}


class FakeMessages:
    """ask_content(stream=True)가 쓰는 messages.stream(...)을 흉내 낸다"""

    def __init__(self, reply=None, fail=False):
        self.reply = reply
        self.fail = fail
        self.calls = []

    def stream(self, **kw):
        self.calls.append(kw)
        msg = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(self.reply, ensure_ascii=False))])
        outer = self

        class Ctx:
            def __enter__(self):
                if outer.fail:
                    raise RuntimeError("boom")
                return SimpleNamespace(get_final_message=lambda: msg)

            def __exit__(self, *a):
                return False

        return Ctx()


def fake_reader(reply=None, fail=False):
    r = AIReader(workers=1)
    fake = FakeMessages(reply, fail)
    r.client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    r.disabled_reason = None
    return r, fake


def test_request_is_checked():
    with pytest.raises(ExplainError):
        clean_request([])
    with pytest.raises(ExplainError):
        clean_request([{"text": "id 없음"}])
    with pytest.raises(ExplainError):
        clean_request([{"id": str(i), "text": "x"} for i in range(61)])
    got = clean_request([{"id": "a", "text": "  여러   칸\n띄어쓰기 ", "memo": "m" * 1000}, {"id": "b", "text": ""}])
    assert got == [{"id": "a", "tag": "", "text": "여러 칸 띄어쓰기", "sentence": "", "memo": "m" * 300}]


def test_explain_asks_claude_and_tidies_the_answer():
    r, fake = fake_reader(ANSWER)
    out = explain_items("컴퓨터일반", ITEMS, reader=r)
    req = fake.calls[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["output_config"]["format"] == {"type": "json_schema", "schema": EXPLAIN_SCHEMA}
    assert req["fallbacks"] == "default"   # 드문 거절은 서버가 다른 모델로
    prompt = req["messages"][0]["content"][0]["text"]
    assert "컴퓨터일반" in prompt and "가상현실" in prompt and "왜 답?" in prompt
    # 설명도 그림도 없는 b, 모르는 id는 빠지고, 넘치는 칸은 잘린다
    assert [e["id"] for e in out] == ["a"]
    t = out[0]["table"]
    assert t["columns"] == ["구조", "꺼내는 순서", "쓰임새"]
    assert t["rows"][1] == ["큐", "먼저 것 먼저", "은행 대기열"]


def test_answer_shapes_are_checked():
    ids = {"c", "d", "e", "f"}
    base = {"explain": "", "title": "t", "columns": [], "rows": [], "labels": [], "values": [], "unit": "", "steps": []}
    raw = {"items": [
        {**base, "id": "c", "visual": "chart", "labels": ["2020", "2021", "2022"], "values": [3, 5], "unit": "%"},   # 개수가 달라 2개만
        {**base, "id": "d", "visual": "chart", "labels": ["a", "b"], "values": [-1, 2]},                          # 음수 → 버림
        {**base, "id": "e", "visual": "steps", "steps": ["입력", "", "처리", "출력"]},
        {**base, "id": "f", "visual": "table", "columns": ["하나"], "rows": [["x"]], "explain": "설명만 남음"},     # 열 하나 → 표 버림
    ]}
    out = {e["id"]: e for e in clean_answer(raw, ids)}
    assert out["c"]["chart"] == {"title": "t", "labels": ["2020", "2021"], "values": [3.0, 5.0], "unit": "%"}
    assert "d" not in out
    assert out["e"]["steps"]["items"] == ["입력", "처리", "출력"]
    assert out["f"] == {"id": "f", "explain": "설명만 남음"}


def test_plans_and_monthly_limit(tmp_path, monkeypatch):
    s = SyncStore(tmp_path / "sync")
    acc = AccountStore(s)
    try:
        tok = acc.signup("me@example.com", "password1")["token"]
        assert acc.ai_status(tok) == {"plan": "free", "label": "무료", "used": 0, "limit": 3}
        assert acc.me(tok)["ai"]["plan"] == "free"
        for _ in range(3):
            account = acc.use_ai(tok)
        with pytest.raises(AccountError) as e:
            acc.use_ai(tok)
        assert e.value.status == 429 and "프리미엄" in str(e.value)
        acc.refund_ai(account)
        assert acc.ai_status(tok)["used"] == 2
        acc.set_plan("ME@example.com", "premium")
        assert acc.ai_status(tok) == {"plan": "premium", "label": "프리미엄", "used": 2, "limit": 100}
        with pytest.raises(AccountError):
            acc.set_plan("me@example.com", "gold")
        with pytest.raises(AccountError):
            acc.set_plan("nobody@example.com", "premium")
        # 무료는 못 쓰게 하는 서버 (PDFSUMMARY_AI_LIMITS)
        monkeypatch.setenv("PDFSUMMARY_AI_LIMITS", "free=0,premium=5")
        acc.set_plan("me@example.com", "free")
        with pytest.raises(AccountError) as e:
            acc.use_ai(tok)
        assert e.value.status == 402
        with pytest.raises(AccountError) as e:
            acc.use_ai("없는 토큰")
        assert e.value.status == 401
    finally:
        s.close()


def test_explain_endpoint(server, monkeypatch):  # noqa: F811
    s, b, _ = call(server, "/api/account/signup", data={"email": "me@example.com", "password": "password1"})
    assert s == 200
    H = {"X-Session": json.loads(b)["token"]}
    body = {"book": "컴퓨터일반", "items": ITEMS}
    # 로그인 없이는 안 됨
    assert call(server, "/api/ai/explain", data=body)[0] == 401
    # 틀린 요청은 횟수를 쓰지 않는다
    assert call(server, "/api/ai/explain", data={"items": []}, headers=H)[0] == 400
    assert json.loads(call(server, "/api/account/ai", headers=H)[1])["used"] == 0

    r, fake = fake_reader(ANSWER)
    monkeypatch.setattr(app, "ai_reader", lambda: r)
    s, b, _ = call(server, "/api/ai/explain", data=body, headers=H)
    assert s == 200
    j = json.loads(b)
    assert [e["id"] for e in j["items"]] == ["a"] and j["ai"]["used"] == 1

    # AI가 실패하면 횟수를 돌려놓는다
    r2, _ = fake_reader(fail=True)
    monkeypatch.setattr(app, "ai_reader", lambda: r2)
    s, b, _ = call(server, "/api/ai/explain", data=body, headers=H)
    assert s == 500
    assert json.loads(call(server, "/api/account/ai", headers=H)[1])["used"] == 1

    # 키가 없는 서버
    r3, _ = fake_reader(ANSWER)
    r3.client = None
    monkeypatch.setattr(app, "ai_reader", lambda: r3)
    s, b, _ = call(server, "/api/ai/explain", data=body, headers=H)
    assert s == 503 and "AI" in json.loads(b)["error"]
    assert json.loads(call(server, "/api/account/ai", headers=H)[1])["used"] == 1
