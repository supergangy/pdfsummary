"""필기 앱(mobile)의 노트 → 표시가 들어간 PDF.

앱은 원본 PDF와 '획'(펜·형광펜, 쪽 좌표)을 따로 갖고 있다. 요약할 때는 획을 표준 PDF 잉크 주석으로 넣어
기존 분석이 그대로 읽게 한다: 반투명 잉크 = 형광펜(아래 글자를 읽음), 불투명 잉크 = 펜(밑줄·동그라미·손글씨).
추측할 필요가 없어서 책에 인쇄된 색칠과 섞이지 않는다.

spec = {"title": "...", "pages": [{"w": 595, "h": 842, "pdf": 0, "strokes": [
          {"tool": "pen"|"highlighter", "color": "#RRGGBB", "width": 2, "pts": [x, y, p, x, y, p, ...]}]}]}
좌표는 화면에 보이는 쪽(회전 반영) 기준, 왼쪽 위가 0.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Optional

import pymupdf

MAX_PAGES = 3000
MAX_STROKES = 20000      # 쪽마다
MAX_POINTS = 20000       # 획마다 (x, y, p 묶음 수)
HIGHLIGHT_OPACITY = 0.38
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class NoteError(ValueError):
    pass


def _rgb(c: str) -> tuple[float, float, float]:
    if not HEX.match(c or ""):
        return (0.0, 0.0, 0.0)
    n = int(c[1:], 16)
    return ((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255)


def _num(v, lo: float, hi: float) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return min(hi, max(lo, f))


def check_spec(spec: dict, has_source: bool, source_pages: int = 0) -> list[dict]:
    """앱이 보낸 노트를 확인하고 정리한다 (크기 제한, 숫자, 색)."""
    if not isinstance(spec, dict):
        raise NoteError("노트 내용이 없습니다.")
    pages = spec.get("pages")
    if not isinstance(pages, list) or not pages:
        raise NoteError("노트에 쪽이 없습니다.")
    if len(pages) > MAX_PAGES:
        raise NoteError(f"쪽이 너무 많습니다 ({MAX_PAGES}쪽까지).")
    out = []
    for p in pages:
        if not isinstance(p, dict):
            raise NoteError("쪽 정보가 잘못되었습니다.")
        w, h = _num(p.get("w"), 10, 14400), _num(p.get("h"), 10, 14400)
        if w is None or h is None:
            raise NoteError("쪽 크기가 잘못되었습니다.")
        src = p.get("pdf")
        if src is not None:
            if not has_source or not isinstance(src, int) or not 0 <= src < source_pages:
                raise NoteError("원본 PDF의 쪽 번호가 맞지 않습니다.")
        strokes = p.get("strokes") or []
        if not isinstance(strokes, list) or len(strokes) > MAX_STROKES:
            raise NoteError("획이 너무 많습니다.")
        clean = []
        for s in strokes:
            if not isinstance(s, dict) or s.get("tool") not in ("pen", "highlighter"):
                continue
            pts = s.get("pts")
            if not isinstance(pts, list) or len(pts) < 3 or len(pts) > MAX_POINTS * 3:
                continue
            xy = []
            for i in range(0, len(pts) - 2, 3):
                x, y = _num(pts[i], -w, 2 * w), _num(pts[i + 1], -h, 2 * h)
                if x is None or y is None:
                    break
                xy.append((x, y))
            if not xy:
                continue
            width = _num(s.get("width"), 0.2, 60) or 1.0
            clean.append({"tool": s["tool"], "color": s.get("color") or "#000000", "width": width, "pts": xy})
        out.append({"w": w, "h": h, "pdf": src, "strokes": clean})
    return out


def build_note_pdf(spec: dict, source: Optional[Path], out_path: Path) -> int:
    """노트(spec)를 PDF로: 원본 쪽(또는 빈 쪽) + 획을 잉크 주석으로. 돌려주는 값: 쪽 수."""
    src = pymupdf.open(source) if source else None
    try:
        pages = check_spec(spec, src is not None, src.page_count if src else 0)
        doc = pymupdf.open()
        try:
            for p in pages:
                if p["pdf"] is not None:
                    doc.insert_pdf(src, from_page=p["pdf"], to_page=p["pdf"], annots=True)
                else:
                    doc.new_page(width=p["w"], height=p["h"])
                page = doc[-1]
                _add_strokes(page, p)
            title = str(spec.get("title") or "")[:200]
            if title:
                doc.set_metadata({**(doc.metadata or {}), "title": title})
            doc.save(out_path, garbage=3, deflate=True)
            return doc.page_count
        finally:
            doc.close()
    finally:
        if src is not None:
            src.close()


def _add_strokes(page: pymupdf.Page, p: dict) -> None:
    # 화면 좌표 → PyMuPDF 쪽 좌표 (돌린 쪽이면 되돌리고, 앱이 본 크기와 다르면 맞춘다)
    rect = page.rect
    sx, sy = rect.width / p["w"], rect.height / p["h"]
    m = page.derotation_matrix
    groups: dict[tuple, list] = {}
    for s in p["strokes"]:
        key = (s["tool"], s["color"], round(s["width"], 2))
        groups.setdefault(key, []).append([pymupdf.Point(x * sx, y * sy) * m for x, y in s["pts"]])
    # 형광펜 먼저 (밑에 깔리게)
    for (tool, color, width), paths in sorted(groups.items(), key=lambda kv: kv[0][0] != "highlighter"):
        for k in range(0, len(paths), 200):   # 주석 하나가 너무 커지지 않게
            chunk = [pp if len(pp) > 1 else [pp[0], pp[0] + (0.01, 0)] for pp in paths[k:k + 200]]
            a = page.add_ink_annot([[(q.x, q.y) for q in pp] for pp in chunk])
            a.set_colors(stroke=_rgb(color))
            a.set_border(width=width)
            a.set_opacity(HIGHLIGHT_OPACITY if tool == "highlighter" else 1.0)
            a.set_info(title="필기 요약", subject="형광펜" if tool == "highlighter" else "펜")
            a.update()
