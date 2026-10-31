"""PDF 한 권에서 형광펜·밑줄·손글씨·메모를 모두 찾아 Mark 목록으로 만든다."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import pymupdf

from . import scan
from .models import (
    CIRCLE,
    HANDWRITING,
    HIGHLIGHT,
    NOTE,
    SRC_ANNOT,
    SRC_DRAWING,
    STRIKEOUT,
    UNDERLINE,
    Mark,
    Rect,
    expand,
)
from .pagetext import PageText, join_chars
from .strokes import (
    Stroke,
    classify_pen_group,
    cluster_strokes,
    highlight_from_stroke,
    is_highlighter,
    strokes_from_drawings,
    strokes_from_ink_annot,
)

TEXT_MARKUP = {
    pymupdf.PDF_ANNOT_HIGHLIGHT: HIGHLIGHT,
    pymupdf.PDF_ANNOT_UNDERLINE: UNDERLINE,
    pymupdf.PDF_ANNOT_SQUIGGLY: UNDERLINE,
    pymupdf.PDF_ANNOT_STRIKE_OUT: STRIKEOUT,
}


@dataclass
class Options:
    pages: Optional[list[int]] = None   # 0부터 시작. None이면 전체
    drawings: bool = True               # 페이지에 굳어진 펜 획도 찾기 (GoodNotes 등)
    scan: str = "auto"                  # auto / on / off : 스캔 이미지에서 형광펜 색 찾기
    image_dpi: int = 200                # 원본 이미지로 잘라낼 때 해상도


@dataclass
class PageInfo:
    index: int
    line_height: float
    width: float
    scanned: bool


def extract(doc: pymupdf.Document, opts: Options, log: Callable[[str], None] = lambda s: None):
    pages = opts.pages if opts.pages is not None else range(doc.page_count)
    marks: list[Mark] = []
    infos: dict[int, PageInfo] = {}
    for i in pages:
        page = doc[i]
        found, info = extract_page(page, i, opts)
        infos[i] = info
        if found:
            log(f"  p.{i + 1}: {len(found)}개")
        marks.extend(found)
    return marks, infos


def extract_page(page: pymupdf.Page, index: int, opts: Options) -> tuple[list[Mark], PageInfo]:
    pt = PageText(page)
    lh = pt.line_height()
    scanned = scan.is_scanned_page(page)
    marks: list[Mark] = []
    annot_rects: list[Rect] = []
    pen: list[Stroke] = []

    for annot in page.annots() or []:
        t = annot.type[0]
        if t == pymupdf.PDF_ANNOT_POPUP:
            continue
        rect = tuple(annot.rect)
        annot_rects.append(rect)
        content = (annot.info.get("content") or "").strip()
        color = _annot_color(annot)

        if t in TEXT_MARKUP:
            parts = _quad_rects(annot) or [rect]
            m = Mark(index, TEXT_MARKUP[t], rect, SRC_ANNOT, color, text=join_chars(pt.in_rects(parts)), parts=parts)
            if content and content != m.text:
                m.notes.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))
            marks.append(m)

        elif t == pymupdf.PDF_ANNOT_INK:
            for s in strokes_from_ink_annot(annot, SRC_ANNOT):
                if is_highlighter(s, lh):
                    marks.append(highlight_from_stroke(s, pt, index))
                else:
                    pen.append(s)
            if content:
                marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

        elif t in (pymupdf.PDF_ANNOT_LINE, pymupdf.PDF_ANNOT_POLY_LINE, pymupdf.PDF_ANNOT_POLYGON):
            pts = [(float(x), float(y)) for x, y in (annot.vertices or [])]
            if len(pts) >= 2:
                w = (annot.border or {}).get("width") or 1.0
                pen.append(Stroke(pts, rect, float(w), color, 1.0, SRC_ANNOT))

        elif t in (pymupdf.PDF_ANNOT_SQUARE, pymupdf.PDF_ANNOT_CIRCLE):
            inner = pt.in_rects([rect])
            if inner:
                marks.append(Mark(index, CIRCLE, rect, SRC_ANNOT, color, text=join_chars(inner)))
            if content:
                marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

        elif t in (pymupdf.PDF_ANNOT_TEXT, pymupdf.PDF_ANNOT_FREE_TEXT):
            if content:
                marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

        elif content:  # 그 밖의 주석이라도 적어 둔 글이 있으면 메모로
            marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

    if opts.drawings:
        for s in strokes_from_drawings(page, annot_rects, SRC_DRAWING):
            if is_highlighter(s, lh):
                marks.append(highlight_from_stroke(s, pt, index))
            else:
                pen.append(s)

    for group in cluster_strokes(pen, dist=max(6.0, 0.7 * lh)):
        marks.append(classify_pen_group(group, pt, index, lh))

    if opts.scan == "on" or (opts.scan == "auto" and scanned):
        for m in scan.find_highlights(page, index):
            if pt.has_text:   # OCR된 스캔본이면 글자층에서 바로 읽는다
                m.text = join_chars(pt.in_rects(m.parts or [m.rect]))
            marks.append(m)

    # 원본 이미지 잘라 두기: 손글씨, 그리고 글자를 못 읽은 표시
    for m in marks:
        if m.kind == HANDWRITING or (m.kind != NOTE and not m.text):
            m.image = crop_png(page, m.rect, opts.image_dpi)

    return marks, PageInfo(index, lh, page.rect.width, scanned)


def crop_png(page: pymupdf.Page, rect: Rect, dpi: int) -> bytes:
    clip = pymupdf.Rect(expand(rect, 4)) & page.rect
    if clip.is_empty:
        clip = page.rect
    # 너무 큰 영역은 해상도를 낮춰 이미지가 지나치게 커지지 않게
    longest = max(clip.width, clip.height) / 72 * dpi
    if longest > 2000:
        dpi = max(72, int(dpi * 2000 / longest))
    pix = page.get_pixmap(dpi=dpi, clip=clip, annots=True)
    return pix.tobytes("png")


def _annot_color(annot: pymupdf.Annot):
    cols = annot.colors or {}
    c = cols.get("stroke") or cols.get("fill")
    return tuple(c) if c else None


def _quad_rects(annot: pymupdf.Annot) -> list[Rect]:
    v = annot.vertices or []
    out = []
    for k in range(0, len(v) - 3, 4):
        q = pymupdf.Quad(v[k], v[k + 1], v[k + 2], v[k + 3])
        out.append(tuple(q.rect))
    return out
