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
    marks, _ = extract(doc, Options(texts=TextCache(doc, ocr="auto")))
    got = [m.text for m in sorted(marks, key=lambda m: m.rect[1])]
    print(got)
    # 글자 인식은 낱말 하나쯤 틀릴 수 있으므로 '그 문장을 찾았는지'를 비슷한 정도로 본다
    from difflib import SequenceMatcher

    def similar(a, b):
        return SequenceMatcher(None, a.replace(" ", ""), b.replace(" ", "")).ratio()

    assert got[0].startswith("보안 기능이")
    assert similar(got[0], "보안 기능이 없으며 community") >= 0.6
    assert "데이터 인증" in got[1]
