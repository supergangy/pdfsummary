"""페이지의 인쇄 글자를 글자 단위로 들고 있다가, 영역 안의 글자를 읽기 순서대로 꺼내 준다."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

import pymupdf

from .models import Rect


@dataclass
class Char:
    c: str
    bbox: Rect
    line_id: int   # 같은 줄이면 같은 번호 (읽기 순서대로 증가)
    idx: int = 0   # 페이지 안에서 읽기 순서 번호
    block_id: int = 0

    @property
    def cx(self) -> float:
        return (self.bbox[0] + self.bbox[2]) / 2

    @property
    def cy(self) -> float:
        return (self.bbox[1] + self.bbox[3]) / 2

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]


@dataclass
class Line:
    """제목 찾기에 쓰는 줄 정보."""
    text: str
    bbox: Rect
    size: float        # 가장 큰 글자 크기
    bold: bool
    block_id: int
    first_in_block: bool
    block_lines: int   # 이 줄이 속한 문단의 줄 수


SENTENCE_END = ".?!。？！"
BOLD_NAME = re.compile(r"(bold|black|heavy|semibold|demibold|extrabold|-b$|_b$|\bb\b)", re.I)


class PageText:
    def __init__(self, page: pymupdf.Page):
        self.chars: list[Char] = []
        self.lines: list[Line] = []
        self.height = page.rect.height
        line_id = 0
        raw = page.get_text("rawdict", sort=True)
        for block_id, block in enumerate(raw.get("blocks", [])):
            if block.get("type") != 0:
                continue
            blines = block.get("lines", [])
            for li, line in enumerate(blines):
                text_parts = []
                size = 0.0
                bold_chars = 0
                n_chars = 0
                for span in line.get("spans", []):
                    is_bold = bool(span.get("flags", 0) & 16) or bool(BOLD_NAME.search(span.get("font", "")))
                    for ch in span.get("chars", []):
                        self.chars.append(Char(ch["c"], tuple(ch["bbox"]), line_id, len(self.chars), block_id))
                        text_parts.append(ch["c"])
                        if not ch["c"].isspace():
                            n_chars += 1
                            size = max(size, float(span.get("size", 0)))
                            bold_chars += is_bold
                text = " ".join("".join(text_parts).split())
                if text:
                    self.lines.append(Line(text, tuple(line["bbox"]), size, n_chars > 0 and bold_chars >= 0.6 * n_chars,
                                           block_id, li == 0, len(blines)))
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
        last = len(segs) - 1
        out = []
        for c in self.chars:
            if not (box[0] <= c.cx <= box[2] and box[1] <= c.cy <= box[3]):
                continue
            # 글자 높이의 1/4만큼은 여유를 준다 (획이 글자 위·아래로 살짝 치우쳐도 잡히게)
            r = radius + c.height * 0.25
            for k, (a, b) in enumerate(segs):
                d, over = _seg_dist(c.cx, c.cy, a, b)
                # 획 양 끝의 둥근 부분이 옆 글자에 살짝 걸친 것은 칠한 것으로 보지 않는다
                if (k == 0 and over < -1.0) or (k == last and over > 1.0):
                    continue
                if d <= r:
                    out.append(c)
                    break
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

    def body_size(self) -> float:
        """본문 글자 크기 (가장 많이 쓰인 크기)."""
        count: dict[float, int] = {}
        for ln in self.lines:
            count[round(ln.size * 2) / 2] = count.get(round(ln.size * 2) / 2, 0) + len(ln.text)
        return max(count, key=count.get) if count else 10.0

    def sentence_runs(self, spans: list[tuple[int, int]], limit: int = 220) -> list[tuple[str, bool]]:
        """표시한 부분들(spans)이 들어 있는 문장 전체를 [(글, 표시했는지), ...] 조각으로 돌려준다.
        같은 문단 안에서 앞뒤 문장 끝(마침표 등)까지 넓힌다. 표시가 문장 전체면 빈 목록."""
        spans = sorted((max(0, a), min(len(self.chars) - 1, b)) for a, b in spans if a <= b)
        if not spans or not self.chars:
            return []
        a, b = spans[0][0], spans[-1][1]
        i = a
        while i > 0 and self._continues(i - 1) and not self._ends_sentence(i - 1):
            i -= 1
        j = b
        while j < len(self.chars) - 1 and not self._ends_sentence(j) and self._continues(j):
            j += 1
        flags = [any(s0 <= k <= s1 for s0, s1 in spans) for k in range(i, j + 1)]
        runs = _flow_runs(self.chars[i : j + 1], flags)
        if not any(not hl and any(ch.isalnum() for ch in t) for t, hl in runs):
            return []   # 표시가 이미 문장 전체 (남은 건 마침표 정도)
        if runs and not runs[0][1] and len(runs[0][0]) > limit:
            runs[0] = ("…" + runs[0][0][-limit:].lstrip(), False)
        if runs and not runs[-1][1] and len(runs[-1][0]) > limit:
            runs[-1] = (runs[-1][0][:limit].rstrip() + "…", False)
        return runs

    def _continues(self, k: int) -> bool:
        """k번째 글자 다음 글자가 같은 문단으로 이어지는지 (같은 줄이거나, 바로 아랫줄이고 글자 크기가 같음)."""
        cur, nxt = self.chars[k], self.chars[k + 1]
        if cur.line_id == nxt.line_id:
            return True
        h = max(cur.height, 1.0)
        gap = nxt.bbox[1] - cur.bbox[3]
        if not (-0.3 * h <= gap <= 0.9 * h and abs(nxt.height - cur.height) <= 0.1 * h):
            return False
        # 윗줄이 아랫줄보다 한참 짧게 끝나면(문장 부호 없이) 제목 같은 따로 선 줄이다
        if self._line_x1(cur.line_id) < self._line_x1(nxt.line_id) - 3 * h:
            return False
        return True

    def _line_x1(self, line_id: int) -> float:
        if not hasattr(self, "_x1"):
            self._x1: dict[int, float] = {}
            for c in self.chars:
                if not c.c.isspace():
                    self._x1[c.line_id] = max(self._x1.get(c.line_id, 0.0), c.bbox[2])
        return self._x1.get(line_id, 0.0)

    def _ends_sentence(self, k: int) -> bool:
        c = self.chars[k].c
        if c not in SENTENCE_END:
            return False
        nxt = self.chars[k + 1] if k + 1 < len(self.chars) else None
        # 3.14 처럼 숫자 사이의 점은 문장 끝이 아니다
        return nxt is None or nxt.c.isspace() or nxt.line_id != self.chars[k].line_id or not nxt.c.isdigit()

    def text_in_band(self, y0: float = float("-inf"), y1: float = float("inf")) -> str:
        """세로 위치가 y0~y1 사이인 글자들 (단원 본문 자르기)."""
        return _flow([c for c in self.chars if y0 <= c.cy < y1]).strip()

    def context_around(self, rect: Rect, margin: float = 40.0, limit: int = 300) -> str:
        """손글씨 주변의 인쇄 글자 (AI가 손글씨를 읽을 때 힌트로 쓴다)."""
        x0, y0, x1, y1 = rect
        sel = self.select(
            lambda c: y0 - margin <= c.cy <= y1 + margin
        )
        text = join_chars(sel)
        return text[:limit]


def _seg_dist(px: float, py: float, a, b) -> tuple[float, float]:
    """점과 선분 사이 거리, 그리고 선분 밖으로 벗어난 길이(시작점 앞이면 음수, 끝점 뒤면 양수, 안이면 0)."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    if L == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5, 0.0
    raw = ((px - ax) * dx + (py - ay) * dy) / L
    t = max(0.0, min(1.0, raw))
    qx, qy = ax + t * dx, ay + t * dy
    over = (raw - t) * L ** 0.5
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5, over


def span_of(chars: list[Char]) -> Optional[tuple[int, int]]:
    """고른 글자들이 페이지 글 흐름에서 차지하는 범위 (처음, 끝 번호)."""
    real = [c.idx for c in chars if not c.c.isspace()]
    return (min(real), max(real)) if real else None


def _flow_runs(chars: list[Char], flags: list[bool]) -> list[tuple[str, bool]]:
    """_flow와 같되, 글자마다 표시 여부를 들고 다니다가 같은 것끼리 묶는다."""
    out: list[tuple[str, bool]] = []
    prev = None
    for c, f in zip(chars, flags):
        if prev is not None and c.line_id != prev.line_id:
            if out and out[-1][0] == "-" and len(out) > 1 and out[-2][0].isalpha() and c.c.isalpha():
                out.pop()
            else:
                out.append((" ", f and out[-1][1] if out else f))
        ch = " " if c.c.isspace() else c.c
        if ch == " " and out and out[-1][0] == " ":
            continue
        out.append((ch, f))
        prev = c
    runs: list[tuple[str, bool]] = []
    for ch, f in out:
        if ch == " " and runs and runs[-1][1] != f:
            f = False   # 표시 경계의 띄어쓰기는 표시하지 않은 쪽에 붙인다
        if runs and runs[-1][1] == f:
            runs[-1] = (runs[-1][0] + ch, f)
        else:
            runs.append((ch, f))
    if runs:
        runs[0] = (runs[0][0].lstrip(), runs[0][1])
        runs[-1] = (runs[-1][0].rstrip(), runs[-1][1])
    return [r for r in runs if r[0]]


def _flow(chars: list[Char]) -> str:
    """글자들을 원래 순서대로 잇는다. 줄이 바뀌면 띄어 쓰고, 연속된 공백은 하나로."""
    out: list[str] = []
    prev = None
    for c in chars:
        if prev is not None and c.line_id != prev.line_id:
            if out and out[-1] == "-" and len(out) > 1 and out[-2].isalpha() and c.c.isalpha():
                out.pop()
            else:
                out.append(" ")
        out.append(c.c)
        prev = c
    return re.sub(r"\s+", " ", "".join(out))


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
