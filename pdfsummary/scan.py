"""스캔한 책(페이지가 통째로 사진인 PDF)에서 형광펜 칠한 곳을 색으로 찾는다.

인쇄 글자는 검정·회색(채도 낮음)이고 형광펜은 밝고 채도가 높다는 점을 이용한다.
"""

from __future__ import annotations

from collections import deque

import numpy as np
import pymupdf

from .colors import color_key
from .models import HIGHLIGHT, SRC_SCAN, Mark, Rect

SCAN_DPI = 100
CELL = 4  # 픽셀 묶음 크기 (작은 잡티 무시)


def is_scanned_page(page: pymupdf.Page) -> bool:
    """페이지 대부분을 불투명한 이미지 한 장이 덮고 있으면 스캔 페이지로 본다.
    (투명 배경 그림은 필기 앱이 손글씨를 그림으로 굳혀 덮은 것이라 스캔이 아니다)"""
    area = page.rect.width * page.rect.height
    for info in page.get_image_info():
        if info.get("has-mask"):
            continue
        b = pymupdf.Rect(info["bbox"]) & page.rect
        if b.width * b.height >= 0.6 * area:
            return True
    return False


def find_highlights(page: pymupdf.Page, page_index: int) -> list[Mark]:
    zoom = SCAN_DPI / 72
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csRGB, alpha=False, annots=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.float32) / 255
    mask = is_highlighter_color(img)

    gh, gw = mask.shape[0] // CELL, mask.shape[1] // CELL
    if gh == 0 or gw == 0:
        return []
    cells = mask[: gh * CELL, : gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3)) > 0.3

    marks = []
    for (y0, x0, y1, x1), fill in highlight_boxes(cells):
        bh, bw = y1 - y0, x1 - x0
        # 글자 줄 모양의 띠만 (너무 작거나, 사진처럼 큰 덩어리는 제외)
        if bh < 2 or bw < 5 or fill < 0.45:
            continue
        if bh * CELL / zoom > 60 and bw < 2 * bh:
            continue
        px0, py0, px1, py1 = x0 * CELL, y0 * CELL, x1 * CELL, y1 * CELL
        region = img[py0:py1, px0:px1][mask[py0:py1, px0:px1]]
        rgb = tuple(float(v) for v in region.mean(axis=0)) if len(region) else (1, 1, 0)
        rect: Rect = (px0 / zoom, py0 / zoom, px1 / zoom, py1 / zoom)
        marks.append(Mark(page_index, HIGHLIGHT, rect, SRC_SCAN, color=_saturate(rgb), parts=[rect]))
    return _merge_lines(marks)


def is_highlighter_color(img: np.ndarray) -> np.ndarray:
    """형광펜 색 = 채도가 있으면서 밝은 색. (파랑·빨강 볼펜은 채도는 높지만 어두워서 빠진다)"""
    mx = img.max(axis=2)
    mn = img.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    lum = 0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]
    return (sat > 0.18) & (lum > 0.6)


def highlight_boxes(cells: np.ndarray, rx: int = 2, ry: int = 1):
    """형광펜 칸들의 덩어리. 글자 획 때문에 생긴 구멍·틈을 메운 뒤 찾고, 메운 만큼 다시 줄인다."""
    h, w = cells.shape
    grown = np.zeros_like(cells)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            src = cells[max(0, -dy) : h - max(0, dy), max(0, -dx) : w - max(0, dx)]
            grown[max(0, dy) : h - max(0, -dy), max(0, dx) : w - max(0, -dx)] |= src
    for (y0, x0, y1, x1), _ in _components(grown):
        sub = cells[y0:y1, x0:x1]
        if not sub.any():
            continue
        ys, xs = np.nonzero(sub)
        box = (y0 + ys.min(), x0 + xs.min(), y0 + ys.max() + 1, x0 + xs.max() + 1)
        inner = grown[box[0] : box[2], box[1] : box[3]]
        yield box, float(inner.mean())


def _components(cells: np.ndarray):
    """켜진 칸들의 연결 덩어리 → (사각형, 채움 비율)."""
    h, w = cells.shape
    seen = np.zeros_like(cells, dtype=bool)
    for sy in range(h):
        row = cells[sy]
        for sx in np.flatnonzero(row & ~seen[sy]):
            if seen[sy, sx]:
                continue
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            y0 = y1 = sy
            x0 = x1 = sx
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                y0, y1, x0, x1 = min(y0, y), max(y1, y), min(x0, x), max(x1, x)
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and cells[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            box = (y0, x0, y1 + 1, x1 + 1)
            yield box, n / ((y1 - y0 + 1) * (x1 - x0 + 1))


def _saturate(rgb):
    """종이 위 형광펜은 연하게 찍히므로 색 이름을 고를 때는 채도를 올려서 본다."""
    r, g, b = rgb
    m = min(rgb)
    M = max(rgb)
    if M - m < 1e-3:
        return rgb
    return tuple((c - m) / (M - m) * 0.9 + 0.1 for c in (r, g, b))


def _merge_lines(marks: list[Mark]) -> list[Mark]:
    """같은 색으로 이어서 칠한 여러 줄을 한 덩어리로."""
    marks.sort(key=lambda m: (m.rect[1], m.rect[0]))
    out: list[Mark] = []
    for m in marks:
        if out:
            p = out[-1]
            line_h = p.rect[3] - p.rect[1]
            if (
                color_key(p.color) == color_key(m.color)
                and 0 <= m.rect[1] - p.rect[3] <= max(8, 0.8 * line_h)
            ):
                p.rect = (min(p.rect[0], m.rect[0]), p.rect[1], max(p.rect[2], m.rect[2]), m.rect[3])
                p.parts.extend(m.parts)
                continue
        out.append(m)
    return out
