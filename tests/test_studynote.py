"""AI 정리 노트: 쪽 확인·묶기, 답 다듬기, 여러 묶음 이어 붙이기, 서버 주소."""

import json
import pytest

import pdfsummary.app as app
import pdfsummary.studynote as sn
from pdfsummary.explain import ExplainError
from pdfsummary.studynote import STUDY_SCHEMA, chunks, clean_doc, clean_pages, study_note

from test_server import call, server  # noqa: F401

PAGES = [
    {"page": 1, "text": "1과목 시스템\n/etc/shadow 파일은 암호화된 패스워드를 저장한다. $1$=MD5, $5$=SHA-256, $6$=SHA-512",
     "marks": [{"id": "m1", "tag": "핵심", "text": "$6$=SHA-512", "sentence": "$1$=MD5, $5$=SHA-256, $6$=SHA-512", "memo": "암기"}]},
    {"page": 2, "text": "SUID 파일 탐지: find / -perm -4000", "marks": []},
]

SECTION = {
    "title": "1과목 시스템, S01. 시스템 기본학습 핵심 정리",
    "intro": "리눅스 인증 파일과 권한이 반복 출제된다.",
    "blocks": [
        {"type": "heading", "level": 1, "text": "1. 개념 및 배경", "items": [], "columns": [], "rows": [], "q": "", "a": "", "mark_ids": []},
        {"type": "paragraph", "level": 0, "text": "운영체제의 인증·계정·권한을 이해한다.", "items": [], "columns": [], "rows": [], "q": "", "a": "", "mark_ids": []},
        {"type": "table", "level": 0, "text": "shadow 해시", "items": [], "columns": ["표기", "알고리즘"],
         "rows": [["$1$", "MD5"], ["$6$", "SHA-512", "넘치는 칸"]], "q": "", "a": "", "mark_ids": ["m1", "없는-id"]},
        {"type": "code", "level": 0, "text": "find / -perm -4000\n" + "x" * 300 + "\n\n", "items": [], "columns": [], "rows": [], "q": "", "a": "", "mark_ids": []},
        {"type": "qa", "level": 0, "text": "", "items": [], "columns": [], "rows": [], "q": "$6$은?", "a": "SHA-512", "mark_ids": ["m1"]},
        {"type": "table", "level": 0, "text": "", "items": [], "columns": ["하나"], "rows": [["x"]], "q": "", "a": "", "mark_ids": []},   # 열 하나 → 버림
        {"type": "모르는", "level": 0, "text": "x", "items": [], "columns": [], "rows": [], "q": "", "a": "", "mark_ids": []},
    ],
    "points": [{"topic": "shadow 해시", "key": "$1$ MD5, $5$ SHA-256, $6$ SHA-512", "stars": 5},
               {"topic": "SUID", "key": "find -perm -4000", "stars": 0}],
    "strategy": "숫자는 정확히 쓴다.",
}


class FakeReader:
    """ask_content를 흉내 내어 묶음마다 다른 섹션을 돌려준다 (받은 글은 prompts에)"""

    def __init__(self, fail=False):
        self.available = True
        self.disabled_reason = None
        self.last_error = None
        self.fail = fail
        self.prompts = []

    def ask_content(self, content, schema, max_tokens, effort="medium", stream=False):
        assert schema is STUDY_SCHEMA
        text = content[0]["text"]
        self.prompts.append(text)
        if self.fail:
            self.last_error = "Gemini 오류 (503). 잠시 뒤 다시 해 주세요."
            return None
        pages = json.loads(text.split("memo(학생 메모)):\n", 1)[1])
        return {"sections": [{**SECTION, "title": f"쪽 {pages[0]['page']}부터"}]}


def test_pages_are_checked_and_chunked(monkeypatch):
    with pytest.raises(ExplainError):
        clean_pages([])
    with pytest.raises(ExplainError):
        clean_pages([{"page": i, "text": "x"} for i in range(81)])
    with pytest.raises(ExplainError):
        clean_pages([{"page": 1, "text": "  ", "marks": []}])
    got = clean_pages(PAGES + [{"page": 3, "text": "", "marks": [{"id": "", "text": "id 없음"}]}])
    assert [p["page"] for p in got] == [1, 2]   # 글도 표시도 없는 쪽은 뺀다
    monkeypatch.setattr(sn, "CHUNK_PAGES", 1)
    assert [[p["page"] for p in g] for g in chunks(got)] == [[1], [2]]


def test_answer_is_tidied():
    [s] = clean_doc({"sections": [SECTION]}, {"m1"})
    types = [b["type"] for b in s["blocks"]]
    assert types == ["heading", "paragraph", "table", "code", "qa"]
    table = s["blocks"][2]
    assert table["rows"][1] == ["$6$", "SHA-512"] and table["mark_ids"] == ["m1"] and table["text"] == "shadow 해시"
    code = s["blocks"][3]["text"].split("\n")
    assert len(code) == 2 and len(code[1]) == 110   # 긴 줄은 자르고 끝의 빈 줄은 뺀다
    assert [p["stars"] for p in s["points"]] == [3, 1]


def test_study_note_merges_chunks_in_order(monkeypatch):
    monkeypatch.setattr(sn, "CHUNK_PAGES", 1)
    r = FakeReader()
    sections = study_note("정보보안기사 실기", PAGES, r)
    assert [s["title"] for s in sections] == ["쪽 1부터", "쪽 2부터"]
    assert any("$6$=SHA-512" in p and "암기" in p and "정보보안기사 실기" in p for p in r.prompts)
    with pytest.raises(ExplainError, match="503"):
        study_note("책", PAGES, FakeReader(fail=True))
    off = FakeReader()
    off.available, off.disabled_reason = False, "서버에 Gemini API 키가 없어요."
    with pytest.raises(ExplainError, match="키가 없어요"):
        study_note("책", PAGES, off)


def test_studynote_endpoint(server, monkeypatch):  # noqa: F811
    s, b, _ = call(server, "/api/account/signup", data={"email": "study@example.com", "password": "password1"})
    H = {"X-Session": json.loads(b)["token"]}
    body = {"book": "교재", "pages": PAGES}
    assert call(server, "/api/ai/studynote", data=body)[0] == 401
    assert call(server, "/api/ai/studynote", data={"pages": []}, headers=H)[0] == 400
    monkeypatch.setattr(app, "ai_reader", lambda: FakeReader())
    s, b, _ = call(server, "/api/ai/studynote", data=body, headers=H)
    assert s == 200
    j = json.loads(b)
    assert j["sections"][0]["blocks"][0] == {"type": "heading", "mark_ids": [], "text": "1. 개념 및 배경", "level": 1}
    assert j["ai"]["used"] == 1
    monkeypatch.setattr(app, "ai_reader", lambda: FakeReader(fail=True))
    assert call(server, "/api/ai/studynote", data=body, headers=H)[0] == 503
    assert json.loads(call(server, "/api/account/ai", headers=H)[1])["used"] == 1   # 실패하면 돌려놓는다
