"""필기 앱 계정: 가입·로그인·세션·비밀번호·삭제·틀린 횟수 제한, 그리고 로그인으로 동기화."""

import json
import time

import pytest

import pdfsummary.app as app
from pdfsummary import accounts as A
from pdfsummary.accounts import AccountError, AccountStore, check_password, hash_password
from pdfsummary.sync import SyncStore, space_id

from test_server import call, server  # noqa: F401


@pytest.fixture()
def acc(tmp_path):
    s = SyncStore(tmp_path / "sync")
    yield AccountStore(s)
    s.close()


def op(cid):
    return {"cid": cid, "nb": "n1", "w": [{"t": "stroke", "nb": "n1", "page": "p", "id": cid, "v": {"x": 1}}]}


def test_password_hash():
    h = hash_password("correct horse")
    assert h.startswith("scrypt$") and "correct" not in h
    assert check_password("correct horse", h)
    assert not check_password("wrong horse", h)
    assert hash_password("correct horse") != h   # 소금이 달라서
    assert not check_password("x", "garbage")


def test_signup_login_and_sessions(acc):
    r = acc.signup(" Me@Example.com ", "password1", "아이패드")
    assert r["email"] == "me@example.com"
    t1 = r["token"]
    s1 = acc.session(t1)
    assert s1["email"] == "me@example.com" and acc.sync.has_space(s1["space"])
    with pytest.raises(AccountError) as e:
        acc.signup("me@example.com", "password2")
    assert e.value.status == 409
    with pytest.raises(AccountError):
        acc.signup("not-an-email", "password1")
    with pytest.raises(AccountError):
        acc.signup("a@b.co", "short")
    # 다른 기기에서 로그인 → 같은 공간
    t2 = acc.login("ME@example.com", "password1", "갤럭시탭")["token"]
    assert acc.session(t2)["space"] == s1["space"] and t2 != t1
    with pytest.raises(AccountError) as e:
        acc.login("me@example.com", "wrong-pass")
    assert e.value.status == 401
    with pytest.raises(AccountError) as e:
        acc.login("nobody@example.com", "password1")
    assert e.value.status == 401
    ss = acc.sessions(t2)
    assert {s["device"] for s in ss} == {"아이패드", "갤럭시탭"}
    assert [s["current"] for s in ss if s["device"] == "갤럭시탭"] == [True]
    # 아이패드를 잃어버림 → 갤럭시탭에서 로그아웃시키기
    acc.revoke(t2, next(s["id"] for s in ss if s["device"] == "아이패드"))
    assert acc.session(t1) is None and acc.session(t2)
    assert acc.me(t2)["devices"] == 1
    acc.logout(t2)
    assert acc.session(t2) is None
    with pytest.raises(AccountError) as e:
        acc.me(t2)
    assert e.value.status == 401


def test_password_change_logs_out_other_devices(acc):
    t1 = acc.signup("a@example.com", "password1")["token"]
    t2 = acc.login("a@example.com", "password1")["token"]
    with pytest.raises(AccountError):
        acc.change_password(t1, "wrong-old", "password2")
    acc.change_password(t1, "password1", "password2")
    assert acc.session(t1) and acc.session(t2) is None
    with pytest.raises(AccountError):
        acc.login("a@example.com", "password1")
    assert acc.login("a@example.com", "password2")["token"]
    # 관리자가 비밀번호를 새로 정하면 모든 기기가 로그아웃
    acc.reset_password("a@example.com", "password3")
    assert acc.session(t1) is None
    assert acc.login("a@example.com", "password3")["token"]


def test_too_many_wrong_passwords(acc, monkeypatch):
    acc.signup("b@example.com", "password1")
    for _ in range(A.FAIL_PER_EMAIL):
        with pytest.raises(AccountError):
            acc.login("b@example.com", "nope-nope", ip="1.2.3.4")
    with pytest.raises(AccountError) as e:
        acc.login("b@example.com", "password1", ip="1.2.3.4")   # 맞는 비밀번호여도 잠시 막힘
    assert e.value.status == 429
    # 1분 지나면 다시
    real = A.time.monotonic
    monkeypatch.setattr(A.time, "monotonic", lambda: real() + A.FAIL_WINDOW + 1)
    assert acc.login("b@example.com", "password1", ip="1.2.3.4")["token"]


def test_link_code_space_and_delete(acc):
    code = acc.sync.create_space()
    acc.sync.push(space_id(code), "A", [op("aaaaaa1")])
    t = acc.signup("c@example.com", "password1", link_code=code)["token"]
    sid = acc.session(t)["space"]
    assert sid == space_id(code) and acc.sync.pull(sid, 0)["last"] == 1   # 코드로 쓰던 노트를 이어받음
    with pytest.raises(AccountError) as e:
        acc.signup("d@example.com", "password1", link_code=code)
    assert e.value.status == 409
    with pytest.raises(AccountError):
        acc.signup("d@example.com", "password1", link_code="AAAAA-BBBBB")
    with pytest.raises(AccountError):
        acc.delete(t, "wrong-pass")
    acc.delete(t, "password1")
    assert acc.session(t) is None and not acc.sync.has_space(sid) and acc.sync.pull(sid, 0)["ops"] == []
    with pytest.raises(AccountError):
        acc.login("c@example.com", "password1")


def test_http_account_sync(server, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setenv("PDFSUMMARY_SYNC_DIR", str(tmp_path / "sync"))
    monkeypatch.setattr(app, "_SYNC", None)
    assert json.loads(call(server, "/api/state")[1])["accounts"] is True
    # 서버 접속 코드 없이는 가입도 못 한다
    assert call(server, "/api/account/signup", code=None, data={"email": "e@example.com", "password": "password1"})[0] == 403
    s, b, _ = call(server, "/api/account/signup", data={"email": "e@example.com", "password": "password1", "device": "웹"})
    assert s == 200
    t1 = json.loads(b)["token"]
    s, b, _ = call(server, "/api/account/login", data={"email": "e@example.com", "password": "password1", "device": "폰"})
    t2 = json.loads(b)["token"]
    assert call(server, "/api/account/login", data={"email": "e@example.com", "password": "xxxxxxxxx"})[0] == 401
    assert call(server, "/api/account/signup", data={"email": "e@example.com", "password": "password1"})[0] == 409
    assert json.loads(call(server, "/api/account/me", headers={"X-Session": t1})[1])["email"] == "e@example.com"
    # 한 기기가 보낸 작업을 같은 계정의 다른 기기가 받는다
    s, b, _ = call(server, "/api/sync/push", data={"device": "W", "ops": [op("ffffff1")]}, headers={"X-Session": t1})
    assert s == 200 and json.loads(b)["seqs"] == [1]
    s, b, _ = call(server, "/api/sync/pull?since=0", headers={"X-Session": t2})
    assert json.loads(b)["ops"][0]["cid"] == "ffffff1"
    # 다른 계정은 못 본다
    t3 = json.loads(call(server, "/api/account/signup", data={"email": "f@example.com", "password": "password1"})[1])["token"]
    assert json.loads(call(server, "/api/sync/pull?since=0", headers={"X-Session": t3})[1])["ops"] == []
    # 세션 목록·로그아웃 → 401 (다시 로그인하라는 뜻)
    ss = json.loads(call(server, "/api/account/sessions", headers={"X-Session": t1})[1])["sessions"]
    assert len(ss) == 2
    assert call(server, "/api/account/logout", data={}, headers={"X-Session": t2})[0] == 200
    assert call(server, "/api/sync/pull?since=0", headers={"X-Session": t2})[0] == 401
    assert call(server, "/api/sync/push", data={"device": "P", "ops": [op("gggggg1")]}, headers={"X-Session": t2})[0] == 401
    # 비밀번호 바꾸기 → 계정 지우기
    assert call(server, "/api/account/password", data={"old": "password1", "new": "password2"}, headers={"X-Session": t1})[0] == 200
    assert call(server, "/api/account/delete", data={"password": "password1"}, headers={"X-Session": t1})[0] == 401
    assert call(server, "/api/account/delete", data={"password": "password2"}, headers={"X-Session": t1})[0] == 200
    assert call(server, "/api/account/me", headers={"X-Session": t1})[0] == 401
    app._SYNC.close()
    monkeypatch.setattr(app, "_SYNC", None)


def test_admin_cli(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PDFSUMMARY_SYNC_DIR", str(tmp_path / "sync"))
    s = SyncStore(tmp_path / "sync")
    AccountStore(s).signup("g@example.com", "password1")
    s.close()
    monkeypatch.setenv("PDFSUMMARY_NEW_PASSWORD", "new-password")
    assert A.main(["reset-password", "G@example.com"]) == 0
    assert A.main(["list"]) == 0
    assert "g@example.com" in capsys.readouterr().out
    assert A.main(["reset-password", "nobody@example.com"]) == 1
    s = SyncStore(tmp_path / "sync")
    assert AccountStore(s).login("g@example.com", "new-password")["token"]
    s.close()


# ── 비밀번호 찾기 메일 ──
import re  # noqa: E402
import socketserver  # noqa: E402
import threading  # noqa: E402
from email import message_from_bytes, policy  # noqa: E402
from pathlib import Path  # noqa: E402

from pdfsummary.mailer import Mailer  # noqa: E402


def mails(d: Path):
    out = []
    for f in sorted(d.glob("*.eml")) if d.exists() else []:
        m = message_from_bytes(f.read_bytes(), policy=policy.default)
        out.append((m["To"], m["Subject"], m.get_content()))
    return out


def code_of(text):
    return re.search(r"코드: (\d{6})", text).group(1)


def signup_by_mail(acc, box, email, pw, **kw):
    """메일 서버가 있는 서버에서 가입: 확인 코드 메일 → 코드로 가입"""
    assert acc.signup_start(email) == {"verify": True}
    return acc.signup(email, pw, code=code_of(mails(box)[-1][2]), **kw)


@pytest.fixture()
def macc(tmp_path):
    s = SyncStore(tmp_path / "sync")
    a = AccountStore(s, Mailer(outdir=tmp_path / "mail"))
    a.deliver = lambda fn: fn()   # 시험에서는 바로 보낸다
    yield a, tmp_path / "mail"
    s.close()


def test_forgot_and_reset(macc):
    acc, box = macc
    t_old = signup_by_mail(acc, box, "h@example.com", "old-password")["token"]
    acc.forgot("H@Example.com", ip="1.1.1.1")
    (to, subject, text) = mails(box)[-1]
    assert to == "h@example.com" and "비밀번호 찾기" in subject
    code = code_of(text)
    assert code in subject and "15분" in text
    # 가입하지 않은 이메일: 같은 답, 메일은 안 감
    acc.forgot("nobody@example.com", ip="1.1.1.1")
    assert len(mails(box)) == 2
    wrong = "000000" if code != "000000" else "111111"
    with pytest.raises(AccountError) as e:
        acc.reset("h@example.com", wrong, "new-password")
    assert e.value.status == 401
    with pytest.raises(AccountError):
        acc.reset("h@example.com", code, "short")   # 새 비밀번호가 너무 짧음
    r = acc.reset("h@example.com", f"{code[:3]} {code[3:]}", "new-password", "폰")   # 띄어 써도
    assert r["email"] == "h@example.com" and acc.session(r["token"])
    assert acc.session(t_old) is None   # 다른 기기는 모두 로그아웃
    with pytest.raises(AccountError):
        acc.login("h@example.com", "old-password")
    assert acc.login("h@example.com", "new-password")["token"]
    with pytest.raises(AccountError):   # 한 번 쓴 코드는 끝
        acc.reset("h@example.com", code, "other-password")


def test_reset_code_limits(macc, monkeypatch):
    acc, box = macc
    signup_by_mail(acc, box, "i@example.com", "password1")
    acc.forgot("i@example.com")
    code = code_of(mails(box)[-1][2])
    wrong = "000000" if code != "000000" else "111111"
    # 1분 안에 또 요청하면 막힘
    with pytest.raises(AccountError) as e:
        acc.forgot("i@example.com")
    assert e.value.status == 429
    # 5번 틀리면 맞는 코드도 소용없음
    for _ in range(A.RESET_TRIES):
        with pytest.raises(AccountError):
            acc.reset("i@example.com", wrong, "new-password", ip=f"9.9.9.{_}")
    with pytest.raises(AccountError):
        acc.reset("i@example.com", code, "new-password")
    # 새 코드를 받으면 다시 (1분 뒤)
    real = A.time.monotonic
    monkeypatch.setattr(A.time, "monotonic", lambda: real() + A.RESET_GAP + 1)
    acc.forgot("i@example.com")
    code2 = code_of(mails(box)[-1][2])
    # 15분이 지나면 끝
    real_time = A.time.time
    monkeypatch.setattr(A.time, "time", lambda: real_time() + A.RESET_TTL + 1)
    with pytest.raises(AccountError):
        acc.reset("i@example.com", code2, "new-password")
    monkeypatch.setattr(A.time, "time", real_time)
    assert acc.reset("i@example.com", code2, "new-password")["token"]


def test_forgot_without_mail_server(acc):
    acc.signup("j@example.com", "password1")
    with pytest.raises(AccountError) as e:
        acc.forgot("j@example.com")
    assert e.value.status == 503


class _SmtpSink(socketserver.StreamRequestHandler):
    """시험용 아주 작은 SMTP 서버 (받은 메일을 server.got에)"""

    def handle(self):
        w = lambda s: self.wfile.write((s + "\r\n").encode())  # noqa: E731
        w("220 sink")
        rcpt, data = [], None
        while True:
            line = self.rfile.readline()
            if not line:
                return
            cmd = line.decode().strip()
            up = cmd.upper()
            if up.startswith("EHLO") or up.startswith("HELO"):
                w("250 sink")
            elif up.startswith("MAIL FROM") or up.startswith("RSET") or up.startswith("NOOP"):
                w("250 ok")
            elif up.startswith("RCPT TO"):
                rcpt.append(cmd.split(":", 1)[1].strip(" <>"))
                w("250 ok")
            elif up == "DATA":
                w("354 go")
                buf = b""
                while True:
                    ln = self.rfile.readline()
                    if ln in (b".\r\n", b".\n", b""):
                        break
                    buf += ln[1:] if ln.startswith(b"..") else ln
                self.server.got.append((rcpt, buf))
                w("250 queued")
            elif up == "QUIT":
                w("221 bye")
                return
            else:
                w("502 no")


def test_real_smtp_path():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SmtpSink)
    srv.got = []
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        m = Mailer(host="127.0.0.1", port=srv.server_address[1], security="none", sender="notes@example.com")
        assert m.enabled
        m.send("k@example.com", "[필기 노트] 시험", "한글 본문 123456")
        (rcpt, raw), = srv.got
        assert rcpt == ["k@example.com"]
        msg = message_from_bytes(raw, policy=policy.default)
        assert msg["Subject"] == "[필기 노트] 시험" and "한글 본문 123456" in msg.get_content()
    finally:
        srv.shutdown()
        srv.server_close()
    # 닿지 않는 메일 서버 → MailError
    from pdfsummary.mailer import MailError
    with pytest.raises(MailError):
        Mailer(host="127.0.0.1", port=1, security="none", sender="a@b.co", timeout=2).send("x@y.zz", "s", "t")


def test_http_forgot_reset(server, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setenv("PDFSUMMARY_SYNC_DIR", str(tmp_path / "sync"))
    monkeypatch.setattr(app, "_SYNC", None)
    monkeypatch.setattr(app, "_ACCOUNTS", None)
    assert json.loads(call(server, "/api/state")[1])["mail"] is False
    assert call(server, "/api/account/forgot", data={"email": "l@example.com"})[0] == 503
    # 메일 서버가 없는 서버: 확인 없이 가입
    assert json.loads(call(server, "/api/account/signup/start", data={"email": "m@example.com"})[1]) == {"verify": False}
    assert call(server, "/api/account/signup", data={"email": "m@example.com", "password": "password1"})[0] == 200
    box = tmp_path / "mail"
    monkeypatch.setenv("PDFSUMMARY_MAIL_DIR", str(box))
    monkeypatch.setattr(app, "_ACCOUNTS", None)
    assert json.loads(call(server, "/api/state")[1])["mail"] is True
    def wait_mail(n):
        for _ in range(50):
            if len(mails(box)) >= n:
                return mails(box)[-1]
            time.sleep(0.1)
        raise AssertionError("메일이 안 옴")

    # 가입: 확인 코드 없이는 안 됨 → 코드 메일 → 코드로 가입
    assert call(server, "/api/account/signup", data={"email": "l@example.com", "password": "password1"})[0] == 400
    s, b, _ = call(server, "/api/account/signup/start", data={"email": "l@example.com"})
    assert s == 200 and json.loads(b) == {"verify": True}
    (to, subject, text) = wait_mail(1)
    assert to == "l@example.com" and "가입 확인" in subject
    assert call(server, "/api/account/signup", data={"email": "l@example.com", "password": "password1", "code": "999999" if code_of(text) != "999999" else "888888"})[0] == 401
    s, b, _ = call(server, "/api/account/signup", data={"email": "l@example.com", "password": "password1", "code": code_of(text)})
    t1 = json.loads(b)["token"]
    assert call(server, "/api/account/signup/start", data={"email": "l@example.com"})[0] == 409
    assert call(server, "/api/account/forgot", data={"email": "l@example.com"})[0] == 200
    assert call(server, "/api/account/forgot", data={"email": "who@example.com"})[0] == 200
    (to, _, text) = wait_mail(2)
    s, b, _ = call(server, "/api/account/reset", data={"email": "l@example.com", "code": code_of(text), "password": "password2", "device": "폰"})
    assert s == 200 and json.loads(b)["token"]
    assert call(server, "/api/account/me", headers={"X-Session": t1})[0] == 401
    assert call(server, "/api/account/login", data={"email": "l@example.com", "password": "password2"})[0] == 200
    app._SYNC.close()
    monkeypatch.setattr(app, "_SYNC", None)
    monkeypatch.setattr(app, "_ACCOUNTS", None)


def test_signup_email_verification(macc, tmp_path):
    acc, box = macc
    with pytest.raises(AccountError) as e:   # 코드 없이 가입 불가
        acc.signup("n@example.com", "password1")
    assert e.value.status == 400
    assert acc.signup_start("N@Example.com") == {"verify": True}
    (to, subject, text), = mails(box)
    assert to == "n@example.com" and "가입 확인" in subject
    code = code_of(text)
    wrong = "000000" if code != "000000" else "111111"
    with pytest.raises(AccountError) as e:
        acc.signup("n@example.com", "password1", code=wrong)
    assert e.value.status == 401
    with pytest.raises(AccountError):   # 다른 이메일의 코드로는 안 됨
        acc.signup("o@example.com", "password1", code=code)
    t = acc.signup("n@example.com", "password1", code=code)["token"]
    assert acc.session(t)
    with acc.lock:
        assert acc.db.execute("SELECT verified FROM accounts WHERE email = 'n@example.com'").fetchone()[0] == 1
    with pytest.raises(AccountError) as e:   # 이미 가입됨
        acc.signup_start("n@example.com")
    assert e.value.status == 409
    # 동기화 코드 옮기기도 확인 코드가 있어야
    space_code = acc.sync.create_space()
    acc.signup_start("p@example.com")
    r = acc.signup("p@example.com", "password1", link_code=space_code, code=code_of(mails(box)[-1][2]))
    assert acc.session(r["token"])["space"] == space_id(space_code)
    # 가입 확인 메일을 보낸 직후에도 비밀번호 찾기 메일은 보낼 수 있다 (따로 셈)
    acc.forgot("p@example.com")
    assert "비밀번호 찾기" in mails(box)[-1][1]


def test_old_database_gets_verified_column(tmp_path):
    import sqlite3

    root = tmp_path / "sync"
    root.mkdir()
    db = sqlite3.connect(root / "sync.db")
    db.executescript("CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, "
                     "space TEXT NOT NULL, created REAL NOT NULL);")
    db.execute("INSERT INTO accounts VALUES ('a1', 'old@example.com', ?, 's', 0)", (hash_password("password1"),))
    db.commit()
    db.close()
    s = SyncStore(root)
    acc = AccountStore(s)
    assert acc.login("old@example.com", "password1")["token"]   # 예전 계정은 그대로 로그인
    with acc.lock:
        assert acc.db.execute("SELECT verified FROM accounts").fetchone()[0] == 0
    s.close()
