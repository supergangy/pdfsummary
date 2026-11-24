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


def test_bullet_dots_are_not_handwriting(tmp_path):
    """꾸민 정리 PDF의 글머리 점(•, 곡선 8개로 그린 작은 채운 동그라미)은 손글씨가 아니다.
    같은 쪽에 손으로 그은 둥근 끝 곡선은 그대로 찾는다."""
    import math

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for k in range(6):
        cx, cy, r = 60, 100 + k * 24, 2
        sh = page.new_shape()
        pts = [pymupdf.Point(cx + r * math.cos(a * math.pi / 4), cy + r * math.sin(a * math.pi / 4)) for a in range(9)]
        for a in range(8):  # 곡선 8개로 된 동그라미 (점 글꼴을 벡터로 바꾼 모양)
            p0, p3 = pts[a], pts[a + 1]
            sh.draw_bezier(p0, p0 + (p3 - p0) * 0.33, p0 + (p3 - p0) * 0.66, p3)
        sh.finish(color=None, fill=(0.5, 0.34, 0.2), closePath=True)
        sh.commit()
        page.insert_text((70, cy + 4), "글머리 점이 붙은 정리 줄입니다", fontname="korea", fontsize=11)
    # 손으로 그은 곡선 하나 (둥근 끝, 불투명)
    sh = page.new_shape()
    sh.draw_bezier((100, 400), (140, 360), (180, 440), (220, 400))
    sh.draw_bezier((220, 400), (260, 360), (300, 440), (340, 400))
    sh.draw_bezier((340, 400), (380, 360), (420, 440), (460, 400))
    sh.finish(color=(0.1, 0.1, 0.6), width=2, lineCap=1, closePath=False)
    sh.commit()
    path = tmp_path / "bullets.pdf"
    doc.save(path)

    from pdfsummary.strokes import strokes_from_drawings

    ss = strokes_from_drawings(pymupdf.open(path)[0], [], SRC_DRAWING)
    assert len(ss) == 1 and ss[0].rect[0] >= 99
