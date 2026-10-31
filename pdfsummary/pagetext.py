"""페이지의 인쇄 글자를 글자 단위로 들고 있다가, 영역 안의 글자를 읽기 순서대로 꺼내 준다."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

import pymupdf

from .models import Rect


@dataclass
class Char:
    c: str
    bbox: Rect
    line_id: int   # 같은 줄이면 같은 번호 (읽기 순서대로 증가)

    @property
    def cx(self) -> float:
        return (self.bbox[0] + self.bbox[2]) / 2

    @property
    def cy(self) -> float:
        return (self.bbox[1] + self.bbox[3]) / 2

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]


class PageText:
    def __init__(self, page: pymupdf.Page):
        self.chars: list[Char] = []
        line_id = 0
        raw = page.get_text("rawdict", sort=True)
        for block in raw.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    for ch in span.get("chars", []):
                        self.chars.append(Char(ch["c"], tuple(ch["bbox"]), line_id))
                line_id += 1

    @property
    def has_text(self) -> bool:
        return sum(1 for c in self.chars if not c.c.isspace()) > 20

    def line_height(self, default: float = 12.0) -> float:
        hs = sorted(c.height for c in self.chars if not c.c.isspace())
        return hs[len(hs) // 2] if hs else default

    # ── 영역 안 글자 고르기 ─────────────────────────────────────────
    def select(self, pred: Callable[[Char], bool]) -> list[Char]:
        return [c for c in self.chars if pred(c)]

    def in_rects(self, rects: Iterable[Rect], tol: float = 0.5) -> list[Char]:
        """글자 가운데가 사각형 안에 들어가는 글자들 (형광펜 영역)."""
        rects = list(rects)

        def inside(c: Char) -> bool:
            for r in rects:
                if r[0] - tol <= c.cx <= r[2] + tol and r[1] - tol <= c.cy <= r[3] + tol:
                    return True
            return False

        return self.select(inside)

    def near_polyline(self, points: list[tuple[float, float]], radius: float) -> list[Char]:
        """굵은 펜 획(형광펜 펜) 경로에서 radius 안에 가운데가 있는 글자들."""
        if len(points) < 2:
            return []
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        box = (min(xs) - radius, min(ys) - radius, max(xs) + radius, max(ys) + radius)
        segs = list(zip(points, points[1:]))
        out = []
        for c in self.chars:
            if not (box[0] <= c.cx <= box[2] and box[1] <= c.cy <= box[3]):
                continue
            # 글자 높이의 절반만큼은 여유를 준다 (획이 글자 위·아래로 살짝 치우쳐도 잡히게)
            r = radius + c.height * 0.25
            if any(_seg_dist(c.cx, c.cy, a, b) <= r for a, b in segs):
                out.append(c)
        return out

    def above_line(self, rect: Rect, max_gap: float) -> list[Char]:
        """밑줄(rect) 바로 위에 있는 글자들."""
        x0, y0, x1, y1 = rect
        out = []
        for c in self.chars:
            if c.cx < x0 - 1 or c.cx > x1 + 1:
                continue
            # 글자 아래쪽이 밑줄보다 위에 있고, 너무 멀지 않음
            if c.bbox[3] - c.height * 0.35 <= y0 + 1 and y0 - c.bbox[3] <= max_gap:
                out.append(c)
        if not out:
            return out
        # 밑줄과 가장 가까운 줄 하나만
        best = max(out, key=lambda c: c.bbox[3]).line_id
        return [c for c in out if c.line_id == best]

    def context_around(self, rect: Rect, margin: float = 40.0, limit: int = 300) -> str:
        """손글씨 주변의 인쇄 글자 (AI가 손글씨를 읽을 때 힌트로 쓴다)."""
        x0, y0, x1, y1 = rect
        sel = self.select(
            lambda c: y0 - margin <= c.cy <= y1 + margin
        )
        text = join_chars(sel)
        return text[:limit]


def _seg_dist(px: float, py: float, a, b) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    if L == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    qx, qy = ax + t * dx, ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def join_chars(chars: list[Char]) -> str:
    """고른 글자들을 줄 순서대로 이어 붙인다. 줄이 바뀌면 띄어 쓰고, '-'로 끊긴 영단어는 붙인다."""
    if not chars:
        return ""
    lines: dict[int, list[Char]] = {}
    for c in chars:
        lines.setdefault(c.line_id, []).append(c)
    parts: list[str] = []
    for lid in sorted(lines):
        s = "".join(c.c for c in sorted(lines[lid], key=lambda c: c.bbox[0])).strip()
        if not s:
            continue
        if parts and parts[-1].endswith("-") and s[:1].isalpha() and parts[-1][-2:-1].isalpha():
            parts[-1] = parts[-1][:-1] + s
        else:
            parts.append(s)
    text = " ".join(" ".join(parts).split())
    # 획 끝이 살짝 넘어가 붙은 쉼표 등은 떼어 낸다 (마침표는 문장 끝이므로 둔다)
    return text.strip(" ,，、;·")
