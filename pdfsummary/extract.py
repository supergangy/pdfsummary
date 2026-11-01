"""PDF 한 권에서 형광펜·밑줄·손글씨·메모를 모두 찾아 Mark 목록으로 만든다."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import pymupdf

from . import diff, scan
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
from .pagetext import PageText, join_chars, span_of
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


class TextCache:
    """쪽마다 인쇄 글자를 한 번만 읽어 둔다.
    필기본에 글자층이 없으면 원본의 글자층을, 그래도 없으면(스캔본) 기기 안 글자 인식(OCR)으로 읽는다."""

    def __init__(self, doc: pymupdf.Document, original: Optional[pymupdf.Document] = None,
                 ocr: str = "off", log: Callable[[str], None] = lambda s: None):
        self.doc = doc
        self.original = original
        self.ocr_mode = ocr          # auto: 글자층 없는 그림 쪽만 인식 / off
        self.log = log
        self._cache: dict[int, PageText] = {}
        self._plain: dict[int, PageText] = {}   # 글자 인식 없이 읽은 것
        self._engine = None
        self._engine_failed = False
        self._digest: Optional[str] = None
        self.ocr_pages = 0

    def get(self, i: int, ocr: bool = True) -> Optional[PageText]:
        """ocr=False면 글자 인식은 하지 않는다 (먼저 표시가 있는지만 볼 때 — 글자 인식은 쪽마다 몇 초 걸린다)."""
        if i < 0 or i >= self.doc.page_count:
            return None
        if i in self._cache:
            return self._cache[i]
        if i not in self._plain:
            page = self.doc[i]
            pt = PageText(page)
            if not pt.has_text and self.original is not None and i < self.original.page_count:
                orig = self.original[i]
                if _same_size(page, orig):
                    pt = PageText(orig)   # 필기본이 그림으로 굳어졌어도 원본에는 글자층이 있을 수 있다
            self._plain[i] = pt
        pt = self._plain[i]
        if not ocr or not self.needs_ocr(i):
            if pt.has_text or self.ocr_mode == "off":
                self._cache[i] = pt
            return pt
        self._cache[i] = self._ocr(self.doc[i], i) or pt
        return self._cache[i]

    def needs_ocr(self, i: int) -> bool:
        pt = self._plain.get(i)
        if pt is None:
            pt = self.get(i, ocr=False)
        return (self.ocr_mode != "off" and not self._engine_failed and not pt.has_text
                and bool(self.doc[i].get_images()))

    def _ocr(self, page: pymupdf.Page, i: int) -> Optional[PageText]:
        if self._engine_failed:
            return None
        if self._engine is None:
            from .ocr import OcrEngine

            self._engine = OcrEngine(self.log)
            if not self._engine.ready:
                self._engine_failed = True
                self.log(f"ℹ️  {self._engine.error} 스캔 쪽 글자는 그림으로 넣습니다.")
                return None
        if self._digest is None:
            import hashlib

            from pathlib import Path

            data = Path(self.doc.name).read_bytes() if self.doc.name else self.doc.tobytes()
            self._digest = hashlib.sha256(data).hexdigest()[:24]
        from .ocr import OCR_DPI

        self.ocr_pages += 1
        if self.ocr_pages == 1 or self.ocr_pages % 10 == 0:
            self.log(f"  🔤 스캔 쪽 글자 읽는 중… ({i + 1}쪽)")
        lines = self._engine.read_page(page, cache_key=f"{self._digest}_{i}_{OCR_DPI}")
        return PageText.from_ocr(lines, page.rect.height)

    def all(self, upto: Optional[int] = None, ocr_pages: Optional[set[int]] = None) -> dict[int, PageText]:
        """ocr_pages를 주면 그 쪽들만 글자 인식을 한다 (나머지 스캔 쪽은 글자 없이)."""
        n = self.doc.page_count if upto is None else min(upto + 1, self.doc.page_count)
        return {i: self.get(i, ocr=ocr_pages is None or i in ocr_pages) for i in range(n)}


@dataclass
class Options:
    pages: Optional[list[int]] = None   # 0부터 시작. None이면 전체
    drawings: bool = True               # 페이지에 굳어진 펜 획도 찾기 (GoodNotes 등)
    scan: str = "auto"                  # auto / on / off : 스캔 이미지에서 형광펜 색 찾기
    image_dpi: int = 200                # 원본 이미지로 잘라낼 때 해상도
    original: Optional[pymupdf.Document] = None  # 필기 전 원본 PDF (있으면 책 자체의 색칠·선은 뺀다)
    texts: Optional[TextCache] = None             # 쪽 글자 캐시 (없으면 새로 만든다)


@dataclass
class PageInfo:
    index: int
    line_height: float
    width: float
    scanned: bool


def extract(doc: pymupdf.Document, opts: Options, log: Callable[[str], None] = lambda s: None):
    pages = opts.pages if opts.pages is not None else range(doc.page_count)
    if opts.texts is None:
        opts.texts = TextCache(doc, opts.original)
    marks: list[Mark] = []
    infos: dict[int, PageInfo] = {}
    for i in pages:
        page = doc[i]
        orig = opts.original[i] if opts.original is not None and i < opts.original.page_count else None
        try:
            found, info = extract_page(page, i, opts, orig)
        except diff.PageMismatch:
            log(f"  ! p.{i + 1}: 원본과 쪽 모양이 달라 비교하지 않고 찾습니다.")
            found, info = extract_page(page, i, opts, None)
        infos[i] = info
        if found:
            log(f"  p.{i + 1}: {len(found)}개")
        marks.extend(found)
    return marks, infos


def extract_page(
    page: pymupdf.Page, index: int, opts: Options, original: Optional[pymupdf.Page] = None
) -> tuple[list[Mark], PageInfo]:
    if opts.texts is None:
        return _extract_page(page, index, opts, original, PageText(page))
    # 먼저 글자 인식 없이 표시를 찾고, 스캔 쪽에 표시가 있을 때만 글자를 인식해서 다시 읽는다
    marks, info = _extract_page(page, index, opts, original, opts.texts.get(index, ocr=False))
    if marks and opts.texts.needs_ocr(index):
        marks, info = _extract_page(page, index, opts, original, opts.texts.get(index))
    return marks, info


def _extract_page(
    page: pymupdf.Page, index: int, opts: Options, original: Optional[pymupdf.Page], pt: PageText
) -> tuple[list[Mark], PageInfo]:
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
            chars = pt.in_rects(parts)
            m = Mark(index, TEXT_MARKUP[t], rect, SRC_ANNOT, color, text=join_chars(chars), parts=parts, span=span_of(chars))
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
                marks.append(Mark(index, CIRCLE, rect, SRC_ANNOT, color, text=join_chars(inner), span=span_of(inner)))
            if content:
                marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

        elif t in (pymupdf.PDF_ANNOT_TEXT, pymupdf.PDF_ANNOT_FREE_TEXT):
            if content:
                marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

        elif content:  # 그 밖의 주석이라도 적어 둔 글이 있으면 메모로
            marks.append(Mark(index, NOTE, rect, SRC_ANNOT, color, text=content))

    if opts.drawings:
        book = _signatures(strokes_from_drawings(original, [], SRC_DRAWING)) if original is not None else set()
        for s in strokes_from_drawings(page, annot_rects, SRC_DRAWING):
            if _signature(s) in book:   # 원본에도 있는 선 = 책 자체의 것
                continue
            if is_highlighter(s, lh):
                marks.append(highlight_from_stroke(s, pt, index))
            else:
                pen.append(s)

    for group in cluster_strokes(pen, dist=max(6.0, 0.7 * lh)):
        marks.append(classify_pen_group(group, pt, index, lh))

    if original is not None:
        # 원본과 다른 부분 중 아직 못 찾은 것 (그림으로 굳은 필기 등)
        known = [m.rect for m in marks] + annot_rects
        marks.extend(diff.added_marks(page, original, pt, index, lh, known))
    elif opts.scan == "on" or (opts.scan == "auto" and scanned):
        for m in scan.find_highlights(page, index):
            if pt.has_text:   # OCR된 스캔본이면 글자층에서 바로 읽는다
                chars = pt.in_rects(m.parts or [m.rect])
                m.text, m.span = join_chars(chars), span_of(chars)
            marks.append(m)

    # 원본 이미지 잘라 두기: 손글씨, 그리고 글자를 못 읽은 표시
    for m in marks:
        if m.kind == HANDWRITING or (m.kind != NOTE and not m.text):
            m.image = crop_png(page, m.rect, opts.image_dpi)

    return marks, PageInfo(index, lh, page.rect.width, scanned)


def _same_size(a: pymupdf.Page, b: pymupdf.Page) -> bool:
    return abs(a.rect.width - b.rect.width) < 1 and abs(a.rect.height - b.rect.height) < 1


def _signature(s: Stroke):
    return (tuple(round(v) for v in s.rect), tuple(round(c, 2) for c in (s.color or ())))


def _signatures(strokes: list[Stroke]) -> set:
    return {_signature(s) for s in strokes}


def crop_png(page: pymupdf.Page, rect: Rect, dpi: int) -> bytes:
    clip = pymupdf.Rect(expand(rect, 4)) & page.rect
    if clip.is_empty:
        clip = page.rect
    # 작은 손글씨는 해상도를 올려 AI가 읽기 쉽게(긴 변 600px 이상), 너무 큰 영역은 낮춰서 2000px 이하로
    longest = max(clip.width, clip.height) / 72 * dpi
    if longest < 600:
        dpi = min(400, int(dpi * 600 / max(longest, 1)))
    elif longest > 2000:
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
