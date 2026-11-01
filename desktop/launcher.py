"""설치 앱(PyInstaller)의 시작점: 실행 화면을 '설치 앱 모드'로 연다."""

import multiprocessing
import os
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    # 무거운 라이브러리는 요청 처리 스레드가 아니라 여기(메인 스레드)에서 먼저 한 번 불러 둔다
    import numpy  # noqa: F401
    import pymupdf  # noqa: F401

    import pdfsummary.cli  # noqa: F401
    from pdfsummary.app import main

    # macOS가 붙이는 -psn_… 같은 인자는 버린다. 자동 점검(CI)에서는 브라우저를 열지 않는다
    args = ["--desktop"] + (["--no-browser"] if os.environ.get("PDFSUMMARY_NO_BROWSER") else [])
    sys.exit(main(args))
