"""Google 계정으로 로그인: 앱이 Google에서 받은 ID 토큰(JWT)을 서버가 직접 확인한다.

- 서명: Google이 공개하는 키(JWKS)로 RS256 서명을 확인 (키는 받아 두고 Cache-Control 시간만큼 다시 씀)
- 내용: 발급자(accounts.google.com) · 받는 앱(우리 클라이언트 ID) · 만료 · 이메일 확인 여부
- 서버 환경 변수 (Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID):
    PDFSUMMARY_GOOGLE_WEB_CLIENT_ID      웹 애플리케이션 클라이언트 ID (웹 앱·안드로이드 앱이 씀)
    PDFSUMMARY_GOOGLE_IOS_CLIENT_ID      iOS 클라이언트 ID (아이패드·아이폰 앱이 씀)
    PDFSUMMARY_GOOGLE_ANDROID_CLIENT_ID  안드로이드 클라이언트 ID (있으면 함께 받아 줌)
  웹 클라이언트 ID가 없으면 Google 로그인은 꺼진다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.request
from typing import Callable, Optional

JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("accounts.google.com", "https://accounts.google.com")
SKEW = 60   # 기기 시계가 조금 틀려도
# RSA PKCS#1 v1.5 서명 안의 'SHA-256' 표시 (DigestInfo)
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class GoogleAuthError(ValueError):
    pass


def b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def rsa_verify(n: int, e: int, msg: bytes, sig: bytes) -> bool:
    """RS256 (RSASSA-PKCS1-v1_5 + SHA-256) 서명 확인"""
    k = (n.bit_length() + 7) // 8
    s = int.from_bytes(sig, "big")
    if len(sig) != k or s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = _SHA256_PREFIX + hashlib.sha256(msg).digest()
    if k < len(t) + 11:
        return False
    return hmac.compare_digest(em, b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t)


def _fetch(url: str) -> tuple[dict, float]:
    with urllib.request.urlopen(url, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
        m = re.search(r"max-age=(\d+)", r.headers.get("Cache-Control") or "")
    return data, float(m.group(1)) if m else 3600.0


class GoogleVerifier:
    def __init__(self, client_ids: dict[str, str] | None = None, jwks_url: str = JWKS_URL,
                 fetch: Callable[[str], tuple[dict, float]] = _fetch, now: Callable[[], float] = time.time):
        self.client_ids = {k: v for k, v in (client_ids or {}).items() if v}
        self.jwks_url = jwks_url
        self.fetch = fetch
        self.now = now
        self.keys: dict[str, tuple[int, int]] = {}
        self.keys_until = 0.0
        self.last_fetch = 0.0
        self.lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "GoogleVerifier":
        e = os.environ.get
        return cls({"web": e("PDFSUMMARY_GOOGLE_WEB_CLIENT_ID", "").strip(),
                    "ios": e("PDFSUMMARY_GOOGLE_IOS_CLIENT_ID", "").strip(),
                    "android": e("PDFSUMMARY_GOOGLE_ANDROID_CLIENT_ID", "").strip()},
                   jwks_url=e("PDFSUMMARY_GOOGLE_JWKS_URL") or JWKS_URL)

    @property
    def enabled(self) -> bool:
        return bool(self.client_ids.get("web"))

    def public_ids(self) -> Optional[dict]:
        """앱에 알려 줄 클라이언트 ID (비밀이 아님)"""
        if not self.enabled:
            return None
        return {k: v for k, v in self.client_ids.items() if k in ("web", "ios")}

    def _key(self, kid: str) -> tuple[int, int]:
        with self.lock:
            now = self.now()
            stale = now >= self.keys_until
            # 모르는 키가 오면 다시 받아 본다 (Google이 키를 바꿈). 너무 자주는 말고.
            if stale or (kid not in self.keys and now - self.last_fetch > 30):
                try:
                    data, ttl = self.fetch(self.jwks_url)
                except Exception as e:
                    if not self.keys:
                        raise GoogleAuthError("Google 공개 키를 받지 못했어요. 서버의 인터넷 연결을 확인해 주세요.") from e
                else:
                    self.keys = {k["kid"]: (int.from_bytes(b64url(k["n"]), "big"), int.from_bytes(b64url(k["e"]), "big"))
                                 for k in data.get("keys", []) if k.get("kty") == "RSA" and k.get("kid")}
                    self.keys_until = now + max(60.0, min(ttl, 24 * 3600.0))
                    self.last_fetch = now
            if kid not in self.keys:
                raise GoogleAuthError("Google 로그인 확인에 실패했어요 (모르는 키).")
            return self.keys[kid]

    def verify(self, token: str) -> dict:
        """ID 토큰 확인 → {sub, email, name}. 틀리면 GoogleAuthError."""
        if not self.enabled:
            raise GoogleAuthError("이 서버는 Google 로그인이 설정되지 않았어요.")
        try:
            h64, p64, s64 = (token or "").split(".")
            header = json.loads(b64url(h64))
            claims = json.loads(b64url(p64))
            sig = b64url(s64)
        except (ValueError, TypeError):
            raise GoogleAuthError("Google 로그인 정보가 잘못되었어요.") from None
        if header.get("alg") != "RS256":
            raise GoogleAuthError("Google 로그인 정보가 잘못되었어요.")
        n, e = self._key(str(header.get("kid") or ""))
        if not rsa_verify(n, e, f"{h64}.{p64}".encode(), sig):
            raise GoogleAuthError("Google 로그인 서명이 맞지 않아요.")
        now = self.now()
        aud = claims.get("aud")
        auds = aud if isinstance(aud, list) else [aud]
        if claims.get("iss") not in ISSUERS:
            raise GoogleAuthError("Google이 발급한 로그인이 아니에요.")
        if not any(a in self.client_ids.values() for a in auds):
            raise GoogleAuthError("이 앱용 Google 로그인이 아니에요 (클라이언트 ID가 다름).")
        if not isinstance(claims.get("exp"), (int, float)) or now > claims["exp"] + SKEW:
            raise GoogleAuthError("Google 로그인 시간이 지났어요. 다시 해 주세요.")
        if isinstance(claims.get("iat"), (int, float)) and claims["iat"] > now + 5 * 60:
            raise GoogleAuthError("Google 로그인 정보가 잘못되었어요.")
        email = str(claims.get("email") or "").strip().lower()
        if not claims.get("sub") or not email:
            raise GoogleAuthError("Google 계정의 이메일을 알 수 없어요.")
        if claims.get("email_verified") not in (True, "true"):
            raise GoogleAuthError("이메일이 확인되지 않은 Google 계정이에요.")
        return {"sub": str(claims["sub"]), "email": email, "name": str(claims.get("name") or "")}
