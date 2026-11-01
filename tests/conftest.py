import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "examples"))


@pytest.fixture(scope="session")
def sample_pdf(tmp_path_factory):
    import make_sample

    path = tmp_path_factory.mktemp("pdf") / "sample.pdf"
    make_sample.main(str(path))
    return path


@pytest.fixture(scope="session")
def book_pair(tmp_path_factory):
    """(원본, 필기본): 책 자체에 노란 강조·빨간 밑줄이 있고, 필기본에는 내 형광펜과 그림으로 굳은 손글씨·형광펜이 더해짐."""
    import make_sample

    d = tmp_path_factory.mktemp("pair")
    orig, ann = d / "book.pdf", d / "book_notes.pdf"
    make_sample.make_book_pair(str(orig), str(ann))
    return orig, ann


@pytest.fixture(scope="session")
def textbook(tmp_path_factory):
    """책갈피 없이 글자 크기로만 Ⅰ > 1. > 소제목 구조가 드러나는 교과서 + 형광펜 6개."""
    import make_sample

    path = tmp_path_factory.mktemp("tb") / "textbook.pdf"
    make_sample.make_textbook(str(path))
    return path
