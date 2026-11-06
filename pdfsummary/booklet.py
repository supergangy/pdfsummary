"""요약집 만들기: 책 쪽(이미지·글자)과 학생의 표시를 Claude에게 주고, 시험 공부용 '핵심 정리' 책자로 정리한다.

모양은 이런 식이다 (단원마다):

    [1과목 › 섹션 07]  SNMP 핵심 정리
    한두 문장 개요 (**핵심어** 굵게)
    1. 개념 및 배경        - 문단·목록
    2. 동작 원리 / 구조     - 이모지 소제목, 비교 표, 명령어 상자, 📌 꼭 외울 것
    3. 예시 / 적용 시나리오 - 기출형 문제와 모범 답안
    4. 실무 및 시험 포인트 정리 - 주제 | 핵심 암기 내용 | 출제 빈도 ★★★

학생이 형광펜으로 칠한 말은 요약집 안에서도 ==형광펜== 으로 표시하고, 손글씨 메모는 📝 내 메모로 붙인다.
책에 원래 인쇄된 기출 표시(예: '23년.기사', '14/25년.산기')는 출제 빈도 별점의 근거가 된다.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from typing import Callable, Optional

import pymupdf

from .colors import color_name
from .models import HANDWRITING, NOTE, Mark

PAGE_LONG_SIDE = 1568      # Claude가 이미지를 볼 때 쓰는 최대 크기(긴 변, 픽셀)
PAGES_PER_CHUNK = 6
MAX_CROPS_PER_CHUNK = 40

BLOCK_TYPES = ["subheading", "paragraph", "bullets", "numbered", "table", "code", "callout", "memo", "qa"]

BOOKLET_SCHEMA = {
    "type": "object",
    "properties": {
        "units": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chapter": {"type": "string"},
                    "title": {"type": "string"},
                    "continues_previous": {"type": "boolean"},
                    "intro": {"type": "string"},
                    "sections": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "heading": {"type": "string"},
                                "blocks": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "type": {"type": "string", "enum": BLOCK_TYPES},
                                            "text": {"type": "string"},
                                            "items": {"type": "array", "items": {"type": "string"}},
                                            "columns": {"type": "array", "items": {"type": "string"}},
                                            "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
                                        },
                                        "required": ["type", "text", "items", "columns", "rows"],
                                        "additionalProperties": False,
                                    },
                                },
                            },
                            "required": ["heading", "blocks"],
                            "additionalProperties": False,
                        },
                    },
                    "points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "topic": {"type": "string"},
                                "memo": {"type": "string"},
                                "stars": {"type": "integer", "enum": [1, 2, 3]},
                                "evidence": {"type": "string"},
                            },
                            "required": ["topic", "memo", "stars", "evidence"],
                            "additionalProperties": False,
                        },
                    },
                    "pages": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["chapter", "title", "continues_previous", "intro", "sections", "points", "pages"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["units"],
    "additionalProperties": False,
}

PROMPT = """학생이 시험 공부를 하며 책(PDF)에 형광펜·밑줄·손글씨로 표시를 했습니다.
위에 그 책의 쪽 이미지와 학생이 표시한 부분이 있습니다. 이것으로 시험 공부용 **핵심 정리 요약집**을 만들어 주세요.

## 정리 범위
{scope}

## 요약집 모양 (주제 하나 = unit 하나)
- chapter: 쪽 머리말·꼬리말·제목에서 읽은 큰 단원 (예: "Part 03 애플리케이션 › Section 07 애플리케이션 기본 학습"). 모르면 "".
- title: 주제 이름 (예: "SNMP"). 책의 제목 표현을 따르세요.
- intro: 이 주제가 무엇이고 시험에서 무엇이 중요한지 1~2문장. 핵심어는 **굵게**.
- sections: 보통 아래 순서로. 내용이 없는 절은 빼세요.
  1. "1. 개념 및 배경"
  2. "2. 동작 원리 / 구조" — 내용이 많으면 subheading 블록으로 나누고 소제목 앞에 어울리는 이모지 하나 (예: "🔐 SNMP 버전별 특징")
  3. "3. 예시 / 적용 시나리오" — 책에 예시·명령어·설정이 있거나 기출형 서술 문제를 낼 만하면. qa 블록(text=문제, items=모범 답안 줄들)
- points: "실무 및 시험 포인트 정리" 표의 줄. topic(주제), memo(핵심 암기 내용, 짧게), stars(출제 빈도 1~3), evidence(근거).
  - 책에 인쇄된 기출 표시(예: "23년.기사", "14/25년.산기", "18년.기사")가 있으면 그 연도 수로 정하세요: 3번 이상 ★★★, 2번 ★★, 1번 ★. evidence에 그 표시를 그대로.
  - 기출 표시가 없으면 학생이 표시했는지와 내용의 중요도로 정하되 최대 ★★, evidence에 "학생 표시" 또는 "중요 개념".
- pages: 이 주제가 나온 쪽 번호들.

## 블록 종류 (blocks)
- paragraph(text) · bullets(items) · numbered(items) · subheading(text)
- table(columns, rows): 비교·분류·종류별 특징·명령어 표처럼 나란히 놓으면 보기 좋은 것은 꼭 표로.
- code(text): 명령어·설정·포트·경로처럼 그대로 외울 것.
- callout(text): "📌 꼭 외울 것" 같은 강조 한 줄.
- memo(text): 학생의 손글씨·메모를 관련 내용 옆에 그대로 옮김 (고치지 말 것).
- qa(text=문제, items=모범 답안 줄들).
- 쓰지 않는 칸은 빈 문자열 "" 또는 빈 목록 []으로.

## 글 쓰는 규칙
- 글 안에서 **굵게**(핵심어), `코드`(명령어·파일·값), ==형광펜== 을 쓸 수 있습니다.
- **==형광펜==은 학생이 칠한 말에만** 씁니다. 아래 '학생이 표시한 부분'에 있는 말이 요약에 들어가면, 그 말을 ==…==로 감싸세요. 학생이 표시한 내용은 빠짐없이 요약에 들어가야 합니다.
- 책에 원래 인쇄된 색 글씨·색 상자·기출 뱃지는 학생 표시가 **아닙니다**. 학생 표시는 아래 목록에 있는 것뿐입니다.
- 책 내용에 근거해서만 쓰세요. 책에 없는 사실·수치를 지어내지 마세요. 시나리오·문제도 책 내용으로 답할 수 있는 것만.
- 원문을 길게 베끼지 말고, 시험 직전에 훑어보는 노트처럼 짧고 구조적으로. 문장은 "~함/~임" 체나 짧은 평서문.
- 한국어로. 영어 용어는 책처럼 원어를 함께 (예: MIB(Management Information Base)).
{continues}"""

SCOPE_FOCUS = (
    "학생이 표시한 내용을 중심으로 정리하세요. 표시가 있는 주제만 unit으로 만들고, "
    "그 표시를 이해하는 데 필요한 앞뒤 설명은 짧게 곁들이세요. 표시가 전혀 없는 주제는 빼세요."
)
SCOPE_ALL = (
    "이 쪽들의 내용 전체를 요약집으로 정리하세요. 학생이 표시한 부분은 빠짐없이 넣고 ==형광펜==으로 강조하세요."
)


# ── 자료 준비 ───────────────────────────────────────────────────────────

@dataclass
class Chunk:
    pages: list[int]                              # 0부터 시작
    marks: list[Mark] = field(default_factory=list)


def plan_chunks(page_count: int, marks: list[Mark], scope: str, pages: Optional[list[int]] = None,
                per_chunk: int = PAGES_PER_CHUNK) -> list[Chunk]:
    """보낼 쪽 묶음. focus면 표시가 있는 쪽(과 바로 앞 쪽: 제목이 앞 쪽에 있는 경우가 많다)만."""
    allowed = sorted(set(pages)) if pages is not None else list(range(page_count))
    if scope == "focus":
        marked = {m.page for m in marks}
        want = sorted({p for m in marked for p in (m - 1, m) if p in set(allowed)})
    else:
        want = allowed
    chunks: list[Chunk] = []
    run: list[int] = []
    for p in want:
        if run and (p != run[-1] + 1 or len(run) >= per_chunk):
            chunks.append(Chunk(run))
            run = []
        run.append(p)
    if run:
        chunks.append(Chunk(run))
    for c in chunks:
        c.marks = [m for m in marks if m.page in c.pages]
    return chunks


def page_image(page: pymupdf.Page) -> bytes:
    """쪽을 Claude가 보기 좋은 크기의 JPEG로 (긴 변 1568px)."""
    long_side = max(page.rect.width, page.rect.height)
    zoom = PAGE_LONG_SIDE / long_side
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csRGB, alpha=False, annots=True)
    return pix.tobytes("jpeg", jpg_quality=82)


def _jpeg(png: bytes) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(png)).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def chunk_content(doc: pymupdf.Document, chunk: Chunk, scope: str,
                  get_text: Callable[[int], object] | None = None) -> list[dict]:
    from .ai import image_block

    content: list[dict] = []
    for p in chunk.pages:
        content.append({"type": "text", "text": f"[책 {p + 1}쪽]"})
        content.append(image_block(page_image(doc[p]), "image/jpeg"))
        pt = get_text(p) if get_text else None
        if pt is not None and getattr(pt, "has_text", False):
            txt = pt.text_in_band()[:5000]
            content.append({"type": "text", "text": f"<{p + 1}쪽_글자층>\n{txt}\n</{p + 1}쪽_글자층>"})

    lines: list[str] = []
    crops = 0
    n = 0

    def add(m: Mark, label: str) -> None:
        nonlocal crops, n
        n += 1
        body = m.text if m.kind not in (HANDWRITING, NOTE) else (m.transcription or m.text)
        where = f"{m.page_no}쪽"
        if body:
            lines.append(f"[표시 {n}] {where} {label}: \"{body}\"")
        elif m.image is not None and crops < MAX_CROPS_PER_CHUNK:
            crops += 1
            content.append({"type": "text", "text": f"[표시 {n}] {where} {label} — 아래 그림 속 부분"})
            content.append(image_block(_jpeg(m.image), "image/jpeg"))
            lines.append(f"[표시 {n}] {where} {label}: (위 그림 참고)")
        for note in m.notes:
            add(note, "손글씨 메모" if note.kind == HANDWRITING else "메모")

    for m in chunk.marks:
        if m.kind == HANDWRITING:
            add(m, "손글씨 메모")
        elif m.kind == NOTE:
            add(m, "메모")
        else:
            kind = {"highlight": "형광펜", "underline": "밑줄", "circle": "동그라미", "strikeout": "취소선"}.get(m.kind, m.kind)
            add(m, f"{kind}({color_name(m.color)})")

    marks_text = "\n".join(lines) if lines else "(이 쪽들에는 학생 표시가 없습니다)"
    continues = (
        "\n## 앞 내용에서 이어지는 경우\n이 쪽들은 책의 일부만 잘라 보낸 것입니다. 첫 쪽이 주제 중간에서 시작하면"
        "(맨 위에 새 주제 제목 없이 앞 내용이 이어지면) 첫 unit의 continues_previous를 true로 하고, title은 쪽 머리말이나 "
        "내용으로 알 수 있는 그 주제 이름으로 하세요. 그 밖의 unit은 모두 false."
    )
    content.append({"type": "text", "text": f"<학생이_표시한_부분>\n{marks_text}\n</학생이_표시한_부분>"})
    content.append({"type": "text", "text": PROMPT.format(scope=SCOPE_FOCUS if scope == "focus" else SCOPE_ALL, continues=continues)})
    return content


# ── 만들기 ──────────────────────────────────────────────────────────────

def estimate_cost(chunks: list[Chunk], price_in: float = 4.0, price_out: float = 20.0) -> tuple[int, float]:
    """(쪽 수, 대략 비용 달러). 쪽 이미지 ≈ 1,700토큰, 묶음마다 답 ≈ 6,000토큰으로 어림."""
    pages = sum(len(c.pages) for c in chunks)
    tin = pages * 1700 + len(chunks) * 2500
    tout = len(chunks) * 6000
    return pages, tin / 1e6 * price_in + tout / 1e6 * price_out


def write_booklet(reader, doc: pymupdf.Document, chunks: list[Chunk], scope: str, get_text=None,
                  progress: Callable[[int, int], None] | None = None, workers: int = 4) -> list[dict]:
    """묶음마다 Claude에게 정리를 맡기고(동시에 여러 개), 결과(unit 목록)를 쪽 순서대로 이어 붙인다."""
    from concurrent.futures import ThreadPoolExecutor

    contents = [chunk_content(doc, ch, scope, get_text) for ch in chunks]
    done = [0]

    def work(i: int):
        res = reader.ask_content(contents[i], BOOKLET_SCHEMA, max_tokens=32000, effort="medium", stream=True)
        done[0] += 1
        if progress:
            progress(done[0], len(chunks))
        return res

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        results = list(ex.map(work, range(len(chunks))))
    reader.save_cache()

    units: list[dict] = []
    for ch, res in zip(chunks, results):
        if not res:
            continue
        for k, u in enumerate(clean_units(res.get("units", []))):
            u["pages"] = sorted({p for p in u.get("pages", []) if 1 <= p <= doc.page_count} or {p + 1 for p in ch.pages})
            if k > 0:
                u["continues_previous"] = False   # 이어짐은 묶음의 첫 주제에만 있을 수 있다
            units.append(u)
    return merge_units(units)


def clean_units(units: list) -> list[dict]:
    """AI 답을 다듬는다: 빠진 칸은 기본값으로, 바로 되풀이된 항목은 하나로, 빈 블록은 뺀다.
    (작은 모델이나 잘린 답에서도 요약집이 깨지지 않게)"""
    def s(v) -> str:
        return v if isinstance(v, str) else ""

    def strs(v) -> list[str]:
        out: list[str] = []
        for x in v if isinstance(v, list) else []:
            if isinstance(x, str) and x.strip() and (not out or out[-1] != x):
                out.append(x)
        return out

    clean = []
    for u in units if isinstance(units, list) else []:
        if not isinstance(u, dict) or not s(u.get("title")).strip():
            continue
        sections = []
        for sec in u.get("sections") or []:
            if not isinstance(sec, dict):
                continue
            blocks, seen = [], None
            for b in sec.get("blocks") or []:
                if not isinstance(b, dict) or b.get("type") not in BLOCK_TYPES:
                    continue
                rows = [strs(r) for r in b.get("rows") or [] if isinstance(r, list)]
                nb = {"type": b["type"], "text": s(b.get("text")), "items": strs(b.get("items")),
                      "columns": strs(b.get("columns")), "rows": [r for r in rows if r]}
                if not (nb["text"].strip() or nb["items"] or nb["rows"]):
                    continue
                key = json.dumps(nb, ensure_ascii=False, sort_keys=True)
                if key != seen:
                    blocks.append(nb)
                seen = key
            if blocks:
                sections.append({"heading": s(sec.get("heading")) or "정리", "blocks": blocks})
        points, seen_topics = [], set()
        for p in u.get("points") or []:
            if not isinstance(p, dict) or not s(p.get("topic")).strip() or p["topic"] in seen_topics:
                continue
            seen_topics.add(p["topic"])
            stars = p.get("stars") if isinstance(p.get("stars"), int) else 1
            points.append({"topic": p["topic"], "memo": s(p.get("memo")), "stars": max(1, min(3, stars)),
                           "evidence": s(p.get("evidence"))})
        pages = [p for p in u.get("pages") or [] if isinstance(p, int)]
        clean.append({"chapter": s(u.get("chapter")), "title": u["title"], "continues_previous": bool(u.get("continues_previous")),
                      "intro": s(u.get("intro")), "sections": sections, "points": points, "pages": pages})
    return clean


def merge_units(units: list[dict]) -> list[dict]:
    """묶음 경계에서 잘린 같은 주제를 하나로 합친다 (같은 절 제목은 블록을 이어 붙임)."""
    out: list[dict] = []
    for u in units:
        if out and (u.get("continues_previous") or _same(out[-1]["title"], u["title"])):
            p = out[-1]
            for sec in u.get("sections", []):
                same = next((s for s in p["sections"] if _same(s["heading"], sec["heading"])), None)
                if same:
                    same["blocks"].extend(sec["blocks"])
                else:
                    p["sections"].append(sec)
            seen = {_norm(pt["topic"]) for pt in p["points"]}
            p["points"].extend(pt for pt in u.get("points", []) if _norm(pt["topic"]) not in seen)
            p["pages"] = sorted(set(p["pages"]) | set(u.get("pages", [])))
            if not p.get("chapter") and u.get("chapter"):
                p["chapter"] = u["chapter"]
            continue
        u = {**u, "sections": [dict(s, blocks=list(s["blocks"])) for s in u.get("sections", [])],
             "points": list(u.get("points", []))}
        out.append(u)
    # 절 순서를 1. 2. 3. 순으로
    for u in out:
        u["sections"].sort(key=lambda s: _section_order(s["heading"]))
    return out


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _same(a: str, b: str) -> bool:
    return bool(a) and _norm(a) == _norm(b)


def _section_order(heading: str) -> int:
    h = heading.strip()
    if h[:1].isdigit():
        try:
            return int(h.split(".")[0])
        except ValueError:
            pass
    return 50
