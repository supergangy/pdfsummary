# PyInstaller 설정: Windows는 PdfSummary.exe 한 파일, Mac은 '필기 요약.app'
#   pyinstaller --noconfirm desktop/pdfsummary.spec
import os
import sys

from PyInstaller.utils.hooks import collect_all

# 실행 화면 HTML (자동 수집은 개발용 설치(-e)에서 파일을 못 찾으므로 직접 넣는다)
datas = [(os.path.join(SPECPATH, "..", "pdfsummary", "app_page.html"), "pdfsummary")]
binaries = []
hiddenimports = ["pdfsummary.app", "pdfsummary.cli"]
# 한국어 글자 인식 모델 (CI가 빌드 전에 desktop/ocr_models 에 받아 둔다). 있으면 앱에 넣어 인터넷 없이도 인식
_models = os.path.join(SPECPATH, "ocr_models")
if os.path.isdir(_models):
    datas += [(os.path.join(_models, f), "ocr_models") for f in os.listdir(_models) if f.endswith(".onnx")]
# PyMuPDF는 글꼴·레이아웃 모델, RapidOCR은 설정·기본 모델, onnxruntime은 실행 파일을 함께 가져가야 한다
for pkg in ("pymupdf", "rapidocr", "onnxruntime"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["launcher.py"],
    pathex=[".."],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "pytest", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="PdfSummary", console=False,
              icon="icon.icns", argv_emulation=False)
    coll = COLLECT(exe, a.binaries, a.datas, name="PdfSummary")
    app = BUNDLE(
        coll,
        name="필기 요약.app",
        icon="icon.icns",
        bundle_identifier="com.pdfsummary.desktop",
        info_plist={
            "CFBundleDisplayName": "필기 요약",
            "CFBundleName": "필기 요약",
            "CFBundleShortVersionString": "0.1.0",
            "LSMinimumSystemVersion": "11.0",
            "NSHighResolutionCapable": True,
        },
    )
else:
    exe = EXE(
        pyz, a.scripts, a.binaries, a.datas, [],
        name="PdfSummary",
        console=False,                       # 검은 창 없이
        icon="icon.ico" if sys.platform == "win32" else None,
        upx=False,
    )
