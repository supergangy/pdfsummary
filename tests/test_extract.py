import pymupdf

from pdfsummary.colors import color_key
from pdfsummary.extract import Options, extract
from pdfsummary.models import CIRCLE, HANDWRITING, HIGHLIGHT, NOTE, SRC_DRAWING, SRC_SCAN, UNDERLINE


def _marks(sample_pdf, **kw):
    doc = pymupdf.open(sample_pdf)
    marks, infos = extract(doc, Options(**kw))
    return marks, infos


def test_annotation_highlights_and_notes(sample_pdf):
    marks, _ = _marks(sample_pdf, pages=[0])
    hl = {m.text: m for m in marks if m.kind == HIGHLIGHT}
    assert "빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 만드는 과정이다." in hl
    assert color_key(hl["명반응"].color) == "pink"
    assert hl["명반응"].notes[0].text == "틸라코이드 = 명반응 장소"
    # 반투명 굵은 잉크 = 형광펜, 끝에 걸친 쉼표는 떼어 냄
    assert "이산화탄소 농도" in hl

    under = {m.text for m in marks if m.kind == UNDERLINE}
    assert under == {"ATP와 NADPH", "캘빈 회로"}
    assert [m.text for m in marks if m.kind == CIRCLE] == ["온도"]
    assert [m.text for m in marks if m.kind == NOTE] == ["시험에 자주 나옴!"]

    hands = [m for m in marks if m.kind == HANDWRITING]
    assert len(hands) == 1          # 두 줄 손글씨가 한 덩어리로 묶임
    assert hands[0].image.startswith(b"\x89PNG")
    assert "명반응" in hands[0].context


def test_flattened_drawings(sample_pdf):
    marks, _ = _marks(sample_pdf, pages=[1])
    kinds = sorted((m.kind, m.source) for m in marks)
    # 표 선(책 내용)은 잡히지 않고 형광펜 획 1개 + 손글씨 1덩어리만
    assert kinds == [(HANDWRITING, SRC_DRAWING), (HIGHLIGHT, SRC_DRAWING)]
    hl = next(m for m in marks if m.kind == HIGHLIGHT)
    assert hl.text == "포도당 1분자가 피루브산"
    assert color_key(hl.color) == "yellow"


def test_no_drawings_option(sample_pdf):
    marks, _ = _marks(sample_pdf, pages=[1], drawings=False)
    assert marks == []


def test_scanned_page(sample_pdf):
    marks, infos = _marks(sample_pdf, pages=[2])
    assert infos[2].scanned
    assert len(marks) == 1
    m = marks[0]
    assert (m.kind, m.source, color_key(m.color)) == (HIGHLIGHT, SRC_SCAN, "yellow")
    assert m.text == "" and m.image  # 글자층이 없으니 원본 이미지로
    # 칠한 부분: 셋째 문단 첫 줄 왼쪽
    assert m.rect[0] < 90 and m.rect[2] > 200


def test_scan_off(sample_pdf):
    marks, _ = _marks(sample_pdf, pages=[2], scan="off")
    assert marks == []


def test_printed_color_is_not_highlight(tmp_path):
    """문제집에 원래 인쇄된 색 글씨·머리 띠·뱃지는 형광펜이 아니다. 학생이 그은 형광펜만 찾는다."""
    import make_sample

    path = tmp_path / "printed.pdf"
    make_sample.make_printed_color_scan(str(path))
    marks, _ = extract(pymupdf.open(path), Options())
    got = sorted((round(m.rect[1]), color_key(m.color)) for m in marks)
    assert [c for _, c in got] == ["yellow", "blue"]
    assert 125 <= got[0][0] <= 135 and 215 <= got[1][0] <= 225
