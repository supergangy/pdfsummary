"""나만의 노트의 'AI 설명' (프리미엄 기능): 필기 앱이 보낸 항목(칠한 말·그 문장·메모)마다
Claude가 설명이 필요한지 판단해서, 필요하면 쉬운 설명과 그림 하나(표·막대그래프·순서)를 만든다.
앱은 이 답으로 노트에 글상자와 선을 그린다 (mobile/src/notes/myNote.ts).

- 그림은 글보다 훨씬 잘 설명할 때만. 숫자 그래프는 교재에 실제 숫자가 있을 때만 (지어내지 않게).
- 답은 정해진 JSON 모양(구조화된 출력)으로 받고, 앱이 그리기 좋게 크기를 줄여 다듬는다.
- 교재 글은 로그에 남기지 않는다.
"""

from __future__ import annotations

import json
from typing import Optional

from .ai import AIReader

MAX_ITEMS = 60          # 한 번에 설명할 항목 수 (앱이 이보다 많이 보내면 거절 — 앱이 미리 알려 준다)
MAX_TEXT = 400
MAX_SENTENCE = 600
MAX_MEMO = 300
MAX_COLS, MAX_ROWS, MAX_CELL = 4, 8, 40
MAX_BARS, MAX_STEPS, MAX_STEP = 10, 6, 40
MAX_EXPLAIN = 400

VISUALS = ("none", "table", "chart", "steps")

EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "explain": {"type": "string"},
                    "visual": {"type": "string", "enum": list(VISUALS)},
                    "title": {"type": "string"},
                    "columns": {"type": "array", "items": {"type": "string"}},
                    "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
                    "labels": {"type": "array", "items": {"type": "string"}},
                    "values": {"type": "array", "items": {"type": "number"}},
                    "unit": {"type": "string"},
                    "steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "explain", "visual", "title", "columns", "rows", "labels", "values", "unit", "steps"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["items"],
    "additionalProperties": False,
}

PROMPT = """너는 학생의 공부 노트 정리를 돕는다. 학생이 교재 「{book}」에서 형광펜·밑줄·동그라미로 표시한 부분(항목)과
그 둘레에 쓴 메모가 아래 JSON으로 있다. 항목마다 다음을 정해 답한다.

1. 설명이 필요한가: 이 부분을 이해하거나 외우는 데 설명이 실제로 도움이 될 때만 explain에 쉬운 한국어로 1~3문장을 쓴다.
   뻔한 문장, 이미 충분히 풀어 쓴 문장, 문제 지문을 되풀이하는 것뿐이면 explain은 ""로 둔다.
   시험 문제(번호·보기 ①②③④가 있는 문장)면 무엇을 묻는지와 정답을 고르는 핵심을 짚는다. 메모가 질문이면 그 답을 담는다.
2. 그림: 글보다 훨씬 잘 설명할 때만 visual에 하나를 고른다. 아니면 "none".
   - "table": 비교·분류 (예: 스택과 큐의 쓰임새). columns 2~4개, rows 2~6줄, 칸마다 짧게(15자 안팎).
   - "chart": 교재 문장에 실제 숫자 자료가 있을 때만 막대그래프. labels와 values는 같은 개수(2~8개), unit은 단위.
     숫자를 지어내지 않는다.
   - "steps": 순서·과정·흐름 (2~6단계, 단계마다 짧게).
   title은 그림의 짧은 제목. 고르지 않은 그림의 칸은 빈 값([] 또는 "")으로 둔다.
3. 확실하지 않은 사실은 쓰지 않는다. 교재 문장과 다르게 말하지 않는다.
4. id는 받은 그대로 돌려준다. 받은 항목마다 하나씩 답한다.

항목 (tag: 학생이 정한 색의 뜻, text: 표시한 말, sentence: 그 말이 든 교재 문장, memo: 학생 메모):
{items}
"""


class ExplainError(Exception):
    pass


def _s(v, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def clean_request(items) -> list[dict]:
    """앱이 보낸 항목을 확인해 다듬는다 (모양이 틀리면 ExplainError)."""
    if not isinstance(items, list) or not items:
        raise ExplainError("설명할 항목이 없어요.")
    if len(items) > MAX_ITEMS:
        raise ExplainError(f"AI 설명은 한 번에 {MAX_ITEMS}개까지예요. 항목을 조금 빼고 다시 해 주세요.")
    out = []
    for it in items:
        if not isinstance(it, dict) or not str(it.get("id") or "").strip():
            raise ExplainError("항목 모양이 잘못되었어요.")
        text = _s(it.get("text"), MAX_TEXT)
        if not text:
            continue
        out.append({
            "id": str(it["id"])[:40],
            "tag": _s(it.get("tag"), 20),
            "text": text,
            "sentence": _s(it.get("sentence"), MAX_SENTENCE),
            "memo": _s(it.get("memo"), MAX_MEMO),
        })
    if not out:
        raise ExplainError("설명할 글이 있는 항목이 없어요.")
    return out


def clean_answer(raw: dict, ids: set[str]) -> list[dict]:
    """Claude의 답을 앱이 그리기 좋은 크기로 다듬는다. 설명도 그림도 없는 항목은 뺀다."""
    out = []
    for it in raw.get("items") or []:
        if not isinstance(it, dict) or it.get("id") not in ids:
            continue
        e = {"id": it["id"], "explain": _s(it.get("explain"), MAX_EXPLAIN)}
        visual = it.get("visual") if it.get("visual") in VISUALS else "none"
        title = _s(it.get("title"), 40)
        if visual == "table":
            cols = [_s(c, MAX_CELL) for c in (it.get("columns") or [])][:MAX_COLS]
            rows = []
            for r in (it.get("rows") or [])[:MAX_ROWS]:
                if isinstance(r, list):
                    cells = [_s(c, MAX_CELL) for c in r][: len(cols)]
                    rows.append(cells + [""] * (len(cols) - len(cells)))
            if len(cols) >= 2 and rows:
                e["table"] = {"title": title, "columns": cols, "rows": rows}
        elif visual == "chart":
            labels = [_s(x, 20) for x in (it.get("labels") or [])]
            values = []
            for v in it.get("values") or []:
                try:
                    values.append(float(v))
                except (TypeError, ValueError):
                    values.append(0.0)
            n = min(len(labels), len(values), MAX_BARS)
            if n >= 2 and all(v >= 0 for v in values[:n]) and max(values[:n]) > 0:
                e["chart"] = {"title": title, "labels": labels[:n], "values": values[:n], "unit": _s(it.get("unit"), 10)}
        elif visual == "steps":
            steps = [_s(x, MAX_STEP) for x in (it.get("steps") or []) if _s(x, MAX_STEP)][:MAX_STEPS]
            if len(steps) >= 2:
                e["steps"] = {"title": title, "items": steps}
        if e["explain"] or len(e) > 2:
            out.append(e)
    return out


def explain_items(book: str, items, reader: Optional[AIReader] = None) -> list[dict]:
    """항목들 → [{id, explain, table?, chart?, steps?}] (설명이 필요 없는 항목은 빠짐). 실패하면 ExplainError."""
    req = clean_request(items)
    reader = reader or AIReader()
    if not reader.available:
        raise ExplainError("서버에 AI(Claude) 설정이 없어요. 서버 관리자에게 알려 주세요.")
    prompt = PROMPT.format(book=_s(book, 80) or "교재", items=json.dumps(req, ensure_ascii=False, indent=1))
    raw = reader.ask_content([{"type": "text", "text": prompt}], EXPLAIN_SCHEMA, max_tokens=32000, effort="medium", stream=True)
    if raw is None:
        raise ExplainError(reader.disabled_reason or "AI가 답하지 못했어요. 잠시 뒤 다시 해 주세요.")
    return clean_answer(raw, {it["id"] for it in req})
