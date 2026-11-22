"""AI 정리 노트 (프리미엄): 학생이 표시한 쪽의 교재 글과 표시(칠한 말·문장·메모)를 받아,
시험 대비 '핵심 정리' 문서를 만든다. 모양은 섹션마다
  제목 · 한두 줄 소개 → 1. 개념 및 배경 → 2. 동작 원리/구조(소제목·표·목록·순서·명령어·핵심 메모)
  → 3. 예시/적용 시나리오(문제와 모범 답안) → 4. 실무 및 시험 포인트(주제·핵심·중요도 표) → 고득점 전략
앱(mobile/src/notes/studyNote.ts)이 이 문서를 노트 쪽에 글상자·표·선으로 그린다.

- 표시한 내용을 중심으로, 교재 글에 근거해서. 확실하지 않은 것은 쓰지 않는다.
- 교재가 길면 쪽을 몇 묶음으로 나눠 따로 묻고 이어 붙인다 (한 번 쓰기로 센다).
- 답은 정해진 JSON 모양(구조화된 출력)으로 받고, 그리기 좋은 크기로 다듬는다.
- 교재 글은 로그에 남기지 않는다.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from .explain import ExplainError

MAX_PAGES = 80
MAX_PAGE_TEXT = 6000         # 쪽 하나에서 보내는 교재 글
CHUNK_CHARS = 14000          # 한 번에 묻는 교재 글 양
CHUNK_PAGES = 8
MAX_MARKS_PER_PAGE = 40

BLOCK_TYPES = ("heading", "paragraph", "bullets", "steps", "table", "code", "callout", "qa")

_STR = {"type": "string"}
_STRS = {"type": "array", "items": _STR}

BLOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(BLOCK_TYPES)},
        "level": {"type": "integer"},
        "text": _STR,
        "items": _STRS,
        "columns": _STRS,
        "rows": {"type": "array", "items": _STRS},
        "q": _STR,
        "a": _STR,
        "mark_ids": _STRS,
    },
    "required": ["type", "level", "text", "items", "columns", "rows", "q", "a", "mark_ids"],
    "additionalProperties": False,
}

STUDY_SCHEMA = {
    "type": "object",
    "properties": {
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": _STR,
                    "intro": _STR,
                    "blocks": {"type": "array", "items": BLOCK_SCHEMA},
                    "points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"topic": _STR, "key": _STR, "stars": {"type": "integer"}},
                            "required": ["topic", "key", "stars"],
                            "additionalProperties": False,
                        },
                    },
                    "strategy": _STR,
                },
                "required": ["title", "intro", "blocks", "points", "strategy"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sections"],
    "additionalProperties": False,
}

PROMPT = """너는 시험 대비 공부 노트를 만들어 주는 선생님이다. 학생이 교재 「{book}」에서 형광펜·밑줄·동그라미로 표시한 부분(marks)과
그 쪽의 교재 글(text)이 아래 JSON에 있다. 학생이 표시한 내용을 중심으로 '핵심 정리 노트'를 만든다.

전체 모양:
- 교재 차례(쪽 순서)를 따른다. 같은 단원·주제로 이어지는 쪽들은 한 섹션으로 묶는다. 섹션은 보통 1~4개.
- 섹션마다:
  · title: 단원·주제 이름 (교재의 장·절 제목이 보이면 그 이름을 쓴다. 예: "1과목 시스템, S01. 시스템 기본학습 핵심 정리")
  · intro: 이 섹션에서 무엇이 중요한지(자주 나오는지) 한두 문장
  · blocks: 아래 차례로
    1) heading(level 1) "1. 개념 및 배경" → paragraph 1~2개 (쉬운 설명)
    2) heading(level 1) "2. 동작 원리 / 구조" → 주제마다 heading(level 2) 소제목 뒤에
       비교·분류는 table, 나열은 bullets, 순서·절차는 steps, 명령어·설정·코드는 code(text에 줄바꿈으로),
       꼭 외울 것·주의할 점은 callout
    3) heading(level 1) "3. 예시 / 적용 시나리오" → 시험에 나올 법한 문제와 모범 답안 qa 1~3개 (q: 문제, a: 답과 까닭)
  · points: '실무 및 시험 포인트 정리' 표의 줄 (topic: 주제, key: 한 줄 핵심 암기, stars: 중요도 1~3) 3~10줄
  · strategy: 서술형·암기 요령 한두 문장 (없으면 "")
- 학생이 표시한 내용과 관련된 블록에는 mark_ids에 그 표시의 id들을 넣는다. 표시한 내용은 빠짐없이 어딘가에 담는다.

규칙:
- 교재 글과 학생 표시에 근거해서 쓴다. 교재에 없는 내용을 보탤 때는 널리 알려진 확실한 사실만. 모르면 쓰지 않는다.
- 숫자·명령어·용어·포트 번호는 교재 그대로 정확히. 시험 문제의 정답이 교재 글에 있으면 그 답을 쓴다.
- 쉬운 한국어, 짧은 문장. 이모지는 쓰지 않는다.
- table: columns 2~5개, rows 10줄 이내, 칸은 짧게. code: 15줄 이내. bullets·steps: 8개 이내.
- 쓰지 않는 칸은 빈 값([] 또는 "", level은 0).

교재 쪽 (page: 교재 쪽 번호, text: 그 쪽 글, marks: id·tag(학생이 정한 색의 뜻)·text(표시한 말)·sentence(그 말이 든 문장)·memo(학생 메모)):
{pages}
"""


def _s(v, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def _lines(v, limit_lines: int, limit_cols: int) -> str:
    rows = [r.rstrip()[:limit_cols] for r in str(v or "").replace("\r", "").split("\n")]
    while rows and not rows[-1]:
        rows.pop()
    return "\n".join(rows[:limit_lines])


def clean_pages(pages) -> list[dict]:
    """앱이 보낸 쪽들을 확인해 다듬는다 (모양이 틀리면 ExplainError)."""
    if not isinstance(pages, list) or not pages:
        raise ExplainError("정리할 쪽이 없어요.")
    if len(pages) > MAX_PAGES:
        raise ExplainError(f"AI 정리 노트는 한 번에 {MAX_PAGES}쪽까지예요. 표시한 쪽을 나눠서 만들어 주세요.")
    out = []
    for p in pages:
        if not isinstance(p, dict):
            raise ExplainError("쪽 모양이 잘못되었어요.")
        marks = []
        for m in (p.get("marks") or [])[:MAX_MARKS_PER_PAGE]:
            if isinstance(m, dict) and str(m.get("id") or "").strip() and _s(m.get("text"), 400):
                marks.append({"id": str(m["id"])[:40], "tag": _s(m.get("tag"), 20), "text": _s(m.get("text"), 400),
                              "sentence": _s(m.get("sentence"), 600), "memo": _s(m.get("memo"), 300)})
        text = _lines(p.get("text"), 400, 400)[:MAX_PAGE_TEXT]
        if not marks and not text.strip():
            continue
        try:
            page = int(p.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        out.append({"page": page, "text": text, "marks": marks})
    if not out:
        raise ExplainError("정리할 글이 있는 쪽이 없어요.")
    return out


def chunks(pages: list[dict]) -> list[list[dict]]:
    """교재 글 양에 맞춰 쪽을 묶는다 (차례 그대로)."""
    out: list[list[dict]] = [[]]
    size = 0
    for p in pages:
        n = len(p["text"]) + sum(len(m["text"]) + len(m["sentence"]) for m in p["marks"])
        if out[-1] and (size + n > CHUNK_CHARS or len(out[-1]) >= CHUNK_PAGES):
            out.append([])
            size = 0
        out[-1].append(p)
        size += n
    return out


def clean_block(b: dict, ids: set[str]) -> dict | None:
    t = b.get("type")
    if t not in BLOCK_TYPES:
        return None
    marks = [m for m in (b.get("mark_ids") or []) if m in ids][:10]
    out: dict = {"type": t, "mark_ids": marks}
    if t == "heading":
        out["text"] = _s(b.get("text"), 80)
        out["level"] = 2 if b.get("level") == 2 else 1
        return out if out["text"] else None
    if t in ("paragraph", "callout"):
        out["text"] = _s(b.get("text"), 700)
        return out if out["text"] else None
    if t in ("bullets", "steps"):
        out["items"] = [x for x in (_s(i, 200) for i in (b.get("items") or [])) if x][:10]
        out["text"] = _s(b.get("text"), 80)   # 목록 제목 (선택)
        return out if out["items"] else None
    if t == "code":
        out["text"] = _lines(b.get("text"), 20, 110)
        return out if out["text"].strip() else None
    if t == "table":
        cols = [_s(c, 40) for c in (b.get("columns") or [])][:5]
        rows = []
        for r in (b.get("rows") or [])[:12]:
            if isinstance(r, list):
                cells = [_s(c, 120) for c in r][: len(cols)]
                rows.append(cells + [""] * (len(cols) - len(cells)))
        out["text"] = _s(b.get("text"), 80)   # 표 제목 (선택)
        out["columns"], out["rows"] = cols, rows
        return out if len(cols) >= 2 and rows else None
    if t == "qa":
        out["q"], out["a"] = _s(b.get("q"), 400), _s(b.get("a"), 900)
        return out if out["q"] and out["a"] else None
    return None


def clean_doc(raw: dict, ids: set[str]) -> list[dict]:
    sections = []
    for s in (raw or {}).get("sections") or []:
        if not isinstance(s, dict):
            continue
        blocks = [x for x in (clean_block(b, ids) for b in (s.get("blocks") or [])[:80] if isinstance(b, dict)) if x]
        points = []
        for p in (s.get("points") or [])[:12]:
            if isinstance(p, dict) and _s(p.get("topic"), 40):
                try:
                    stars = max(1, min(3, int(p.get("stars") or 1)))
                except (TypeError, ValueError):
                    stars = 1
                points.append({"topic": _s(p.get("topic"), 40), "key": _s(p.get("key"), 160), "stars": stars})
        title = _s(s.get("title"), 80)
        if not (blocks or points) or not title:
            continue
        sections.append({"title": title, "intro": _s(s.get("intro"), 300), "blocks": blocks, "points": points,
                         "strategy": _s(s.get("strategy"), 400)})
    return sections


def study_note(book: str, pages, reader) -> list[dict]:
    """쪽들 → 섹션들. 교재가 길면 묶음마다 묻고 차례대로 이어 붙인다. 하나도 못 만들면 ExplainError."""
    req = clean_pages(pages)
    if not reader.available:
        raise ExplainError(reader.disabled_reason or "서버에 AI 설정이 없어요. 서버 관리자에게 알려 주세요.")
    ids = {m["id"] for p in req for m in p["marks"]}

    def ask(group: list[dict]) -> list[dict] | None:
        prompt = PROMPT.format(book=_s(book, 80) or "교재", pages=json.dumps(group, ensure_ascii=False, indent=1))
        raw = reader.ask_content([{"type": "text", "text": prompt}], STUDY_SCHEMA, max_tokens=32000, effort="medium", stream=True)
        return None if raw is None else clean_doc(raw, ids)

    groups = chunks(req)
    with ThreadPoolExecutor(max_workers=min(3, len(groups))) as ex:
        results = list(ex.map(ask, groups))
    sections = [s for r in results if r for s in r]
    if not sections:
        raise ExplainError(reader.disabled_reason or getattr(reader, "last_error", None)
                           or "AI가 정리 노트를 만들지 못했어요. 잠시 뒤 다시 해 주세요.")
    return sections
