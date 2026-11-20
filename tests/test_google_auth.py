"""Google 로그인: ID 토큰 확인(서명·발급자·받는 앱·만료·이메일 확인)과 계정 잇기. 시험용 RSA 키로 직접 서명한다."""

import base64
import hashlib
import json
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import pdfsummary.app as app
from pdfsummary.accounts import AccountError, AccountStore
from pdfsummary.google_auth import GoogleAuthError, GoogleVerifier, rsa_verify
from pdfsummary.sync import SyncStore, space_id

from test_server import call, server  # noqa: F401

WEB, IOS = "web-client.apps.googleusercontent.com", "ios-client.apps.googleusercontent.com"


# ── 시험용 RSA 키 (파이썬만으로) ──
def _prime(bits, rnd):
    while True:
        n = rnd.getrandbits(bits) | (1 << (bits - 1)) | 1
        if all(n % p for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)) and _probable_prime(n, rnd):
            return n


def _probable_prime(n, rnd):
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(20):
        x = pow(rnd.randrange(2, n - 1), d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


class Key:
    def __init__(self, kid, seed):
        rnd = random.Random(seed)
        e = 65537
        while True:
            p, q = _prime(1024, rnd), _prime(1024, rnd)
            phi = (p - 1) * (q - 1)
            if p != q and phi % e:
                break
        self.kid, self.n, self.e, self.d = kid, p * q, e, pow(e, -1, phi)

    def jwk(self):
        b = lambda i: base64.urlsafe_b64encode(i.to_bytes((i.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()  # noqa: E731
        return {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": self.kid, "n": b(self.n), "e": b(self.e)}

    def sign(self, msg: bytes) -> bytes:
        k = (self.n.bit_length() + 7) // 8
        t = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(msg).digest()
        em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
        return pow(int.from_bytes(em, "big"), self.d, self.n).to_bytes(k, "big")


def enc(o):
    return base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()


def token(key, alg="RS256", kid=None, **claims):
    now = int(time.time())
    c = {"iss": "https://accounts.google.com", "aud": WEB, "sub": "1001", "email": "g@example.com",
         "email_verified": True, "iat": now, "exp": now + 3600, "name": "구글 사용자"}
    c.update(claims)
    h = enc({"alg": alg, "kid": kid or key.kid, "typ": "JWT"})
    p = enc({k: v for k, v in c.items() if v is not None})
    return f"{h}.{p}." + base64.urlsafe_b64encode(key.sign(f"{h}.{p}".encode())).rstrip(b"=").decode()


@pytest.fixture(scope="module")
def keys():
    return Key("k1", 1), Key("k2", 2)


@pytest.fixture()
def verifier(keys):
    got = {"n": 0, "keys": [keys[0]]}

    def fetch(url):
        got["n"] += 1
        return {"keys": [k.jwk() for k in got["keys"]]}, 3600

    v = GoogleVerifier({"web": WEB, "ios": IOS}, fetch=fetch)
    v.fetched = got
    return v


def test_rsa_verify(keys):
    k = keys[0]
    sig = k.sign(b"hello")
    assert rsa_verify(k.n, k.e, b"hello", sig)
    assert not rsa_verify(k.n, k.e, b"hellp", sig)
    assert not rsa_verify(k.n, k.e, b"hello", sig[:-1] + bytes([sig[-1] ^ 1]))
    assert not rsa_verify(keys[1].n, keys[1].e, b"hello", sig)


def test_verify_good_and_bad_tokens(verifier, keys):
    k1, k2 = keys
    assert verifier.verify(token(k1)) == {"sub": "1001", "email": "g@example.com", "name": "구글 사용자"}
    assert verifier.verify(token(k1, aud=IOS, email="G@Example.COM"))["email"] == "g@example.com"
    assert verifier.verify(token(k1, iss="accounts.google.com"))["sub"] == "1001"
    bad = [
        token(k1, aud="someone-else.apps.googleusercontent.com"),   # 다른 앱용
        token(k1, iss="https://evil.example.com"),                  # 다른 발급자
        token(k1, exp=int(time.time()) - 3600),                     # 만료
        token(k1, email_verified=False),                            # 이메일 확인 안 됨
        token(k1, email=None),
        token(k2, kid="k1"),                                        # 다른 키로 서명
        token(k1, alg="none"),
        "not.a.token",
        "",
    ]
    for t in bad:
        with pytest.raises(GoogleAuthError):
            verifier.verify(t)
    # 내용을 바꾸면 서명이 안 맞음
    h, p, s = token(k1).split(".")
    forged = enc({**json.loads(base64.urlsafe_b64decode(p + "==")), "email": "victim@example.com"})
    with pytest.raises(GoogleAuthError):
        verifier.verify(f"{h}.{forged}.{s}")


def test_keys_are_cached_and_rotated(verifier, keys):
    k1, k2 = keys
    verifier.verify(token(k1))
    verifier.verify(token(k1))
    assert verifier.fetched["n"] == 1   # 키는 한 번만 받는다
    # Google이 키를 바꿈 → 모르는 키가 오면 다시 받아 본다 (30초에 한 번까지)
    verifier.fetched["keys"] = [k1, k2]
    with pytest.raises(GoogleAuthError):
        verifier.verify(token(k2))   # 방금 받았으니 아직 다시 받지 않음
    real = verifier.now
    verifier.now = lambda: real() + 31
    assert verifier.verify(token(k2))["sub"] == "1001"
    assert verifier.fetched["n"] == 2


def test_disabled_and_unreachable():
    v = GoogleVerifier({})
    assert not v.enabled and v.public_ids() is None
    with pytest.raises(GoogleAuthError):
        v.verify("a.b.c")

    def down(url):
        raise OSError("no network")

    v = GoogleVerifier({"web": WEB}, fetch=down)
    assert v.public_ids() == {"web": WEB}
    with pytest.raises(GoogleAuthError) as e:
        v.verify(token(Key("k1", 1)))
    assert "공개 키" in str(e.value)


@pytest.fixture()
def acc(tmp_path, verifier):
    s = SyncStore(tmp_path / "sync")
    yield AccountStore(s, google=verifier)
    s.close()


def test_google_signup_then_login(acc, keys):
    k1 = keys[0]
    r = acc.google_login(token(k1), "iPad")
    assert r["created"] and r["email"] == "g@example.com"
    me = acc.me(r["token"])
    assert me["google"] and not me["has_password"]
    # 비밀번호가 없는 계정: 비밀번호 로그인은 안 됨
    with pytest.raises(AccountError):
        acc.login("g@example.com", "!")
    # 다시 Google로 → 같은 계정
    r2 = acc.google_login(token(k1), "웹")
    assert not r2["created"] and acc.session(r2["token"])["space"] == acc.session(r["token"])["space"]
    # Google 이메일이 바뀌어도 같은 사람(sub)이면 같은 계정
    r3 = acc.google_login(token(k1, email="new@example.com"))
    assert acc.session(r3["token"])["account"] == acc.session(r["token"])["account"]
    # 비밀번호 만들기 (예전 비밀번호 없이) → 이제 비밀번호로도 로그인
    acc.change_password(r["token"], "", "password1")
    assert acc.me(r["token"])["has_password"]
    assert acc.login("g@example.com", "password1")["token"]
    # 다른 Google 계정이 같은 이메일로 → 거절
    with pytest.raises(AccountError) as e:
        acc.google_login(token(k1, sub="2002"))
    assert e.value.status == 409


def test_google_links_existing_verified_account(acc, keys):
    acc.mailer.outdir = None
    t = acc.signup("g@example.com", "password1")["token"]   # 메일 서버 없는 서버라 확인 없이 가입 (verified 0)
    with acc.lock:
        acc.db.execute("UPDATE accounts SET verified = 1")   # 이메일 확인을 거친 계정이라고 치고
    r = acc.google_login(token(keys[0]))
    assert not r["created"]
    assert acc.session(t) and acc.login("g@example.com", "password1")   # 비밀번호·로그인은 그대로
    assert acc.me(r["token"])["google"] and acc.me(r["token"])["has_password"]


def test_google_takes_over_unverified_account(acc, keys):
    # 누군가 남의 이메일로 (확인 없이) 먼저 가입해 둔 경우 → 진짜 주인이 Google로 오면 그 사람의 비밀번호·로그인은 끝
    t = acc.signup("g@example.com", "attacker-pw")["token"]
    r = acc.google_login(token(keys[0]))
    assert acc.session(t) is None
    with pytest.raises(AccountError):
        acc.login("g@example.com", "attacker-pw")
    assert not acc.me(r["token"])["has_password"]


def test_google_with_link_code_and_delete(acc, keys):
    code = acc.sync.create_space()
    r = acc.google_login(token(keys[0]), link_code=code)
    assert r["created"] and acc.session(r["token"])["space"] == space_id(code)
    with pytest.raises(AccountError) as e:   # 이미 가입된 Google 계정으로 또 옮기기
        acc.google_login(token(keys[0]), link_code=acc.sync.create_space())
    assert e.value.status == 409
    # 비밀번호가 없는 계정은 이메일을 넣어 지운다
    with pytest.raises(AccountError):
        acc.delete(r["token"], "wrong@example.com")
    acc.delete(r["token"], "G@example.com")
    assert acc.session(r["token"]) is None and not acc.sync.has_space(space_id(code))


def test_bad_google_token_is_401(acc, keys):
    with pytest.raises(AccountError) as e:
        acc.google_login(token(keys[0], aud="other"))
    assert e.value.status == 401


def test_http_google_login(server, tmp_path, monkeypatch, keys):  # noqa: F811
    # Google 공개 키 대신 시험용 키를 내주는 작은 서버
    class Jwks(BaseHTTPRequestHandler):
        def do_GET(self):
            b = json.dumps({"keys": [keys[0].jwk()]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "public, max-age=600")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def log_message(self, *a):
            pass

    jw = ThreadingHTTPServer(("127.0.0.1", 0), Jwks)
    threading.Thread(target=jw.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("PDFSUMMARY_SYNC_DIR", str(tmp_path / "sync"))
        monkeypatch.setattr(app, "_SYNC", None)
        monkeypatch.setattr(app, "_ACCOUNTS", None)
        assert json.loads(call(server, "/api/state")[1])["google"] is None
        assert call(server, "/api/account/google", data={"id_token": token(keys[0])})[0] == 503
        monkeypatch.setenv("PDFSUMMARY_GOOGLE_WEB_CLIENT_ID", WEB)
        monkeypatch.setenv("PDFSUMMARY_GOOGLE_IOS_CLIENT_ID", IOS)
        monkeypatch.setenv("PDFSUMMARY_GOOGLE_JWKS_URL", f"http://127.0.0.1:{jw.server_address[1]}/certs")
        monkeypatch.setattr(app, "_ACCOUNTS", None)
        assert json.loads(call(server, "/api/state")[1])["google"] == {"web": WEB, "ios": IOS}
        s, b, _ = call(server, "/api/account/google", data={"id_token": token(keys[0]), "device": "웹"})
        assert s == 200 and json.loads(b)["created"] is True
        t = json.loads(b)["token"]
        assert json.loads(call(server, "/api/account/me", headers={"X-Session": t})[1])["google"] is True
        assert call(server, "/api/account/google", data={"id_token": token(keys[0], aud="x")})[0] == 401
        assert call(server, "/api/account/google", code=None, data={"id_token": token(keys[0])})[0] == 403
        app._SYNC.close()
        monkeypatch.setattr(app, "_SYNC", None)
        monkeypatch.setattr(app, "_ACCOUNTS", None)
    finally:
        jw.shutdown()
        jw.server_close()
