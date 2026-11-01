import json
import threading
import time
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

import pytest

import pdfsummary.app as app


@pytest.fixture()
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "CONFIG_DIR", tmp_path / "config")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("pdfsummary.ai.has_credentials", lambda: False)
    app.STATE = app.State()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", app.STATE.token
    srv.shutdown()
    srv.server_close()


def call(base, path, token=None, data=None, method=None, raw=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Token"] = token
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def test_token_required(server):
    base, token = server
    assert call(base, "/")[0] == 403
    assert call(base, "/api/state")[0] == 403
    assert call(base, "/api/state", token="틀림".encode().hex())[0] == 403
    status, body, _ = call(base, f"/?t={token}")
    assert status == 200 and "필기 요약 만들기".encode() in body and token.encode() in body


def test_upload_rejects_non_pdf(server):
    base, token = server
    status, body, _ = call(base, "/api/upload?name=x.pdf", token, raw=b"hello", method="PUT")
    assert status == 400 and "PDF" in json.loads(body)["error"]


def test_full_flow(server, book_pair):
    base, token = server
    orig, ann = book_pair

    def up(path, name):
        s, b, _ = call(base, "/api/upload?name=" + urllib.request.quote(name), token, raw=Path(path).read_bytes(), method="PUT")
        assert s == 200, b
        return json.loads(b)

    main = up(ann, "../효소 필기.pdf")
    assert main["name"] == "효소 필기.pdf" and main["pages"] == 1
    o = up(orig, "원본.pdf")

    s, b, _ = call(base, "/api/colors", token, {"file": main["id"], "original": o["id"]})
    colors = json.loads(b)["colors"]
    assert [(c["name"], c["code"]) for c in colors] == [("노랑", "#F5E563"), ("분홍", "#FF8CBF"), ("초록", None)]
    assert colors[2]["filter"] == "초록"

    opts = {"group_by": "chapter", "context": "sentence", "handwriting": "image",
            "colors": ["#F5E563", "#FF8CBF"], "labels": {"yellow": "핵심"}, "title": "효소 정리"}
    s, b, _ = call(base, "/api/run", token, {"file": main["id"], "original": o["id"], "options": opts})
    job = json.loads(b)["job"]
    for _ in range(200):
        st = json.loads(call(base, f"/api/job/{job}", token)[1])
        if st["status"] != "running":
            break
        time.sleep(0.05)
    assert st["status"] == "done", st
    assert st["summary"] == "형광펜 2 · 손글씨 1"   # 초록은 뺐음

    s, html, _ = call(base, f"/r/{job}/{urllib.request.quote('요약.html')}?t={token}")
    html = html.decode()
    assert s == 200 and "<title>효소 정리 필기 요약</title>" in html and "원본 효소 필기.pdf" in html and "노랑 · 핵심" in html
    s, z, headers = call(base, f"/r/{job}/{urllib.request.quote('요약.zip')}?t={token}&dl=1")
    assert "attachment" in headers["Content-Disposition"]
    names = zipfile.ZipFile(BytesIO(z)).namelist()
    assert "효소 필기_요약/요약.md" in names and any(n.startswith("효소 필기_요약/images/") for n in names)
    # 결과 파일 말고 다른 것은 못 꺼냄
    assert call(base, f"/r/{job}/..%2F..%2Fetc%2Fpasswd?t={token}")[0] == 404


def test_build_argv_ignores_unknown_values(tmp_path):
    up = app.Upload("u1", tmp_path / "a.pdf", "a.pdf", 3, "제목", "abc")
    argv = app.build_argv(up, None, tmp_path / "out", {"group_by": "page; rm -rf /", "context": "ai",
                                                        "colors": ["노랑"], "labels": {"yellow": "핵심", "pink": " "},
                                                        "pages": "1-2", "no_drawings": True})
    assert "--group-by" not in argv
    assert argv[argv.index("--context") + 1] == "ai"
    assert ["--color", "노랑"] == argv[argv.index("--color"):argv.index("--color") + 2]
    assert "yellow=핵심" in argv and "pink= " not in argv
    assert "--no-drawings" in argv and argv[argv.index("--pages") + 1] == "1-2"


def test_safe_name():
    assert app._safe_name("../../etc/passwd") == "passwd.pdf"
    assert app._safe_name("C:\\Users\\a\\책 1.pdf") == "책 1.pdf"
    assert app._safe_name("") == "책.pdf"


def test_key_saved_privately(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "CONFIG_DIR", tmp_path / "cfg")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app.save_key("sk-ant-test-1234567890", remember=True)
    p = tmp_path / "cfg" / "config.json"
    assert json.loads(p.read_text())["anthropic_api_key"] == "sk-ant-test-1234567890"
    assert oct(p.stat().st_mode & 0o777) == "0o600"
    app.save_key("", remember=False)
    assert not p.exists()
    import os
    assert "ANTHROPIC_API_KEY" not in os.environ
