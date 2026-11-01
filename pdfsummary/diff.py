"""필기 전 원본 PDF와 비교해서, 사용자가 더한 것만 찾는다.

책 자체에 원래 있던 색칠·밑줄·그림은 원본에도 똑같이 있으므로 저절로 빠진다.
필기 앱이 필기를 주석으로 저장하든, 벡터 획으로 굳히든, 그림 한 장으로 덮어씌우든
'화면에 보이는 차이'를 보기 때문에 상관없다.
"""

from __future__ import annotations

import numpy as np
import pymupdf

from .models import HIGHLIGHT, SRC_DIFF, Mark, Rect, area
from .pagetext import PageText, join_chars
from .scan import CELL, _components, _merge_lines, _saturate, highlight_boxes, is_highlighter_color
from .strokes import Stroke, classify_pen_group, cluster_strokes

DIFF_DPI = 100
DIFF_THRESHOLD = 0.16    # 채널 값 차이 (0~1)


class PageMismatch(Exception):
    """원본과 필기본의 쪽 배치가 달라 비교할 수 없음."""


def render(page: pymupdf.Page, size: tuple[int, int] | None = None, annots: bool = True) -> np.ndarray:
    if size is None:
        zoom = DIFF_DPI / 72
        m = pymupdf.Matrix(zoom, zoom)
    else:
        m = pymupdf.Matrix(size[0] / page.rect.width, size[1] / page.rect.height)
    pix = page.get_pixmap(matrix=m, colorspace=pymupdf.csRGB, alpha=False, annots=annots)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.float32) / 255


def added_marks(
    page: pymupdf.Page,
    original: pymupdf.Page,
    pt: PageText,
    index: int,
    line_h: float,
    known: list[Rect],
) -> list[Mark]:
    """page(필기본)에만 있는 형광펜·펜 자국을 찾는다. known 영역(이미 찾은 표시)과 겹치는 것은 뺀다."""
    a = render(page)
    h, w = a.shape[:2]
    same = abs(page.rect.width - original.rect.width) < 1 and abs(page.rect.height - original.rect.height) < 1
    o = render(original, annots=False) if same else render(original, size=(w, h), annots=False)
    h, w = min(h, o.shape[0]), min(w, o.shape[1])
    a, o = a[:h, :w], o[:h, :w]
    zoom = w / page.rect.width

    changed = _shift_tolerant_diff(a, o) > DIFF_THRESHOLD
    if changed.mean() > 0.3:
        # 페이지 대부분이 다르면 쪽 배치가 바뀐 것(여백 추가, 다른 쪽)이라 비교가 의미 없다
        raise PageMismatch(index)
    tint = changed & is_highlighter_color(a) & (a.mean(axis=2) < o.mean(axis=2))   # 밝은 색이 덧칠됨
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    ink = changed & ~tint & (lum < 0.7)   # 펜 자국은 진하다 (형광펜 가장자리의 연한 픽셀은 제외)

    marks: list[Mark] = []
    known_px = [tuple(v * zoom for v in r) for r in known]

    # ── 형광펜 ───────────────────────────────────────────────
    for box, fill in _cell_components(tint, 0.3, close=True):
        y0, x0, y1, x1 = box
        if (y1 - y0) < 2 or (x1 - x0) < 3 or fill < 0.4:
            continue
        px = (x0 * CELL, y0 * CELL, x1 * CELL, y1 * CELL)
        if _mostly_known(px, known_px):
            continue
        region = a[px[1] : px[3], px[0] : px[2]][tint[px[1] : px[3], px[0] : px[2]]]
        rgb = tuple(float(v) for v in region.mean(axis=0)) if len(region) else (1, 1, 0)
        rect = tuple(v / zoom for v in px)
        marks.append(Mark(index, HIGHLIGHT, rect, SRC_DIFF, color=_saturate(rgb), parts=[rect]))
    marks = _merge_lines(marks)
    for m in marks:
        m.text = join_chars(pt.in_rects(m.parts))

    # ── 펜 자국 ───────────────────────────────────────────────
    strokes: list[Stroke] = []
    for box, _fill in _cell_components(ink, 0.08):
        y0, x0, y1, x1 = box
        px = (x0 * CELL, y0 * CELL, x1 * CELL, y1 * CELL)
        if _mostly_known(px, known_px):
            continue
        sub = ink[px[1] : px[3], px[0] : px[2]]
        n = int(sub.sum())
        if n < 6:   # 잡티
            continue
        ys, xs = np.nonzero(sub)
        step = max(1, len(xs) // 200)
        pts = [((px[0] + x) / zoom, (px[1] + y) / zoom) for x, y in zip(xs[::step], ys[::step])]
        color = tuple(float(v) for v in a[px[1] : px[3], px[0] : px[2]][sub].mean(axis=0))
        rect = tuple(v / zoom for v in px)
        strokes.append(Stroke(pts, rect, 1.0, color, 1.0, SRC_DIFF))

    for group in cluster_strokes(strokes, dist=max(6.0, 0.7 * line_h)):
        marks.append(classify_pen_group(group, pt, index, line_h))
    return marks


def _shift_tolerant_diff(a: np.ndarray, o: np.ndarray) -> np.ndarray:
    """원본을 위아래·좌우로 1픽셀씩 밀어 본 것 중 가장 비슷한 것과의 차이.
    필기 앱이 페이지를 다시 그리면서 생기는 미세한 어긋남은 차이로 보지 않는다."""
    ab, ob = _blur(a), _blur(o)
    p = np.pad(ob, ((1, 1), (1, 1), (0, 0)), mode="edge")
    h, w = a.shape[:2]
    best = None
    for dy in range(3):
        for dx in range(3):
            d = np.abs(ab - p[dy : dy + h, dx : dx + w]).max(axis=2)
            best = d if best is None else np.minimum(best, d)
    return best


def _blur(img: np.ndarray) -> np.ndarray:
    """3×3 평균: 글꼴 렌더링이 1픽셀 어긋난 정도의 차이는 무시하려고."""
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    out = np.zeros_like(img)
    for dy in range(3):
        for dx in range(3):
            out += p[dy : dy + img.shape[0], dx : dx + img.shape[1]]
    return out / 9


def _cell_components(mask: np.ndarray, frac: float, close: bool = False):
    gh, gw = mask.shape[0] // CELL, mask.shape[1] // CELL
    if gh == 0 or gw == 0:
        return []
    cells = mask[: gh * CELL, : gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3)) > frac
    return list(highlight_boxes(cells) if close else _components(cells))


def _mostly_known(px: Rect, known_px: list[Rect]) -> bool:
    a = area(px)
    if a == 0:
        return True
    for k in known_px:
        inter = (max(px[0], k[0] - 3), max(px[1], k[1] - 3), min(px[2], k[2] + 3), min(px[3], k[3] + 3))
        if area(inter) >= 0.5 * a:
            return True
    return False
