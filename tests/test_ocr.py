import pymupdf
import pytest

import pdfsummary.ocr as ocr
from pdfsummary.extract import Options, TextCache, extract
from pdfsummary.ocr import OcrLine, align_chars
from pdfsummary.organize import add_sentences
from pdfsummary.pagetext import PageText, join_chars


def lines_from_text_layer(page) -> list[OcrLine]:
    """글자층이 있는 쪽에서 '완벽한 글자 인식' 결과를 흉내 낸다 (줄 상자 + 글자는 폭을 나눠서)."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line["spans"]).strip()
            if text:
                box = tuple(line["bbox"])
                out.append(OcrLine(text, box, 0.99, align_chars(text, box, [])))
    return out


class FakeEngine:
    def __init__(self, lines):
        self.lines = lines
        self.ready = True
        self.error = None
        self.calls = 0

    def read_page(self, page, cache_key=None):
        self.calls += 1
        return self.lines


def test_align_chars_spaces_and_glyph_boxes():
    chars = align_chars("SNMP 접근", (0, 10, 60, 20), [("SNMP", (0, 24)), ("접", (30, 45)), ("근", (45, 60))])
    assert [c for c, _ in chars] == list("SNMP 접근")
    assert chars[0][1] == (0, 10, 6, 20)        # SNMP 상자를 네 글자가 나눔
    assert chars[4][1][0] == 24 and chars[4][1][2] == 30   # 띄어쓰기는 앞뒤 글자 사이
    # 엔진 글자 상자 개수가 안 맞으면 폭을 나눔 (한글은 넓게)
    prop = align_chars("가a", (0, 0, 31, 10), [])
    assert prop[0][1][2] > 19


def test_from_ocr_groups_rows_and_blocks():
    lines = [
        OcrLine("1. 광합성", (60, 70, 160, 88), 1, align_chars("1. 광합성", (60, 70, 160, 88), [])),
        OcrLine("빛 에너지를 이용하여", (60, 100, 300, 112), 1, align_chars("빛 에너지를 이용하여", (60, 100, 300, 112), [])),
        OcrLine("포도당을 만든다.", (60, 116, 240, 128), 1, align_chars("포도당을 만든다.", (60, 116, 240, 128), [])),
        OcrLine("(12쪽)", (305, 101, 350, 111), 1, align_chars("(12쪽)", (305, 101, 350, 111), [])),
    ]
    pt = PageText.from_ocr(lines, 800)
    assert pt.ocr
    assert [ln.text for ln in pt.lines] == ["1. 광합성", "빛 에너지를 이용하여", "(12쪽)", "포도당을 만든다."]
    assert pt.lines[0].block_id != pt.lines[1].block_id      # 제목(큰 글자)과 본문은 다른 문단
    assert pt.lines[1].block_id == pt.lines[3].block_id      # 이어진 본문 줄은 같은 문단


def test_scanned_highlight_text_via_ocr(tmp_path, monkeypatch):
    import make_sample

    scan, src = tmp_path / "scan.pdf", tmp_path / "src.pdf"
    make_sample.make_printed_color_scan(str(scan), str(src))
    fake = FakeEngine(lines_from_text_layer(pymupdf.open(src)[0]))
    monkeypatch.setattr(ocr, "OcrEngine", lambda log=None, **k: fake)

    doc = pymupdf.open(scan)
    texts = TextCache(doc, ocr="auto")
    marks, _ = extract(doc, Options(texts=texts))
    got = sorted((m.rect[1], m.text) for m in marks)
    assert got[0][1].startswith("보안 기능이 없으며 community string만")   # 형광펜이 끝나는 곳까지 (글자 폭 어림이라 한두 글자 차이)
    assert "SNMPv3는 데이터 인증" in got[1][1]
    assert fake.calls == 1      # 표시가 있는 쪽만 한 번 인식
    add_sentences(marks, texts.get)


def test_no_ocr_for_pages_without_marks(tmp_path, monkeypatch):
    fake = FakeEngine([])
    monkeypatch.setattr(ocr, "OcrEngine", lambda log=None, **k: fake)
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(page.rect, stream=pymupdf.open().new_page().get_pixmap().tobytes("png"))  # 빈 스캔 쪽
    extract(doc, Options(texts=TextCache(doc, ocr="auto")))
    assert fake.calls == 0


def test_ocr_off_and_missing_model(tmp_path):
    import make_sample

    scan = tmp_path / "scan.pdf"
    make_sample.make_printed_color_scan(str(scan))
    doc = pymupdf.open(scan)
    msgs = []
    marks, _ = extract(doc, Options(texts=TextCache(doc, ocr="auto", log=msgs.append)))
    assert all(m.text == "" and m.image for m in marks)          # 모델이 없으면 그림으로
    assert any("글자 인식 모델" in m for m in msgs)


# ── 실제 한국어 모델 (CI처럼 모델을 받을 수 있는 곳에서만) ─────────────────────

def _real_model():
    return ocr.find_model()


@pytest.mark.real_ocr
def test_real_korean_ocr_on_scanned_textbook(tmp_path, textbook):
    if _real_model() is None:
        pytest.skip("한국어 글자 인식 모델 없음 (python -m pdfsummary.ocr --download)")
    src = pymupdf.open(textbook)
    scan = pymupdf.open()
    for p in src:   # 쪽을 그림으로 굳혀 스캔본처럼
        np_ = scan.new_page(width=p.rect.width, height=p.rect.height)
        np_.insert_image(np_.rect, stream=p.get_pixmap(dpi=150, annots=False).tobytes("png"))
    eng = ocr.OcrEngine()
    assert eng.ready, eng.error
    lines = eng.read_page(scan[0])
    text = " ".join(ln.text for ln in lines)
    for ln in lines:
        print(f"{ln.score:.2f} {ln.text}")
    # 시험용 PDF의 내장 한글 글꼴은 영문자를 한 칸씩 띄워 찍어서 영어는 확인하지 않는다 (실제 책은 정상 간격)
    for word in ("광합성", "명반응", "틸라코이드", "세포질", "산소가 필요 없다"):
        assert word in text, word
    pt = PageText.from_ocr(lines, scan[0].rect.height)
    assert "광합성" in join_chars(pt.chars)


@pytest.mark.real_ocr
def test_real_korean_ocr_highlight_pipeline(tmp_path):
    if _real_model() is None:
        pytest.skip("한국어 글자 인식 모델 없음")
    import make_sample

    scan = tmp_path / "scan.pdf"
    make_sample.make_printed_color_scan(str(scan))
    doc = pymupdf.open(scan)
    texts = TextCache(doc, ocr="auto")
    marks, _ = extract(doc, Options(texts=texts))
    got = [m.text for m in sorted(marks, key=lambda m: m.rect[1])]
    print(got)
    for dpi in (200, 300):   # 진단: 해상도별 줄 인식 결과
        ocr.OCR_DPI = dpi
        try:
            for ln in ocr.OcrEngine().read_page(doc[0]):
                print(dpi, f"{ln.score:.2f}", ln.text)
        finally:
            ocr.OCR_DPI = 200
    assert got[0].startswith("보안 기능이 없으며")
    assert "데이터 인증" in got[1]
