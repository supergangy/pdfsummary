"""만든 설치 앱을 실제로 켜서 화면이 뜨고 '끝내기'로 꺼지는지 확인한다 (CI용).

    python desktop/smoke_test.py <실행 파일 경로>
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request


def main(exe: str) -> int:
    for stream in (sys.stdout, sys.stderr):   # Windows 콘솔(cp1252)에서도 한글 출력
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    env = dict(os.environ, PDFSUMMARY_NO_BROWSER="1", PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen([exe], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    url = None
    start = time.time()
    lines = []
    while time.time() - start < 120:
        line = proc.stdout.readline().decode("utf-8", "replace")
        if not line and proc.poll() is not None:
            break
        lines.append(line)
        m = re.search(r"(http://127\.0\.0\.1:\d+)/\?t=(\S+)", line)
        if m:
            url, token = m.group(1), m.group(2)
            break
    if not url:
        print("".join(lines))
        print("FAIL: 실행 화면 주소가 나오지 않았습니다.")
        proc.kill()
        return 1

    page = urllib.request.urlopen(f"{url}/?t={token}", timeout=30).read().decode("utf-8")
    assert "필기 요약 만들기" in page, "화면 HTML이 없습니다"
    req = urllib.request.Request(f"{url}/api/state", headers={"X-Token": token})
    print("state:", json.loads(urllib.request.urlopen(req, timeout=30).read()))
    # 분석 모듈(PyMuPDF·numpy)이 실제로 불러와지는지: 빈 PDF 하나 올려서 색 찾기까지
    import base64

    tiny_pdf = base64.b64decode(
        "JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAw"
        "IFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9i"
        "agp0cmFpbGVyCjw8L1Jvb3QgMSAwIFI+PgolJUVPRgo="
    )
    up = urllib.request.Request(f"{url}/api/upload?name=t.pdf", data=tiny_pdf, method="PUT", headers={"X-Token": token})
    fid = json.loads(urllib.request.urlopen(up, timeout=60).read())["id"]
    col = urllib.request.Request(f"{url}/api/colors", data=json.dumps({"file": fid}).encode(), method="POST",
                                 headers={"X-Token": token, "Content-Type": "application/json"})
    print("colors:", json.loads(urllib.request.urlopen(col, timeout=120).read()))

    if os.environ.get("PDFSUMMARY_EXPECT_OCR"):
        check_ocr(url, token)

    q = urllib.request.Request(f"{url}/api/quit", data=b"{}", method="POST",
                               headers={"X-Token": token, "Content-Type": "application/json"})
    urllib.request.urlopen(q, timeout=30).read()
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        print("FAIL: '끝내기' 후에도 꺼지지 않았습니다.")
        return 1
    print("OK: 화면이 뜨고, PDF 분석이 되고, 끝내기로 꺼졌습니다.")
    return 0


def check_ocr(url: str, token: str) -> None:
    """스캔한 쪽(글자층 없음)의 형광펜 부분을 앱 안의 글자 인식으로 읽어 내는지."""
    import tempfile

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "examples"))
    import make_sample

    path = os.path.join(tempfile.mkdtemp(), "scan.pdf")
    make_sample.make_printed_color_scan(path)
    h = {"X-Token": token, "Content-Type": "application/json"}
    up = urllib.request.Request(f"{url}/api/upload?name=scan.pdf", data=open(path, "rb").read(), method="PUT", headers={"X-Token": token})
    fid = json.loads(urllib.request.urlopen(up, timeout=60).read())["id"]
    body = json.dumps({"file": fid, "options": {"style": "list", "context": "sentence", "handwriting": "image"}}).encode()
    job = json.loads(urllib.request.urlopen(urllib.request.Request(f"{url}/api/run", data=body, method="POST", headers=h), timeout=60).read())["job"]
    for _ in range(600):
        st = json.loads(urllib.request.urlopen(urllib.request.Request(f"{url}/api/job/{job}", headers=h), timeout=30).read())
        if st["status"] != "running":
            break
        time.sleep(0.5)
    print("ocr job:", st["status"], st.get("summary"), st.get("error"))
    assert st["status"] == "done", st
    html = urllib.request.urlopen(f"{url}/r/{job}/%EC%9A%94%EC%95%BD.html?t={token}", timeout=30).read().decode("utf-8")
    marked = re.findall(r"<mark>(.*?)</mark>", html)
    print("highlighted text:", marked)
    print("log:", "\n".join(st.get("log", [])))
    # 글자 인식은 대소문자·낱말 하나쯤 틀릴 수 있어 한국어 구절로 확인한다
    joined = " ".join(marked)
    assert "보안 기능" in joined and "데이터 인증" in joined, "스캔 쪽 형광펜 글자를 읽지 못했습니다"
    print("OK: 스캔 쪽 형광펜 글자를 글자 인식으로 읽었습니다.")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
