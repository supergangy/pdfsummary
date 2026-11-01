#!/bin/bash
# 필기 요약 실행 화면 (Mac): 이 파일을 더블클릭하세요.
# 처음에 "확인되지 않은 개발자" 경고가 뜨면, 파일을 우클릭 → 열기 를 한 번 해 주세요.
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
    echo "처음 실행이라 필요한 것을 설치합니다. 1~2분 걸려요..."
    if ! command -v python3 >/dev/null 2>&1; then
        echo
        echo "[!] Python을 찾지 못했습니다. https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치한 뒤 다시 실행해 주세요."
        read -r -p "엔터를 누르면 닫힙니다."
        exit 1
    fi
    python3 -m venv .venv || { read -r -p "설치에 실패했습니다. 엔터를 누르면 닫힙니다."; exit 1; }
    .venv/bin/python -m pip install --quiet --upgrade pip
    .venv/bin/python -m pip install --quiet -e . || { read -r -p "설치에 실패했습니다. 엔터를 누르면 닫힙니다."; exit 1; }
fi

exec .venv/bin/python -m pdfsummary.app
