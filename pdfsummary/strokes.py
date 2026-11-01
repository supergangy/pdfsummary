"""펜 획 다루기.

펜 획은 두 군데서 온다.
- PDF 주석 중 '잉크(Ink)' : Adobe, 미리보기, Xodo, Flexcil, 삼성노트 일부 등
- 페이지 내용에 굳어진 벡터 경로 : GoodNotes, Notability 등에서 'PDF로 내보내기'한 파일

획들을 '형광펜 펜'과 '일반 펜'으로 나누고, 일반 펜 획은 가까운 것끼리 묶은 뒤
밑줄 / 동그라미 / 손글씨 중 무엇인지 판정한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pymupdf

from .models import (
    CIRCLE,
    HANDWRITING,
    HIGHLIGHT,
    UNDERLINE,
    Mark,
    Rect,
    expand,
    gap,
    intersects,
    union,
)
from .pagetext import PageText, join_chars


@dataclass
class Stroke:
    points: list[tuple[float, float]]
    rect: Rect
    width: float
    color: Optional[tuple[float, float, float]]
    opacity: float
    source: str
    polygon: bool = False   # 획 외곽선을 채운 도형 (GoodNotes 방식)
    extra_rects: list[Rect] = field(default_factory=list)


# ── 주석(Ink)에서 획 꺼내기 ────────────────────────────────────────────

def strokes_from_ink_annot(annot: pymupdf.Annot, source: str) -> list[Stroke]:
    width = (annot.border or {}).get("width") or 1.0
    if width < 0:
        width = 1.0
    color = tuple((annot.colors or {}).get("stroke") or ()) or None
    opacity = annot.opacity if annot.opacity is not None and annot.opacity >= 0 else 1.0
    out = []
    for pts in annot.vertices or []:
        pts = [(float(x), float(y)) for x, y in pts]
        if not pts:
            continue
        out.append(Stroke(pts, _bbox(pts, width / 2), float(width), color, float(opacity), source))
    return out


# ── 페이지 내용에 굳어진 벡터 획 꺼내기 ─────────────────────────────────

def strokes_from_drawings(page: pymupdf.Page, skip_rects: list[Rect], source: str) -> list[Stroke]:
    """책 자체의 도형(표 선, 그림)은 빼고 손으로 그린 것 같은 경로만 고른다."""
    out = []
    for d in page.get_drawings():
        r = tuple(d["rect"])
        # 주석의 겉모양도 get_drawings에 섞여 나오므로 주석 자리는 건너뛴다
        if any(_inside(r, expand(s, 2)) for s in skip_rects):
            continue
        items = d.get("items") or []
        if not items:
            continue
        kinds = [it[0] for it in items]
        n_curve = kinds.count("c")
        n_line = kinds.count("l")
        n_rect = kinds.count("re") + kinds.count("qu")

        stroke_op = d.get("stroke_opacity")
        fill_op = d.get("fill_opacity")
        opacity = min(x for x in (stroke_op, fill_op, 1.0) if x is not None)
        translucent = opacity < 0.95
        is_fill = d.get("type") in ("f", "fs") and d.get("fill") is not None
        color = d.get("fill") if is_fill else d.get("color")
        if color is None:
            continue
        if is_fill and min(color) > 0.97:      # 흰색 채우기는 배경
            continue

        pts = _flatten(items)
        if not is_fill and d.get("closePath") and len(pts) > 2 and pts[-1] == pts[0]:
            pts = pts[:-1]   # 열린 획인데 끝을 시작점으로 되돌리는 선은 실제로 그은 것이 아니다
        if len(pts) < 2:
            continue

        # 반투명한 사각형 = 형광펜으로 칠한 영역인 경우가 많다
        if n_rect and not n_curve and not n_line:
            if translucent:
                for it in items:
                    rr = _item_rect(it)
                    if rr:
                        out.append(Stroke(_rect_centerline(rr), rr, rr[3] - rr[1], color, opacity, source, polygon=True))
            continue

        caps = d.get("lineCap") or (0,)
        round_cap = any(c == 1 for c in (caps if isinstance(caps, (tuple, list)) else (caps,)))
        freehand = n_curve >= 3 or (n_line >= 6 and not _axis_aligned(items))
        # 반투명한 굵은 선은 모양이 단순해도(직선 형광펜) 필기로 본다
        thick_translucent = translucent and not is_fill and float(d.get("width") or 0) >= 3
        if not (freehand or thick_translucent):
            continue
        if not (translucent or round_cap or (is_fill and n_curve >= 8)):
            # 반투명도 아니고 둥근 끝도 아닌 곡선은 책 그림일 가능성이 높다
            continue

        if is_fill:
            w = _polygon_width(pts)
            out.append(Stroke(pts, r, w, tuple(color), opacity, source, polygon=True))
        else:
            w = float(d.get("width") or 1.0)
            out.append(Stroke(pts, expand(r, w / 2), w, tuple(color), opacity, source))
    return out


# ── 획 → 표시(Mark) ────────────────────────────────────────────────────

def is_highlighter(s: Stroke, line_h: float) -> bool:
    if s.opacity < 0.9:
        return True
    return s.width >= max(4.0, 0.45 * line_h)


def highlight_from_stroke(s: Stroke, pt: PageText, page_index: int) -> Mark:
    if s.polygon:
        if len(s.points) <= 2:   # 반투명 사각형 (가운데 선만 들고 있음)
            chars = pt.select(lambda c: _in_rect(c.cx, c.cy, s.rect))
        else:
            chars = pt.select(lambda c: _point_in_polygon(c.cx, c.cy, s.points))
    else:
        chars = pt.near_polyline(s.points, s.width / 2)
    return Mark(
        page=page_index,
        kind=HIGHLIGHT,
        rect=s.rect,
        source=s.source,
        color=s.color,
        text=join_chars(chars),
    )


def cluster_strokes(strokes: list[Stroke], dist: float) -> list[list[Stroke]]:
    """가까운 획끼리 묶는다 (손글씨 한 글자/한 단어/한 줄이 여러 획이므로)."""
    n = len(strokes)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if gap(strokes[i].rect, strokes[j].rect) <= dist:
                parent[find(i)] = find(j)
    groups: dict[int, list[Stroke]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(strokes[i])
    return sorted(groups.values(), key=lambda g: (_group_rect(g)[1], _group_rect(g)[0]))


def classify_pen_group(group: list[Stroke], pt: PageText, page_index: int, line_h: float) -> Mark:
    r = _group_rect(group)
    w, h = r[2] - r[0], r[3] - r[1]
    color = group[0].color
    source = group[0].source

    # 1) 밑줄: 납작하고 길쭉하며 바로 위에 인쇄 글자가 있음
    if len(group) <= 2 and h <= max(0.5 * line_h, 4) and w >= 3 * max(h, 1):
        chars = pt.above_line(r, max_gap=0.6 * line_h)
        if chars:
            return Mark(page_index, UNDERLINE, r, source, color, text=join_chars(chars))

    # 2) 동그라미/네모: 안쪽에 인쇄 글자가 있고 획이 테두리를 따라감
    if len(group) <= 3 and w >= 0.8 * line_h and h >= 0.8 * line_h:
        inner = pt.select(lambda c: _in_rect(c.cx, c.cy, r))
        if len([c for c in inner if not c.c.isspace()]) >= 2 and _mostly_on_border(group, r):
            return Mark(page_index, CIRCLE, r, source, color, text=join_chars(inner))

    # 3) 나머지는 손글씨 (또는 별표·화살표 같은 기호)
    return Mark(page_index, HANDWRITING, r, source, color, context=pt.context_around(r))


# ── 보조 함수 ──────────────────────────────────────────────────────────

def _group_rect(group: list[Stroke]) -> Rect:
    r = group[0].rect
    for s in group[1:]:
        r = union(r, s.rect)
    return r


def _bbox(pts, pad: float = 0.0) -> Rect:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def _inside(a: Rect, b: Rect) -> bool:
    return a[0] >= b[0] and a[1] >= b[1] and a[2] <= b[2] and a[3] <= b[3]


def _in_rect(x, y, r: Rect) -> bool:
    return r[0] <= x <= r[2] and r[1] <= y <= r[3]


def _flatten(items) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for it in items:
        op = it[0]
        if op == "l":
            seq = [it[1], it[2]]
        elif op == "c":
            seq = [it[1], it[2], it[3], it[4]]
        elif op == "re":
            rr = it[1]
            seq = [rr.tl, rr.tr, rr.br, rr.bl]
        elif op == "qu":
            q = it[1]
            seq = [q.ul, q.ur, q.lr, q.ll]
        else:
            continue
        for p in seq:
            xy = (float(p.x), float(p.y))
            if not pts or pts[-1] != xy:
                pts.append(xy)
    return pts


def _item_rect(it) -> Optional[Rect]:
    if it[0] == "re":
        return tuple(it[1])
    if it[0] == "qu":
        return tuple(it[1].rect)
    return None


def _rect_centerline(r: Rect) -> list[tuple[float, float]]:
    my = (r[1] + r[3]) / 2
    return [(r[0], my), (r[2], my)]


def _axis_aligned(items) -> bool:
    for it in items:
        if it[0] == "l":
            a, b = it[1], it[2]
            if abs(a.x - b.x) > 0.5 and abs(a.y - b.y) > 0.5:
                return False
        elif it[0] == "c":
            return False
    return True


def _polygon_width(pts) -> float:
    """채운 띠 모양의 평균 두께 ≈ 2 × 넓이 / 둘레."""
    a = 0.0
    per = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
        per += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    a = abs(a) / 2
    return 2 * a / per if per else 0.0


def _point_in_polygon(x, y, poly) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def _mostly_on_border(group: list[Stroke], r: Rect) -> bool:
    w, h = r[2] - r[0], r[3] - r[1]
    mx, my = w * 0.22, h * 0.22
    pts = [p for s in group for p in s.points]
    if len(pts) < 6:
        return False
    near = sum(
        1
        for x, y in pts
        if x - r[0] <= mx or r[2] - x <= mx or y - r[1] <= my or r[3] - y <= my
    )
    return near / len(pts) >= 0.85


def overlaps_any(r: Rect, rects: list[Rect]) -> bool:
    return any(intersects(r, o) for o in rects)
