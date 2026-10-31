import json

import pytest

from pdfsummary.cli import main, parse_pages
from pdfsummary.colors import color_key, parse_label


@pytest.mark.parametrize(
    "rgb,key",
    [((1, 1, 0), "yellow"), ((1, 0.6, 0.8), "pink"), ((0.3, 0.9, 0.3), "green"), ((0.2, 0.5, 1), "blue"),
     ((1, 0.55, 0.1), "orange"), ((0.9, 0.1, 0.1), "red"), ((0.6, 0.3, 0.9), "purple"), ((0, 0, 0), "black")],
)
def test_color_key(rgb, key):
    assert color_key(rgb) == key


def test_parse_label():
    assert parse_label("노랑=핵심") == ("yellow", "핵심")
    assert parse_label("Pink = 정의") == ("pink", "정의")
    with pytest.raises(ValueError):
        parse_label("하늘색=x")


def test_parse_pages():
    assert parse_pages("1-3,5,9-", 10) == [0, 1, 2, 4, 8, 9]
    with pytest.raises(ValueError):
        parse_pages("0-3", 10)


def test_cli_end_to_end(sample_pdf, tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = tmp_path / "out"
    rc = main([str(sample_pdf), "-o", str(out), "--format", "html,md,json", "--label", "노랑=핵심"])
    assert rc == 0
    html = (out / "요약.html").read_text(encoding="utf-8")
    md = (out / "요약.md").read_text(encoding="utf-8")
    data = json.loads((out / "요약.json").read_text(encoding="utf-8"))
    assert "<title>생명과학 정리 노트(예시) 필기 요약</title>" in html
    assert "노랑 · 핵심" in html
    assert "## 1. 광합성의 개요" in md and "## 3. 유전자 발현" in md
    assert [s["title"] for s in data["sections"]] == ["1. 광합성의 개요", "2. 세포 호흡", "3. 유전자 발현"]
    # 손글씨는 AI 없이 원본 이미지로 들어감
    assert len(list((out / "images").glob("*.png"))) == 3


def test_cli_group_by_color(sample_pdf, tmp_path):
    out = tmp_path / "out"
    assert main([str(sample_pdf), "-o", str(out), "--no-ai", "--group-by", "color", "--format", "json"]) == 0
    data = json.loads((out / "요약.json").read_text(encoding="utf-8"))
    titles = [s["title"] for s in data["sections"]]
    assert titles[0] == "노랑 표시" and titles[-1] == "따로 적은 메모"


def test_cli_missing_file(tmp_path):
    assert main([str(tmp_path / "없음.pdf")]) == 2
