import pymupdf
import pytest

from pdfsummary.cli import main
from pdfsummary.colors import ColorFilter, color_key, from_hex, to_hex
from pdfsummary.extract import Options, extract
from pdfsummary.models import HANDWRITING, HIGHLIGHT, SRC_DIFF, SRC_DRAWING
from pdfsummary.scan import is_scanned_page


def found(pdf, **kw):
    marks, _ = extract(pymupdf.open(pdf), Options(**kw))
    return sorted((m.kind, m.source, m.text) for m in marks)


def test_without_original_book_highlight_is_confused(book_pair):
    _, ann = book_pair
    texts = {t for k, _, t in found(ann) if k == HIGHLIGHT}
    # 책 자체의 반투명 강조(기질 특이성)는 원본 없이는 구분할 수 없다
    assert "기질 특이성" in texts
    # 불투명 강조와 직선 밑줄은 손으로 그은 것으로 보지 않는다
    assert "생체 촉매" not in texts
    assert not any(k == "underline" for k, _, _ in found(ann))


def test_original_keeps_only_my_marks(book_pair):
    orig, ann = book_pair
    marks = found(ann, original=pymupdf.open(orig))
    assert marks == [
        (HANDWRITING, SRC_DIFF, ""),
        (HIGHLIGHT, SRC_DIFF, "가장 높다"),        # 그림으로 굳은 형광펜도 찾음
        (HIGHLIGHT, SRC_DRAWING, "경쟁적 저해제"),
        (HIGHLIGHT, SRC_DRAWING, "활성화 에너지를"),
    ]


def test_overlay_image_is_not_a_scan(book_pair):
    _, ann = book_pair
    assert not is_scanned_page(pymupdf.open(ann)[0])


def test_color_filter():
    f = ColorFilter(["#F5E663", "분홍"])
    assert f.accepts(from_hex("#F5E563"), "drawing")       # 거의 같은 색
    assert not f.accepts(from_hex("#FFF28C"), "drawing")   # 책의 다른 노랑
    assert f.accepts((1, 0.55, 0.75), "drawing")           # 분홍 계열
    assert f.accepts((1, 0.95, 0.6), "diff")               # 원본 비교로 찾은 건 계열로 비교
    assert not f.accepts((0.4, 0.9, 0.4), "diff")
    assert not ColorFilter([])
    with pytest.raises(ValueError):
        ColorFilter(["하늘색"])


def test_hex_roundtrip():
    assert to_hex(from_hex("#f5e663")) == "#F5E663"
    assert color_key(from_hex("F80")) == "orange"


def test_cli_color_filter_and_list(book_pair, tmp_path, capsys):
    _, ann = book_pair
    assert main([str(ann), "--list-colors"]) == 0
    out = capsys.readouterr().out
    assert "#FFF28C" in out and "#F5E563" in out
    assert main([str(ann), "-o", str(tmp_path / "o"), "--no-ai", "--format", "md", "--color", "#F5E663,분홍"]) == 0
    md = (tmp_path / "o" / "요약.md").read_text(encoding="utf-8")
    assert "활성화 에너지를" in md and "경쟁적 저해제" in md and "기질 특이성" not in md


def test_cli_original(book_pair, tmp_path):
    orig, ann = book_pair
    assert main([str(ann), "-o", str(tmp_path / "o"), "--no-ai", "--format", "md", "--original", str(orig)]) == 0
    md = (tmp_path / "o" / "요약.md").read_text(encoding="utf-8")
    assert "**기질 특이성**" not in md and "**생체 촉매**" not in md   # 책 자체 강조는 표시로 잡히지 않음 (문맥으로는 보일 수 있음)
    assert "**가장 높다**" in md and "✍️" in md
