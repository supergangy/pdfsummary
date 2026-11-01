"""기기 안 글자 인식(OCR): 스캔본처럼 글자층이 없는 쪽의 글자를 읽는다. 인터넷·AI 없이 돈다.

엔진은 RapidOCR(PaddleOCR 모델을 ONNX Runtime으로 돌림)이고, 한국어 인식 모델은
처음 쓸 때 한 번 받아서 ~/.pdfsummary/models 에 둔다 (설치 앱에는 미리 들어 있음).

    python -m pdfsummary.ocr --download     # 한국어 모델 미리 받기
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

KOREAN_REC = {
    "file": "korean_PP-OCRv5_rec_mobile.onnx",
    # RapidOCR 3.10.0 default_models.yaml 에 적힌 값과 같아야 받은 파일을 쓴다
    "sha256": "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
    "urls": [
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx",
        "https://huggingface.co/RapidAI/RapidOCR/resolve/main/onnx/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx",
    ],
}
OCR_DPI = 200


@dataclass
class OcrLine:
    text: str
    box: tuple[float, float, float, float]          # 쪽 좌표(pt)
    score: float
    chars: list[tuple[str, tuple[float, float, float, float]]]   # 글자마다 상자 (띄어쓰기 포함)


def config_dir() -> Path:
    return Path(os.environ.get("PDFSUMMARY_HOME") or (Path.home() / ".pdfsummary"))


def model_dirs() -> list[Path]:
    dirs = []
    if os.environ.get("PDFSUMMARY_MODELS"):
        dirs.append(Path(os.environ["PDFSUMMARY_MODELS"]))
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):   # 설치 앱에 함께 들어 있는 모델
        dirs.append(Path(sys._MEIPASS) / "ocr_models")
    dirs.append(Path(__file__).resolve().parent.parent / "desktop" / "ocr_models")
    dirs.append(config_dir() / "models")
    return dirs


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_model() -> Optional[Path]:
    for d in model_dirs():
        p = d / KOREAN_REC["file"]
        if p.exists():
            return p
    return None


def download_model(log: Callable[[str], None] = print, dest: Optional[Path] = None) -> Optional[Path]:
    """한국어 인식 모델을 받는다 (약 13MB). 받은 파일은 SHA256으로 확인하고, 다르면 버린다."""
    dest = dest or (config_dir() / "models")
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / KOREAN_REC["file"]
    tmp = target.with_suffix(".part")
    for url in KOREAN_REC["urls"]:
        try:
            log(f"🔤 한국어 글자 인식 모델 받는 중… ({url.split('/')[2]})")
            req = urllib.request.Request(url, headers={"User-Agent": "pdfsummary"})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            if _sha256(tmp) != KOREAN_REC["sha256"]:
                log("  ! 받은 파일이 예상과 달라 버립니다.")
                tmp.unlink(missing_ok=True)
                continue
            tmp.replace(target)
            return target
        except Exception as e:  # 다음 주소로
            log(f"  ! 받지 못했습니다: {type(e).__name__}")
            tmp.unlink(missing_ok=True)
    return None


class OcrEngine:
    """쪽 하나를 글자 상자 목록으로. 같은 쪽은 디스크 캐시에서 바로 꺼낸다."""

    def __init__(self, log: Callable[[str], None] = lambda s: None, allow_download: bool = True):
        self.log = log
        self.error: Optional[str] = None
        self._engine = None
        self._lock = threading.Lock()
        try:
            from rapidocr import RapidOCR
        except ImportError:
            self.error = "글자 인식 엔진(rapidocr)이 설치되어 있지 않습니다: pip install rapidocr onnxruntime"
            return
        model = find_model() or (download_model(log) if allow_download else None)
        if model is None:
            self.error = "한국어 글자 인식 모델을 받지 못했습니다 (인터넷 확인 후 python -m pdfsummary.ocr --download)."
            return
        self._engine = RapidOCR(params={
            "Global.log_level": "error",
            "Global.return_word_box": True,
            "Global.return_single_char_box": True,
            "Rec.lang_type": "korean",
            "Rec.ocr_version": "PP-OCRv5",
            "Rec.model_type": "mobile",
            "Rec.model_path": str(model),
        })

    @property
    def ready(self) -> bool:
        return self._engine is not None

    def read_page(self, page, cache_key: Optional[str] = None) -> list[OcrLine]:
        import numpy as np
        import pymupdf

        cache = config_dir() / "ocr_cache" / f"{cache_key}.json" if cache_key else None
        if cache and cache.exists():
            try:
                return [OcrLine(d["text"], tuple(d["box"]), d["score"], [(c, tuple(b)) for c, b in d["chars"]])
                        for d in json.loads(cache.read_text(encoding="utf-8"))]
            except (OSError, ValueError, KeyError):
                pass
        zoom = OCR_DPI / 72
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csRGB, alpha=False, annots=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        with self._lock:   # 엔진은 한 번에 하나씩
            res = self._engine(img)
        lines = to_lines(res, zoom)
        if cache:
            try:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps([
                    {"text": ln.text, "box": ln.box, "score": ln.score, "chars": ln.chars} for ln in lines
                ], ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
        return lines


def to_lines(res, zoom: float) -> list[OcrLine]:
    """RapidOCR 결과 → 쪽 좌표의 줄·글자 상자. 글자 상자 사이에 OCR이 읽은 띄어쓰기를 다시 끼워 넣는다."""
    if res is None or res.boxes is None:
        return []
    words = res.word_results if res.word_results is not None else [None] * len(res.txts)
    out = []
    for quad, text, score, wl in zip(res.boxes, res.txts, res.scores, words):
        xs = [float(p[0]) / zoom for p in quad]
        ys = [float(p[1]) / zoom for p in quad]
        box = (min(xs), min(ys), max(xs), max(ys))
        text = " ".join(str(text).split())
        if not text:
            continue
        glyphs = []
        if wl:
            for w in wl:
                if w and w[2] is not None and str(w[0]).strip():
                    pxs = [float(p[0]) / zoom for p in w[2]]
                    glyphs.append((str(w[0]), (min(pxs), max(pxs))))
        out.append(OcrLine(text, box, float(score), align_chars(text, box, glyphs)))
    return out


def align_chars(text: str, box, glyphs: list[tuple[str, tuple[float, float]]]):
    """줄 글자(text)마다 상자를 준다. 엔진이 준 글자 상자(glyphs)와 개수가 맞으면 그것을, 아니면 폭을 나눠서."""
    y0, y1 = box[1], box[3]
    solid = [c for c in text if not c.isspace()]
    if glyphs and sum(len(g) for g, _ in glyphs) == len(solid):
        spans = []
        for g, (gx0, gx1) in glyphs:   # 한 상자에 글자가 여럿이면 폭을 나눠 갖는다
            n = len(g)
            for k in range(n):
                spans.append((gx0 + (gx1 - gx0) * k / n, gx0 + (gx1 - gx0) * (k + 1) / n))
    else:
        weights = [_width(c) for c in solid]
        total = sum(weights) or 1.0
        spans, x = [], box[0]
        for w in weights:
            dx = (box[2] - box[0]) * w / total
            spans.append((x, x + dx))
            x += dx
    chars = []
    k = 0
    for c in text:
        if c.isspace():
            left = spans[k - 1][1] if k > 0 else box[0]
            right = spans[k][0] if k < len(spans) else left
            chars.append((" ", (left, y0, max(left, right), y1)))
        else:
            sx0, sx1 = spans[k]
            chars.append((c, (sx0, y0, sx1, y1)))
            k += 1
    return chars


def _width(c: str) -> float:
    o = ord(c)
    if 0xAC00 <= o <= 0xD7A3 or 0x4E00 <= o <= 0x9FFF or 0x3130 <= o <= 0x318F:
        return 1.0   # 한글·한자
    if c.isdigit() or c.isalpha():
        return 0.55
    return 0.35      # 문장 부호


def main(argv=None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="python -m pdfsummary.ocr")
    p.add_argument("--download", action="store_true", help="한국어 글자 인식 모델 받기")
    p.add_argument("--dest", type=Path, help="받을 폴더 (기본: ~/.pdfsummary/models)")
    a = p.parse_args(argv)
    if a.download:
        have = find_model()
        if have and not a.dest:
            print(f"이미 있습니다: {have}")
            return 0
        got = download_model(dest=a.dest)
        print(f"받았습니다: {got}" if got else "받지 못했습니다.")
        return 0 if got else 1
    p.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
