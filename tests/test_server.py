import json
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

import pdfsummary.app as app

CODE = "test-access-code-123"


@pytest.fixture()
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "CONFIG_DIR", tmp_path / "config")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("pdfsummary.ai.has_credentials", lambda: False)
    app.STATE = app.State(server=True, access_code=CODE, max_upload=50 * 1024 * 1024, ttl=3600)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def call(base, path, code=CODE, data=None, method=None, raw=None, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    if code:
        h["Authorization"] = f"Bearer {code}"
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(base + path, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def test_access_code(server):
    assert call(server, "/healthz", code=None)[0] == 200
    assert call(server, "/api/state", code=None)[0] == 403
    assert call(server, "/api/state", code="wrong-code-xxxx")[0] == 403
    s, b, h = call(server, "/api/state")
    assert s == 200 and json.loads(b)["server"] is True
    assert h["Access-Control-Allow-Origin"] == "*"
    # 로컬 전용 기능은 서버에서 막힘
    assert call(server, "/api/key", data={"key": "sk-ant-x"})[0] == 404
    assert call(server, "/api/quit", data={})[0] == 404


def test_cors_preflight(server):
    s, _, h = call(server, "/api/upload", code=None, method="OPTIONS")
    assert s == 204 and "X-Anthropic-Key" in h["Access-Control-Allow-Headers"]


def test_upload_limit(server):
    app.STATE.max_upload = 1024 * 1024
    try:
        s, b, _ = call(server, "/api/upload?name=a.pdf", raw=b"0" * (2 * 1024 * 1024), method="PUT")
        assert s == 413
    except urllib.error.URLError:
        pass   # 서버가 본문을 받기 전에 거절해서 연결이 먼저 끊길 수도 있다 (앱은 올리기 전에 크기를 확인함)
    assert call(server, "/api/state")[0] == 200   # 서버는 멀쩡함
    assert json.loads(call(server, "/api/state")[1])["max_upload_mb"] == 1


def test_run_uses_request_key_without_storing(server, sample_pdf, monkeypatch):
    seen = {}

    def fake_main(argv, log=None, progress=None, api_key=None):
        seen["api_key"] = api_key
        out = Path(argv[argv.index("-o") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for n in ("요약.html", "요약.md", "요약.json"):
            (out / n).write_text("x", encoding="utf-8")
        log("✅ 형광펜 1")
        return 0

    monkeypatch.setattr("pdfsummary.cli.main", fake_main)
    s, b, _ = call(server, "/api/upload?name=s.pdf", raw=Path(sample_pdf).read_bytes(), method="PUT")
    fid = json.loads(b)["id"]
    s, b, _ = call(server, "/api/run", data={"file": fid, "options": {}}, headers={"X-Anthropic-Key": "sk-ant-user-key"})
    job = json.loads(b)["job"]
    for _ in range(100):
        st = json.loads(call(server, f"/api/job/{job}")[1])
        if st["status"] != "running":
            break
        time.sleep(0.02)
    assert st["status"] == "done" and seen["api_key"] == "sk-ant-user-key"
    assert not (app.CONFIG_DIR / "config.json").exists()
    s, b, _ = call(server, "/r/" + job + "/" + urllib.request.quote("요약.html"))
    assert s == 200 and b == "x".encode()


def test_cleanup_expired(server, sample_pdf):
    s, b, _ = call(server, "/api/upload?name=s.pdf", raw=Path(sample_pdf).read_bytes(), method="PUT")
    fid = json.loads(b)["id"]
    up = app.STATE.uploads[fid]
    assert up.path.exists()
    assert app.cleanup_expired(now=time.monotonic() + 3601) == 1
    assert fid not in app.STATE.uploads and not up.path.exists()


def test_server_requires_long_code():
    with pytest.raises(SystemExit):
        app.serve_public("127.0.0.1", 0, "short", 60, 10)
