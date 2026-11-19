"""필기 앱 계정: 가입·로그인·세션·비밀번호·삭제·틀린 횟수 제한, 그리고 로그인으로 동기화."""

import json

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
