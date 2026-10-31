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
