"""실행 화면과 앱용 서버.

    pdfsummary-app                     내 컴퓨터용 실행 화면 (127.0.0.1, 브라우저를 연다)
    pdfsummary-app --server            태블릿·폰 앱이 붙는 서버 (접속 코드 필요)

내 컴퓨터용: PDF는 이 컴퓨터의 임시 폴더에만 저장되고, AI를 켰을 때만 손글씨 이미지와 단원 본문이 Claude API로 보내진다.
서버용: 접속 코드(Authorization: Bearer …)가 있어야 쓸 수 있다. Claude API 키는 요청마다 앱이 보내고(X-Anthropic-Key)
서버에 저장하지 않는다. 올린 파일과 결과는 정해진 시간(기본 60분)이 지나면 지운다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
import zipfile
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, quote, unquote, urlparse

import pymupdf

from . import __version__

CONFIG_DIR = Path.home() / ".pdfsummary"
MAX_UPLOAD = 1024 * 1024 * 1024  # 1GB


# ── 상태 ────────────────────────────────────────────────────────────────

@dataclass
class Upload:
    id: str
    path: Path
    name: str
    pages: int
    title: str
    digest: str
    created: float = field(default_factory=time.monotonic)


@dataclass
class Job:
    id: str
    out_dir: Path
    stem: str
    status: str = "running"         # running / done / error
    log: list[str] = field(default_factory=list)
    progress: dict = field(default_factory=dict)   # 이름 → [한 것, 전체]
    error: str = ""
    summary: str = ""
    created: float = field(default_factory=time.monotonic)


DESKTOP_IDLE_QUIT = 180   # 데스크톱 앱: 화면(브라우저 탭)이 닫히고 이만큼(초) 지나면 스스로 끝낸다


class State:
    def __init__(self, desktop: bool = False, server: bool = False, access_code: str = "",
                 max_upload: int = MAX_UPLOAD, ttl: float = 3600):
        self.desktop = desktop
        self.server = server              # 앱용 서버 모드
        self.access_code = access_code
        self.max_upload = max_upload
        self.ttl = ttl
        self.last_ping = time.monotonic()
        self.quit_requested = False
        self.token = secrets.token_urlsafe(24)
        self.workdir = Path(tempfile.mkdtemp(prefix="pdfsummary_"))
        self.uploads: dict[str, Upload] = {}
        self.jobs: dict[str, Job] = {}
        self.run_lock = threading.Lock()   # 한 번에 하나씩 만든다 (AI 요청·메모리 절약)


STATE: Optional[State] = None


# ── API 키 ──────────────────────────────────────────────────────────────

def _config_path() -> Path:
    return CONFIG_DIR / "config.json"


def load_saved_key() -> None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    try:
        key = json.loads(_config_path().read_text(encoding="utf-8")).get("anthropic_api_key")
    except (OSError, json.JSONDecodeError):
        return
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key


def save_key(key: str, remember: bool) -> None:
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
    else:
        os.environ.pop("ANTHROPIC_API_KEY", None)
    path = _config_path()
    if remember and key:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"anthropic_api_key": key}), encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    elif not key and path.exists():
        path.unlink()


def key_state() -> dict:
    from .ai import has_credentials

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    return {
        "has_key": has_credentials(),
        "masked": (key[:7] + "…" + key[-4:]) if len(key) > 14 else ("설정됨" if key else ""),
        "saved": _config_path().exists(),
    }


# ── 작업 ────────────────────────────────────────────────────────────────

def find_colors(main: Upload, original: Optional[Upload], pages: Optional[str]) -> list[dict]:
    from .cli import collect_colors, parse_pages
    from .extract import Options, extract
    from .organize import drop_empty

    doc = pymupdf.open(main.path)
    orig = pymupdf.open(original.path) if original else None
    try:
        opts = Options(pages=parse_pages(pages, doc.page_count) if pages else None, original=orig)
        marks, _ = extract(doc, opts)
        return collect_colors(drop_empty(marks))
    finally:
        doc.close()
        if orig is not None:
            orig.close()


def build_argv(main: Upload, original: Optional[Upload], out_dir: Path, o: dict) -> list[str]:
    argv = [str(main.path), "-o", str(out_dir), "--format", "html,md,json", "--title", main.title,
            "--cache", str(CONFIG_DIR / "cache" / f"{main.digest}.json")]
    if original:
        argv += ["--original", str(original.path)]
    choice = {
        "group_by": ("--group-by", {"chapter", "page", "color"}),
        "context": ("--context", {"ai", "sentence", "none"}),
        "handwriting": ("--handwriting", {"auto", "ai", "image", "both"}),
        "headings": ("--headings", {"auto", "toc", "font"}),
        "scan": ("--scan", {"auto", "on", "off"}),
    }
    for key, (flag, allowed) in choice.items():
        v = o.get(key)
        if v in allowed:
            argv += [flag, v]
    if o.get("pages"):
        argv += ["--pages", str(o["pages"])]
    for c in o.get("colors") or []:
        argv += ["--color", str(c)]
    for k, v in (o.get("labels") or {}).items():
        if str(v).strip():
            argv += ["--label", f"{k}={v}"]
    if o.get("no_drawings"):
        argv.append("--no-drawings")
    if o.get("no_attach"):
        argv.append("--no-attach")
    if o.get("model"):
        argv += ["--model", str(o["model"])]
    return argv


def run_job(job: Job, argv: list[str], api_key: Optional[str] = None) -> None:
    from .cli import main as cli_main

    def log(s: str) -> None:
        job.log.append(s.rstrip())
        if s.startswith("✅"):
            job.summary = s[1:].strip()

    def progress(label: str, done: int, total: int) -> None:
        job.progress[label.strip()] = [done, total]

    with STATE.run_lock:
        try:
            rc = cli_main(argv, log=log, progress=progress, api_key=api_key)
            if rc != 0:
                job.status, job.error = "error", (job.log[-1] if job.log else "실패했습니다.")
                return
            _zip_results(job)
            job.status = "done"
        except Exception as e:  # 화면에 원인을 보여 준다
            job.status, job.error = "error", f"{type(e).__name__}: {e}"


def _zip_results(job: Job) -> None:
    zpath = job.out_dir / "요약.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(job.out_dir.rglob("*")):
            if p.is_file() and p.name not in ("요약.zip",) and not p.name.startswith("."):
                z.write(p, f"{job.stem}_요약/{p.relative_to(job.out_dir).as_posix()}")


def _remove_upload(path: Path) -> None:
    import gc

    gc.collect()   # 실패한 열기 시도가 쥐고 있던 파일 핸들을 놓게
    shutil.rmtree(path.parent, ignore_errors=True)


def _safe_name(name: str) -> str:
    """올린 파일 이름에서 폴더 경로·특수 문자를 빼고 .pdf로 끝나게."""
    base = Path(name.replace("\\", "/")).name
    base = "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"/\\|?*').strip(" .")
    if not base:
        base = "책"
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    return base[:150]


# ── HTTP ────────────────────────────────────────────────────────────────

RESULT_FILES = {
    "요약.html": "text/html; charset=utf-8",
    "요약.md": "text/markdown; charset=utf-8",
    "요약.json": "application/json; charset=utf-8",
    "요약.zip": "application/zip",
}


class Handler(BaseHTTPRequestHandler):
    server_version = f"pdfsummary/{__version__}"

    def log_message(self, fmt, *args):  # 터미널을 조용하게
        pass

    # 응답 도우미
    def _cors(self) -> None:
        # 서버 모드는 쿠키가 아니라 Authorization 헤더로 인증하므로 출처를 가리지 않아도 된다
        if STATE.server:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Anthropic-Key")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")

    def do_OPTIONS(self):
        if not STATE.server:
            return self._err("없는 주소입니다.", 404)
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, code: int = 200) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _err(self, msg: str, code: int = 400) -> None:
        self._json({"error": msg}, code)

    def _authed(self, query: dict) -> bool:
        if STATE.server:
            auth = self.headers.get("Authorization") or ""
            given = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
            return bool(given) and secrets.compare_digest(given.encode(), STATE.access_code.encode())
        tok = self.headers.get("X-Token") or (query.get("t") or [""])[0]
        return secrets.compare_digest(tok.encode(), STATE.token.encode())

    def _body_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    # GET
    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if STATE.server and url.path in ("/", "/healthz"):
            return self._json({"service": "pdfsummary", "version": __version__, "ok": True})
        if url.path == "/":
            if not self._authed(q):
                return self._send(403, "터미널에 나온 주소(…?t=…)로 열어 주세요.".encode("utf-8"), "text/plain; charset=utf-8")
            page = resources.files("pdfsummary").joinpath("app_page.html").read_text(encoding="utf-8")
            page = (page.replace("__TOKEN__", STATE.token).replace("__VERSION__", __version__)
                    .replace("__DESKTOP__", "true" if STATE.desktop else "false"))
            return self._send(200, page.encode("utf-8"), "text/html; charset=utf-8",
                              {"Content-Security-Policy": "frame-ancestors 'self'"})
        if not self._authed(q):
            return self._err("권한이 없습니다.", 403)
        if url.path == "/api/state":
            if STATE.server:
                from .ai import has_credentials

                return self._json({"server": True, "version": __version__, "server_key": has_credentials(),
                                   "max_upload_mb": STATE.max_upload // (1024 * 1024),
                                   "keep_minutes": int(STATE.ttl // 60)})
            return self._json(key_state())
        if url.path.startswith("/api/job/"):
            job = STATE.jobs.get(url.path.rsplit("/", 1)[-1])
            if not job:
                return self._err("작업을 찾을 수 없습니다.", 404)
            return self._json({"status": job.status, "log": job.log[-200:], "progress": job.progress,
                               "error": job.error, "summary": job.summary})
        if url.path.startswith("/r/"):
            parts = url.path.split("/")
            if len(parts) != 4:
                return self._err("잘못된 주소입니다.", 404)
            job = STATE.jobs.get(parts[2])
            name = unquote(parts[3])
            if not job or job.status != "done" or name not in RESULT_FILES:
                return self._err("결과가 없습니다.", 404)
            data = (job.out_dir / name).read_bytes()
            extra = {}
            if q.get("dl"):
                fname = f"{job.stem}_{name}"
                extra["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(fname)}"
            return self._send(200, data, RESULT_FILES[name], extra)
        return self._err("없는 주소입니다.", 404)

    # PUT: 파일 올리기 (본문이 곧 PDF)
    def do_PUT(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if not self._authed(q):
            return self._err("권한이 없습니다.", 403)
        if url.path != "/api/upload":
            return self._err("없는 주소입니다.", 404)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._err("빈 파일입니다.")
        if n > STATE.max_upload:
            return self._err(f"파일이 너무 큽니다 ({STATE.max_upload // (1024 * 1024)}MB까지).", 413)
        name = _safe_name((q.get("name") or ["책.pdf"])[0])
        uid = uuid.uuid4().hex[:12]
        (STATE.workdir / uid).mkdir()
        path = STATE.workdir / uid / name   # 원래 파일 이름을 지켜서 요약본에 그대로 보이게
        h = hashlib.sha256()
        left = n
        with open(path, "wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                f.write(chunk)
                h.update(chunk)
                left -= len(chunk)
        info = None
        try:
            with pymupdf.open(path) as doc:   # 확인만 하고 바로 닫는다 (Windows는 열린 파일을 못 지움)
                if doc.is_pdf:
                    if doc.needs_pass:
                        info = "locked"
                    else:
                        info = (doc.page_count, (doc.metadata or {}).get("title") or "", bool(doc.get_toc()))
        except Exception:
            info = None
        if info is None or info == "locked":
            _remove_upload(path)
            if info == "locked":
                return self._err("암호가 걸린 PDF입니다. 암호를 풀고 다시 올려 주세요.")
            return self._err("PDF 파일이 아닙니다.")
        pages, meta_title, has_toc = info
        stem = Path(name).stem or "책"
        title = meta_title or stem
        up = Upload(uid, path, name, pages, title, h.hexdigest()[:20])
        STATE.uploads[uid] = up
        return self._json({"id": uid, "name": name, "pages": pages, "title": title, "has_toc": has_toc})

    # POST
    def do_POST(self):
        url = urlparse(self.path)
        if not self._authed(parse_qs(url.query)):
            return self._err("권한이 없습니다.", 403)
        body = self._body_json()
        if STATE.server and url.path in ("/api/ping", "/api/quit", "/api/key"):
            return self._err("없는 주소입니다.", 404)   # 서버는 키를 저장하지도, 원격으로 꺼지지도 않는다
        if url.path == "/api/ping":
            STATE.last_ping = time.monotonic()
            return self._json({"ok": True})
        if url.path == "/api/quit":
            STATE.quit_requested = True
            return self._json({"ok": True})
        if url.path == "/api/key":
            save_key(str(body.get("key") or "").strip(), bool(body.get("remember")))
            return self._json(key_state())
        main = STATE.uploads.get(body.get("file") or "")
        original = STATE.uploads.get(body.get("original") or "") if body.get("original") else None
        if url.path in ("/api/colors", "/api/run") and not main:
            return self._err("먼저 필기한 PDF를 올려 주세요.")
        if url.path == "/api/colors":
            try:
                return self._json({"colors": find_colors(main, original, body.get("pages") or None)})
            except ValueError as e:
                return self._err(str(e))
        if url.path == "/api/run":
            opts = body.get("options") or {}
            if opts.get("title"):
                main.title = str(opts["title"])[:200]
            jid = uuid.uuid4().hex[:12]
            job = Job(jid, STATE.workdir / f"job_{jid}", Path(main.name).stem or "책")
            STATE.jobs[jid] = job
            argv = build_argv(main, original, job.out_dir, opts)
            api_key = (self.headers.get("X-Anthropic-Key") or "").strip() or None if STATE.server else None
            threading.Thread(target=run_job, args=(job, argv, api_key), daemon=True).start()
            return self._json({"job": jid})
        return self._err("없는 주소입니다.", 404)


# ── 시작 ────────────────────────────────────────────────────────────────

def _busy() -> bool:
    return any(j.status == "running" for j in STATE.jobs.values())


def _watchdog(server) -> None:
    """데스크톱 앱은 터미널 창이 없으니, 끝내기 버튼을 누르거나 화면을 닫고 한참 지나면 스스로 끝낸다."""
    while True:
        time.sleep(2)
        idle = time.monotonic() - STATE.last_ping
        if STATE.quit_requested or (idle > DESKTOP_IDLE_QUIT and not _busy()):
            server.shutdown()
            return


def serve(port: int = 8765, open_browser: bool = True, desktop: bool = False) -> None:
    global STATE
    if sys.stdout is None:   # 창 없는 앱(pyinstaller --windowed)에서는 print할 곳이 없다
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    from .cli import utf8_console

    utf8_console()
    STATE = State(desktop=desktop)
    load_saved_key()
    server = None
    for p in [port] + list(range(port + 1, port + 20)) + [0]:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            break
        except OSError:
            continue
    if server is None:
        print("빈 포트를 찾지 못했습니다.", file=sys.stderr)
        sys.exit(1)
    url = f"http://127.0.0.1:{server.server_address[1]}/?t={STATE.token}"
    print("📚 필기 요약 실행 화면을 열었습니다.", flush=True)
    print(f"   브라우저가 안 열리면 이 주소를 복사해 여세요: {url}", flush=True)
    print("   화면의 '끝내기'를 누르면 끝납니다." if desktop else "   끝내려면 이 창을 닫거나 Ctrl+C 를 누르세요.", flush=True)
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    if desktop:
        threading.Thread(target=_watchdog, args=(server,), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shutil.rmtree(STATE.workdir, ignore_errors=True)
        print("\n종료했습니다. 임시 파일을 지웠습니다.", flush=True)


def _cleanup_loop() -> None:
    """서버 모드: 오래된 업로드·결과를 지운다."""
    while True:
        time.sleep(60)
        cleanup_expired()


def cleanup_expired(now: Optional[float] = None) -> int:
    now = time.monotonic() if now is None else now
    removed = 0
    for uid, up in list(STATE.uploads.items()):
        if now - up.created > STATE.ttl:
            shutil.rmtree(up.path.parent, ignore_errors=True)
            STATE.uploads.pop(uid, None)
            removed += 1
    for jid, job in list(STATE.jobs.items()):
        if job.status != "running" and now - job.created > STATE.ttl:
            shutil.rmtree(job.out_dir, ignore_errors=True)
            STATE.jobs.pop(jid, None)
            removed += 1
    return removed


def serve_public(host: str, port: int, access_code: str, ttl_minutes: int, max_upload_mb: int) -> None:
    """태블릿·폰 앱용 서버."""
    global STATE
    from .cli import utf8_console

    utf8_console()
    if len(access_code) < 8:
        print("접속 코드가 필요합니다 (8자 이상). --access-code 또는 PDFSUMMARY_ACCESS_CODE 로 정하세요.", file=sys.stderr)
        sys.exit(2)
    STATE = State(server=True, access_code=access_code, max_upload=max_upload_mb * 1024 * 1024, ttl=ttl_minutes * 60)
    server = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    print(f"📡 필기 요약 서버: http://{host}:{server.server_address[1]}  (파일 보관 {ttl_minutes}분, 업로드 {max_upload_mb}MB까지)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shutil.rmtree(STATE.workdir, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="pdfsummary-app", description="필기 요약 실행 화면 (브라우저) / 앱용 서버")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    p.add_argument("--desktop", action="store_true",
                   help="설치 앱 모드: 화면에 '끝내기' 버튼을 두고, 화면을 닫고 3분이 지나면 스스로 끝냄")
    p.add_argument("--server", action="store_true", help="태블릿·폰 앱이 붙는 서버로 실행 (접속 코드 필요)")
    p.add_argument("--host", default="0.0.0.0", help="서버 모드에서 받을 주소 (기본 0.0.0.0)")
    p.add_argument("--access-code", default=os.environ.get("PDFSUMMARY_ACCESS_CODE", ""),
                   help="서버 모드 접속 코드 (앱 설정에 같은 값을 넣는다). 환경 변수 PDFSUMMARY_ACCESS_CODE로도 줄 수 있다")
    p.add_argument("--ttl-minutes", type=int, default=int(os.environ.get("PDFSUMMARY_TTL_MINUTES", "60")))
    p.add_argument("--max-upload-mb", type=int, default=int(os.environ.get("PDFSUMMARY_MAX_UPLOAD_MB", "300")))
    a = p.parse_args(argv)
    if a.server:
        port = int(os.environ.get("PORT", a.port)) if a.port == 8765 else a.port
        serve_public(a.host, port, a.access_code, a.ttl_minutes, a.max_upload_mb)
        return 0
    serve(a.port, not a.no_browser, desktop=a.desktop or bool(getattr(sys, "frozen", False)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
