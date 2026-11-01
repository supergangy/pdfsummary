"""찾아낸 표시들을 정리한다: 이어진 형광펜 합치기, 메모를 가까운 형광펜에 붙이기, 단원 나누기."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .colors import color_key
from .models import CIRCLE, HANDWRITING, HIGHLIGHT, NOTE, STRIKEOUT, UNDERLINE, Mark, union

TEXT_KINDS = (HIGHLIGHT, UNDERLINE, CIRCLE, STRIKEOUT)


def reading_order(marks: list[Mark]) -> list[Mark]:
    def key(m: Mark):
        # 같은 높이(반 줄 이내)면 왼쪽부터
        return (m.page, round(m.rect[1] / 6), m.rect[0])

    return sorted(marks, key=key)


def drop_empty(marks: list[Mark]) -> list[Mark]:
    return [m for m in marks if m.text.strip() or m.image or m.transcription]


def merge_adjacent(marks: list[Mark], line_heights: dict[int, float]) -> list[Mark]:
    """한 문장을 여러 번 나눠 칠한 형광펜(줄마다 따로 그은 펜 등)을 하나로 잇는다."""
    out: list[Mark] = []
    for m in marks:
        if out and m.kind in TEXT_KINDS and m.text:
            p = out[-1]
            lh = line_heights.get(m.page, 12.0)
            same = (
                p.page == m.page
                and p.kind == m.kind
                and p.text
                and color_key(p.color) == color_key(m.color)
                and p.source == m.source
            )
            # 다음 줄로 이어지거나(세로 간격 작음), 같은 줄에서 바로 옆에 붙어 있음
            close = (0 <= m.rect[1] - p.rect[1] <= 1.8 * lh and m.rect[1] - p.rect[3] <= 0.6 * lh) and (
                m.rect[1] - p.rect[1] > 0.5 * lh or 0 <= m.rect[0] - p.rect[2] <= lh
            )
            if same and close and m.text not in p.text:
                p.text = (p.text + " " + m.text).strip()
                p.rect = union(p.rect, m.rect)
                p.parts.extend(m.parts or [m.rect])
                if p.span and m.span:
                    p.spans = (p.spans or [p.span]) + (m.spans or [m.span])
                    p.span = (min(p.span[0], m.span[0]), max(p.span[1], m.span[1]))
                p.notes.extend(m.notes)
                continue
        out.append(m)
    return out


def attach_notes(marks: list[Mark], line_heights: dict[int, float], max_lines: float = 2.0) -> list[Mark]:
    """손글씨/메모를 같은 페이지에서 가장 가까운 형광펜·밑줄에 붙인다. 멀면 따로 둔다.

    여백 메모는 본문과 가로로 멀리 떨어져 있기 마련이라 세로 거리(몇 줄 차이인지)를 주로 본다.
    """
    anchors = [m for m in marks if m.kind in TEXT_KINDS and m.text]
    out: list[Mark] = []
    for m in marks:
        if m.kind in (HANDWRITING, NOTE):
            lh = line_heights.get(m.page, 12.0)
            cands = [a for a in anchors if a.page == m.page]
            if cands:
                best = min(cands, key=lambda a: (_dy(a.rect, m.rect), _dx(a.rect, m.rect)))
                if _dy(best.rect, m.rect) <= max_lines * lh:
                    best.notes.append(m)
                    continue
        out.append(m)
    return out


def _dy(a, b) -> float:
    return max(0.0, max(a[1], b[1]) - min(a[3], b[3]))


def _dx(a, b) -> float:
    return max(0.0, max(a[0], b[0]) - min(a[2], b[2]))


def decide_images(marks: list[Mark], mode: str) -> None:
    """원본 이미지를 보여줄지 정한다.

    mode
      auto  : AI가 확실히 읽은 것은 글로, 애매하거나 못 읽은 것은 원본 이미지도 같이
      ai    : 글만 (AI가 못 읽은 것만 이미지)
      image : 손글씨는 원본 이미지 그대로
      both  : 글 + 원본 이미지 항상 같이
    """
    for m in _walk(marks):
        if not m.image:
            m.show_image = False
            continue
        readable = bool(m.transcription if m.kind == HANDWRITING else m.text)
        if mode == "image":
            m.show_image = m.kind == HANDWRITING or not readable
        elif mode == "both":
            m.show_image = True
        elif mode == "ai":
            m.show_image = not readable
        else:
            m.show_image = not readable or (m.confidence not in (None, "high") and not m.is_symbol)


def _walk(marks):
    for m in marks:
        yield m
        yield from _walk(m.notes)


def all_marks(marks: list[Mark]):
    return list(_walk(marks))


# ── 단원 ───────────────────────────────────────────────────────────────

@dataclass
class Section:
    title: Optional[str]
    level: int
    marks: list[Mark] = field(default_factory=list)
    overview: str = ""          # AI 단원 개요
    count: int = 0              # 하위 단원까지 합친 표시 수 (목차에 표시)
    anchor: str = ""


def from_tree(root) -> list[Section]:
    """목차 나무를 위에서부터 차례로 펼친다. 표시가 없는 상위 제목도 길잡이로 남긴다."""
    out: list[Section] = []

    def visit(node, depth):
        if node.title is None:
            if node.marks or node.overview:
                out.append(Section(None, 1, list(node.marks), node.overview, node.count()))
        else:
            out.append(Section(node.title, depth, list(node.marks), node.overview, node.count()))
        for c in node.children:
            visit(c, depth + 1 if node.title is not None else 1)

    visit(root, 0)
    for i, sec in enumerate(out):
        sec.anchor = f"s{i + 1}"
    return out


def by_chapter(marks: list[Mark], toc: list, max_level: int = 2) -> list[Section]:
    """(예전 방식) PDF 책갈피만으로 나누기. 테스트·하위 호환용."""
    from .outline import Heading, build_tree

    heads = [Heading(page - 1, float("-inf"), lvl, str(title).strip(), "toc")
             for lvl, title, page, *_ in toc if lvl <= max_level and page >= 1]
    return [s for s in from_tree(build_tree(heads, marks)) if s.marks]


def by_page(marks: list[Mark]) -> list[Section]:
    sections: list[Section] = []
    for m in marks:
        if not sections or sections[-1].marks[0].page != m.page:
            sections.append(Section(f"{m.page_no}쪽", 1, anchor=f"s{len(sections) + 1}"))
        sections[-1].marks.append(m)
    return sections


def by_color(marks: list[Mark], labels: dict[str, str]) -> list[Section]:
    from .colors import COLOR_NAMES

    groups: dict[str, Section] = {}
    order = list(COLOR_NAMES)
    for m in marks:
        if m.kind in (HANDWRITING, NOTE):
            k = "_notes"
            title = "따로 적은 메모"
        else:
            k = color_key(m.color)
            title = labels.get(k) or f"{COLOR_NAMES[k][0]} 표시"
        groups.setdefault(k, Section(title, 1)).marks.append(m)
    keys = sorted(groups, key=lambda k: order.index(k) if k in order else 99)
    out = [groups[k] for k in keys]
    for i, sec in enumerate(out):
        sec.anchor = f"s{i + 1}"
        sec.count = len(sec.marks)
    return out


def add_sentences(marks: list[Mark], get_text) -> None:
    """표시한 부분이 들어 있는 문장 전체를 붙인다 (앞뒤 문맥)."""
    for m in all_marks(marks):
        if m.kind in TEXT_KINDS and m.span and m.text:
            pt = get_text(m.page)
            if pt is not None:
                m.sentence = pt.sentence_runs(m.spans or [m.span])


def number_marks(marks: list[Mark]) -> None:
    for i, m in enumerate(marks, 1):
        m.uid = i
