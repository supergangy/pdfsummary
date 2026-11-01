"""책의 목차(제목 구조)를 찾고, 표시들을 목차 나무에 매단다.

제목은 두 군데서 찾는다.
- PDF 책갈피(목차) : 있으면 가장 믿을 만하다
- 글자 모양 : 본문보다 큰 글자, 또는 짧은 굵은 줄. 머리말·쪽 번호처럼 매 쪽 반복되는 줄은 뺀다
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from .models import Mark
from .pagetext import PageText

MAX_LEVELS = 4


@dataclass
class Heading:
    page: int
    y: float
    level: int
    title: str
    source: str   # toc / font


@dataclass
class Node:
    title: Optional[str]
    level: int
    page: int = 0
    y: float = float("-inf")
    children: list["Node"] = field(default_factory=list)
    marks: list[Mark] = field(default_factory=list)
    overview: str = ""
    end: tuple[int, float] = (10**9, float("inf"))   # 다음 제목 위치 (이 단원 본문의 끝)

    def count(self) -> int:
        return len(self.marks) + sum(c.count() for c in self.children)

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


# ── 제목 찾기 ───────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s).lower()


def font_headings(texts: dict[int, PageText]) -> list[Heading]:
    if not texts:
        return []
    # 본문 크기: 전체에서 가장 많이 쓰인 크기
    weight: dict[float, int] = {}
    for pt in texts.values():
        for ln in pt.lines:
            k = round(ln.size * 2) / 2
            weight[k] = weight.get(k, 0) + len(ln.text)
    if not weight:
        return []
    body = max(weight, key=weight.get)

    running = _running_lines(texts)
    cands: list[tuple[int, float, float, str]] = []   # (쪽, y, 크기 등급용 값, 제목)
    for i, pt in sorted(texts.items()):
        lines = pt.lines
        k = 0
        while k < len(lines):
            ln = lines[k]
            k += 1
            if not ln.first_in_block or ln.block_lines > 3:
                continue
            if not _looks_like_title(ln.text) or _norm_running(ln.text) in running:
                continue
            big = ln.size >= body * 1.12
            bold = ln.bold and ln.size >= body * 0.95 and ln.block_lines <= 2
            if not (big or bold):
                continue
            title = ln.text
            # 두 줄로 된 제목은 이어 붙인다
            if k < len(lines) and lines[k].block_id == ln.block_id and abs(lines[k].size - ln.size) < 0.5 and lines[k].bold == ln.bold:
                if _looks_like_title(title + " " + lines[k].text):
                    title += " " + lines[k].text
                    k += 1
            rank = ln.size if big else body + 0.01   # 본문 크기 굵은 줄은 가장 작은 제목
            cands.append((i, ln.bbox[1], rank, title))

    sizes = sorted({round(c[2] * 2) / 2 for c in cands}, reverse=True)
    level_of = {s: min(idx + 1, MAX_LEVELS) for idx, s in enumerate(sizes)}
    return [Heading(p, y, level_of[round(r * 2) / 2], t, "font") for p, y, r, t in cands]


def _looks_like_title(text: str) -> bool:
    t = text.strip()
    if not (2 <= len(t) <= 60):
        return False
    if re.fullmatch(r"[\d\s.\-–—·|/()]+", t):     # 쪽 번호 등
        return False
    if t.endswith(("다.", "요.", "니다.", ",", ";")):  # 문장으로 끝나면 제목이 아님
        return False
    letters = sum(ch.isalpha() for ch in t)
    return letters >= max(2, len(t) * 0.4)


def _norm_running(text: str) -> str:
    return re.sub(r"\d+", "#", _norm(text))


def _running_lines(texts: dict[int, PageText]) -> set[str]:
    """여러 쪽의 위·아래 여백에 반복되는 줄 (머리말, 꼬리말)."""
    count: dict[str, int] = {}
    for pt in texts.values():
        seen = set()
        for ln in pt.lines:
            if ln.bbox[1] < pt.height * 0.09 or ln.bbox[3] > pt.height * 0.91:
                seen.add(_norm_running(ln.text))
        for s in seen:
            count[s] = count.get(s, 0) + 1
    need = max(3, int(len(texts) * 0.25))
    return {s for s, n in count.items() if n >= need}


def toc_headings(toc: list, get_text: Callable[[int], Optional[PageText]]) -> list[Heading]:
    out = []
    for entry in toc:
        lvl, title, page = entry[0], str(entry[1]).strip(), entry[2]
        if page < 1 or not title:
            continue
        p = page - 1
        y = float("-inf")
        pt = get_text(p)
        if pt is not None:
            key = _norm(title)
            for ln in pt.lines:
                n = _norm(ln.text)
                if n and (n == key or (len(n) >= 4 and (n in key or key in n))):
                    y = ln.bbox[1]
                    break
        out.append(Heading(p, y, min(lvl, MAX_LEVELS), title, "toc"))
    return out


def merge_headings(toc: list[Heading], font: list[Heading]) -> list[Heading]:
    """책갈피 제목을 기본으로, 책갈피에 없는 더 작은 제목을 글자 모양에서 보탠다."""
    if not toc:
        return sorted(font, key=lambda h: (h.page, h.y))
    if not font:
        return sorted(toc, key=lambda h: (h.page, h.y))
    toc_keys = [(_norm(h.title), h.page) for h in toc]
    max_toc = max(h.level for h in toc)
    # 책갈피와 같은 제목인 글자 모양 등급 → 책갈피 단계에 맞춘다
    matched_levels: dict[int, int] = {}
    extra = []
    for h in font:
        n = _norm(h.title)
        hit = next((t for t, (k, p) in zip(toc, toc_keys) if abs(p - h.page) <= 1 and k and (k == n or (len(n) >= 4 and (n in k or k in n)))), None)
        if hit:
            matched_levels[h.level] = hit.level
            continue
        extra.append(h)
    deepest_matched = max(matched_levels) if matched_levels else 0
    kept = []
    for h in extra:
        if h.level <= deepest_matched:
            # 책갈피 단계와 같은 크기인데 책갈피에 없는 줄은 본문 강조일 가능성이 커서 뺀다
            continue
        lvl = max_toc + (h.level - deepest_matched)
        kept.append(Heading(h.page, h.y, min(lvl, MAX_LEVELS + max_toc), h.title, "font"))
    return sorted(toc + kept, key=lambda h: (h.page, h.y))


# ── 나무 만들기 ─────────────────────────────────────────────────────────

def build_tree(headings: list[Heading], marks: list[Mark]) -> Node:
    root = Node(None, 0)
    items: list[tuple] = [((h.page, h.y, 0), h) for h in headings] + [((m.page, m.rect[1], 1), m) for m in marks]
    items.sort(key=lambda it: it[0])
    stack = [root]
    nodes_in_order: list[Node] = []
    for _key, it in items:
        if isinstance(it, Heading):
            while len(stack) > 1 and stack[-1].level >= it.level:
                stack.pop()
            node = Node(it.title, it.level, it.page, it.y)
            stack[-1].children.append(node)
            stack.append(node)
            nodes_in_order.append(node)
        else:
            stack[-1].marks.append(it)
            it.heading_path = [n.title for n in stack[1:] if n.title]
    # 각 단원 본문의 끝 = 다음 제목 위치
    for a, b in zip(nodes_in_order, nodes_in_order[1:]):
        a.end = (b.page, b.y)
    if nodes_in_order:
        root.end = (nodes_in_order[0].page, nodes_in_order[0].y)
    _prune(root)
    return root


def _prune(node: Node) -> None:
    node.children = [c for c in node.children if c.count() > 0]
    for c in node.children:
        _prune(c)


def section_text(node: Node, get_text: Callable[[int], Optional[PageText]], cap: int = 15000) -> tuple[str, bool]:
    """이 단원 제목부터 다음 제목 전까지의 책 본문. 너무 길면 표시가 있는 쪽 위주로 줄인다.
    돌려주는 값: (본문, 줄였는지)"""
    start_page = node.page if node.title else min((m.page for m in node.marks), default=0)
    start_y = node.y if node.title else float("-inf")
    end_page, end_y = node.end
    last_mark_page = max((m.page for m in node.marks), default=start_page)
    end_page = min(end_page, last_mark_page + 1)  # 표시가 없는 뒤쪽 쪽들까지 길게 가져오지 않는다
    pages = {}
    for p in range(start_page, end_page + 1):
        pt = get_text(p)
        if pt is None:
            continue
        y0 = start_y if p == start_page else float("-inf")
        y1 = end_y if p == node.end[0] else float("inf")
        t = pt.text_in_band(y0, y1)
        if t:
            pages[p] = t
    text = "\n".join(pages.values())
    if len(text) <= cap:
        return text, False
    mark_pages = sorted({m.page for m in node.marks})
    text = "\n…\n".join(pages[p] for p in mark_pages if p in pages)
    return text[:cap], True
