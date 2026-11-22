"""필기 앱 계정 (서버 쪽): 이메일·비밀번호로 로그인하면 그 계정의 동기화 공간을 쓴다.

- 비밀번호는 scrypt(무작위 소금)로만 둔다. 원래 비밀번호는 서버 어디에도 남지 않는다.
- 로그인하면 기기마다 '세션 토큰'을 준다. 서버에는 토큰의 해시만 둔다.
  기기는 동기화할 때 X-Session 헤더로 토큰을 보내고, 서버는 그 계정의 공간을 쓴다.
- 비밀번호를 여러 번 틀리면 잠시 막는다.
- 계정은 동기화 코드로 쓰던 공간을 그대로 이어받을 수 있다 (코드 → 계정으로 옮기기).
- 메일 서버가 설정되어 있으면(mailer.py) 가입할 때 이메일로 6자리 확인 코드를 보내, 받은 사람만 가입할 수 있다
  (오타 난 이메일로 가입해 비밀번호를 못 찾는 일이 없게, 남의 이메일로 가입하지 못하게).
- Google 계정으로도 로그인할 수 있다 (google_auth.py가 ID 토큰을 확인). 같은 이메일의 계정이 있으면 그 계정에
  Google을 이어 붙이고, 없으면 비밀번호 없는 계정을 새로 만든다. 이메일 확인을 거치지 않은 계정에 이어 붙일 때는
  (남이 그 이메일로 먼저 가입해 두었을 수 있으니) 그 계정의 비밀번호와 로그인을 모두 없앤다.
- 요금제(plan): 무료·프리미엄. Claude를 쓰는 AI 기능(나만의 노트의 'AI 설명')을 한 달에 몇 번 쓸 수 있는지가 다르다.
  결제 연동은 아직 없어서, 서버 관리자가 바꿔 준다:
    python -m pdfsummary.accounts plan 이메일 premium
  한 달 횟수는 PDFSUMMARY_AI_LIMITS="free=3,premium=100" 처럼 바꿀 수 있다 (0이면 그 요금제는 못 씀).
- 비밀번호를 잊으면: 메일로 6자리 코드를 받아 새 비밀번호를 정한다.
  코드는 15분 동안, 5번 틀리면 끝. 가입된 이메일인지 아닌지는 답에서 드러나지 않는다.
  메일 서버가 없으면 서버 관리자가 바꿔 준다:
    python -m pdfsummary.accounts reset-password 이메일   (PDFSUMMARY_SYNC_DIR이 서버와 같아야 함)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from typing import Callable, Optional

from .google_auth import GoogleAuthError, GoogleVerifier
from .mailer import Mailer, MailError
from .sync import SyncStore, space_id

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 200
SESSION_IDLE = 180 * 24 * 3600   # 이만큼 안 쓴 세션은 끝남
FAIL_WINDOW = 60.0
FAIL_PER_EMAIL = 5
FAIL_PER_IP = 30
SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}

# 요금제: 이름 → 화면에 보일 이름. AI 기능(Claude) 한 달 횟수가 다르다
PLANS = {"free": "무료", "premium": "프리미엄"}
DEFAULT_AI_LIMITS = {"free": 3, "premium": 100}


def ai_limits() -> dict[str, int]:
    """요금제마다 한 달에 AI 기능을 쓸 수 있는 횟수 (PDFSUMMARY_AI_LIMITS="free=3,premium=100"로 바꿈)"""
    out = dict(DEFAULT_AI_LIMITS)
    for part in os.environ.get("PDFSUMMARY_AI_LIMITS", "").split(","):
        k, _, v = part.partition("=")
        if k.strip() in PLANS and v.strip().isdigit():
            out[k.strip()] = int(v.strip())
    return out


def this_month(now: Optional[float] = None) -> str:
    return time.strftime("%Y-%m", time.localtime(time.time() if now is None else now))
NO_PASSWORD = "!"            # Google로만 가입해 비밀번호가 없는 계정
RESET_TTL = 15 * 60          # 메일 코드(가입 확인·비밀번호 찾기)가 살아 있는 시간
RESET_TRIES = 5              # 코드를 이만큼 틀리면 끝
RESET_GAP = 60.0             # 같은 이메일로 코드 메일은 1분에 한 번
RESET_PER_HOUR = 5           # 같은 이메일로 한 시간에
RESET_PER_IP_HOUR = 20       # 같은 곳에서 한 시간에


class AccountError(ValueError):
    """status: 400 잘못된 입력, 401 로그인 실패·세션 끝, 409 이미 있음, 429 너무 자주"""

    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode("utf-8"), salt=salt, dklen=32, maxmem=64 * 1024 * 1024, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${h.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, want = stored.split("$")
        if kind != "scrypt":
            return False
        got = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(want) // 2, maxmem=64 * 1024 * 1024)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), want)


_DUMMY = hash_password("not-a-real-password", b"0" * 16)


def _token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def _check_new_password(pw: str) -> None:
    if not isinstance(pw, str) or len(pw) < MIN_PASSWORD:
        raise AccountError(f"비밀번호는 {MIN_PASSWORD}자 이상이어야 해요.")
    if len(pw) > MAX_PASSWORD:
        raise AccountError("비밀번호가 너무 길어요.")


class AccountStore:
    """동기화 저장소(sync.db) 안에 계정·세션 표를 둔다."""

    def __init__(self, sync: SyncStore, mailer: Optional[Mailer] = None, google: Optional[GoogleVerifier] = None):
        self.sync = sync
        self.mailer = mailer or Mailer()
        self.google = google or GoogleVerifier()
        # 메일은 따로 보낸다 (답이 오는 시간으로 가입 여부가 드러나지 않게). 시험에서는 바로 보내게 바꾼다.
        self.deliver: Callable[[Callable[[], None]], None] = lambda fn: threading.Thread(target=fn, daemon=True).start()
        self.mail_errors: list[str] = []
        self.db = sync.db
        self.lock = sync.lock
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
                space TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, account TEXT NOT NULL, device TEXT NOT NULL,
                created REAL NOT NULL, used REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account);
            CREATE TABLE IF NOT EXISTS codes (
                purpose TEXT NOT NULL, key TEXT NOT NULL, code TEXT NOT NULL, expires REAL NOT NULL,
                tries INTEGER NOT NULL, PRIMARY KEY (purpose, key));
        """)
        cols = [r[1] for r in self.db.execute("PRAGMA table_info(accounts)")]
        if "verified" not in cols:   # 이메일 확인을 거친 계정인지 (예전 계정은 0)
            self.db.execute("ALTER TABLE accounts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0")
        if "google" not in cols:     # 이어 붙인 Google 계정 (Google의 사용자 번호 sub)
            self.db.execute("ALTER TABLE accounts ADD COLUMN google TEXT")
        self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS accounts_google ON accounts (google) WHERE google IS NOT NULL")
        if "plan" not in cols:       # 요금제 (예전 계정은 무료)
            self.db.execute("ALTER TABLE accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'")
        self.db.execute("CREATE TABLE IF NOT EXISTS ai_usage (account TEXT NOT NULL, month TEXT NOT NULL, "
                        "used INTEGER NOT NULL, PRIMARY KEY (account, month))")
        self.sent: dict[str, list[float]] = {}
        self.fails: dict[str, list[float]] = {}
        self.fail_lock = threading.Lock()

    # ── 틀린 횟수 ──
    def _throttled(self, keys: list[tuple[str, int]]) -> bool:
        now = time.monotonic()
        with self.fail_lock:
            for k, limit in keys:
                xs = [t for t in self.fails.get(k, []) if now - t < FAIL_WINDOW]
                self.fails[k] = xs
                if len(xs) >= limit:
                    return True
        return False

    def _failed(self, keys: list[str]) -> None:
        now = time.monotonic()
        with self.fail_lock:
            for k in keys:
                self.fails.setdefault(k, []).append(now)
            if len(self.fails) > 10000:   # 오래된 것 정리
                for k in [k for k, xs in self.fails.items() if not xs or now - xs[-1] > FAIL_WINDOW]:
                    del self.fails[k]

    # ── 세션 ──
    def _new_session(self, account: str, device: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self.lock:
            self.db.execute("INSERT INTO sessions (token, account, device, created, used) VALUES (?, ?, ?, ?, ?)",
                            (_token_hash(token), account, (device or "기기")[:80], now, now))
        return token

    def session(self, token: str) -> Optional[dict]:
        """토큰 → {account, email, space}. 없거나 끝났으면 None."""
        if not token:
            return None
        th = _token_hash(token)
        now = time.time()
        with self.lock:
            row = self.db.execute(
                "SELECT s.account, s.used, a.email, a.space, a.created FROM sessions s JOIN accounts a ON a.id = s.account "
                "WHERE s.token = ?", (th,)).fetchone()
            if not row:
                return None
            account, used, email, space, created = row
            if now - used > SESSION_IDLE:
                self.db.execute("DELETE FROM sessions WHERE token = ?", (th,))
                return None
            if now - used > 3600:   # 쓸 때마다 적지 않고 한 시간에 한 번만
                self.db.execute("UPDATE sessions SET used = ? WHERE token = ?", (now, th))
        return {"account": account, "email": email, "space": space, "created": created, "token_hash": th}

    def _need(self, token: str) -> dict:
        s = self.session(token)
        if not s:
            raise AccountError("로그인이 끝났어요. 다시 로그인해 주세요.", 401)
        return s

    # ── 가입·로그인 ──
    def _taken(self, email: str) -> bool:
        with self.lock:
            return self.db.execute("SELECT 1 FROM accounts WHERE email = ?", (email,)).fetchone() is not None

    def _space_for(self, link_code: str) -> str:
        """계정으로 옮길 동기화 코드의 공간 (다른 계정에 이미 붙었으면 안 됨)"""
        space = space_id(link_code)
        if not self.sync.has_space(space):
            raise AccountError("동기화 코드가 맞지 않아요.")
        with self.lock:
            taken = self.db.execute("SELECT 1 FROM accounts WHERE space = ?", (space,)).fetchone()
        if taken:
            raise AccountError("이 동기화 코드는 이미 다른 계정에 연결되어 있어요. 그 계정으로 로그인해 주세요.", 409)
        return space

    def signup_start(self, email: str, ip: str = "") -> dict:
        """가입 1단계: 이메일 확인 코드를 보낸다. 메일 서버가 없는 서버면 {verify: False} (확인 없이 가입)."""
        email = normalize_email(email)
        if not EMAIL.match(email):
            raise AccountError("이메일 주소 모양이 아니에요.")
        if self._taken(email):
            raise AccountError("이미 가입된 이메일이에요. 로그인해 주세요.", 409)
        if not self.mailer.enabled:
            return {"verify": False}
        self._limit_mail("signup", email, ip)
        code = self._issue("signup", email)
        self._mail(email, f"[필기 노트] 가입 확인 코드 {code}",
                   f"필기 노트 가입 확인 코드: {code}\n\n"
                   "앱의 가입 화면에 이 코드를 넣으면 가입이 끝나요.\n"
                   f"코드는 {RESET_TTL // 60}분 동안만 쓸 수 있어요.\n\n"
                   "직접 가입하려던 것이 아니라면 이 메일은 무시하세요. 가입되지 않아요.\n")
        return {"verify": True}

    def signup(self, email: str, password: str, device: str = "", link_code: str = "", code: str = "", ip: str = "") -> dict:
        """가입 2단계 (메일 서버가 있으면 1단계에서 받은 코드가 필요)"""
        email = normalize_email(email)
        if not EMAIL.match(email):
            raise AccountError("이메일 주소 모양이 아니에요.")
        _check_new_password(password)
        if self._taken(email):
            raise AccountError("이미 가입된 이메일이에요. 로그인해 주세요.", 409)
        space = self._space_for(link_code) if link_code else None
        verified = 0
        if self.mailer.enabled:
            if not re.sub(r"\D", "", code or ""):
                raise AccountError("이메일로 받은 6자리 확인 코드를 넣어 주세요.")
            self._verify("signup", email, code, ip)
            verified = 1
        pw = hash_password(password)
        aid = secrets.token_hex(12)
        if space is None:
            space = self.sync.create_space_id()
        with self.lock:
            try:
                self.db.execute("INSERT INTO accounts (id, email, pw, space, created, verified) VALUES (?, ?, ?, ?, ?, ?)",
                                (aid, email, pw, space, time.time(), verified))
            except Exception:
                raise AccountError("이미 가입된 이메일이에요. 로그인해 주세요.", 409)
        return {"token": self._new_session(aid, device), "email": email}

    def login(self, email: str, password: str, device: str = "", ip: str = "") -> dict:
        email = normalize_email(email)
        keys = [(f"e:{email}", FAIL_PER_EMAIL), (f"i:{ip}", FAIL_PER_IP)]
        if self._throttled(keys):
            raise AccountError("비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.", 429)
        with self.lock:
            row = self.db.execute("SELECT id, pw FROM accounts WHERE email = ?", (email,)).fetchone()
        # 없는 이메일도 같은 시간이 걸리게 (어떤 이메일이 가입됐는지 알아내지 못하게)
        usable = row is not None and row[1] != NO_PASSWORD
        ok = check_password(password or "", row[1] if usable else _DUMMY) and usable
        if not ok:
            self._failed([k for k, _ in keys])
            raise AccountError("이메일이나 비밀번호가 맞지 않아요.", 401)
        return {"token": self._new_session(row[0], device), "email": email}

    def google_login(self, id_token: str, device: str = "", link_code: str = "") -> dict:
        """Google ID 토큰으로 로그인 (없으면 가입). link_code: 새로 만들 때 이 동기화 코드의 노트를 이어받음."""
        try:
            g = self.google.verify(id_token)
        except GoogleAuthError as e:
            raise AccountError(str(e), 503 if "설정되지" in str(e) or "공개 키" in str(e) else 401) from None
        email = g["email"]
        with self.lock:
            row = self.db.execute("SELECT id FROM accounts WHERE google = ?", (g["sub"],)).fetchone()
            if not row:
                row2 = self.db.execute("SELECT id, verified, google FROM accounts WHERE email = ?", (email,)).fetchone()
            else:
                row2 = None
        if row:
            if link_code:
                raise AccountError("이 Google 계정은 이미 가입되어 있어요. 동기화를 끄고 Google로 로그인하면 이 기기의 노트가 그 계정으로 합쳐져요.", 409)
            return {"token": self._new_session(row[0], device), "email": email, "created": False}
        if row2:
            aid, verified, linked = row2
            if linked:   # 같은 이메일에 다른 Google 계정이 이미 붙어 있음
                raise AccountError("이 이메일의 계정에는 다른 Google 계정이 이어져 있어요.", 409)
            if link_code:
                raise AccountError("이 이메일로 가입된 계정이 이미 있어요. 동기화를 끄고 그 계정으로 로그인해 주세요.", 409)
            with self.lock:
                if verified:
                    self.db.execute("UPDATE accounts SET google = ? WHERE id = ?", (g["sub"], aid))
                else:
                    # 이메일 확인 없이 만든 계정: 그 이메일의 진짜 주인(Google이 확인)이 가져가고, 예전 비밀번호·로그인은 끝
                    self.db.execute("UPDATE accounts SET google = ?, verified = 1, pw = ? WHERE id = ?", (g["sub"], NO_PASSWORD, aid))
                    self.db.execute("DELETE FROM sessions WHERE account = ?", (aid,))
            return {"token": self._new_session(aid, device), "email": email, "created": False}
        space = self._space_for(link_code) if link_code else self.sync.create_space_id()
        aid = secrets.token_hex(12)
        with self.lock:
            try:
                self.db.execute("INSERT INTO accounts (id, email, pw, space, created, verified, google) VALUES (?, ?, ?, ?, ?, 1, ?)",
                                (aid, email, NO_PASSWORD, space, time.time(), g["sub"]))
            except Exception:
                raise AccountError("잠시 뒤에 다시 해 주세요.", 409) from None
        return {"token": self._new_session(aid, device), "email": email, "created": True}

    def logout(self, token: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE token = ?", (_token_hash(token),))

    def me(self, token: str) -> dict:
        s = self._need(token)
        with self.lock:
            n = self.db.execute("SELECT COUNT(*) FROM sessions WHERE account = ?", (s["account"],)).fetchone()[0]
            pw, google = self.db.execute("SELECT pw, google FROM accounts WHERE id = ?", (s["account"],)).fetchone()
        return {"email": s["email"], "created": s["created"], "devices": n,
                "has_password": pw != NO_PASSWORD, "google": bool(google), "ai": self._ai_status(s["account"])}

    # ── 요금제·AI 기능 횟수 ──
    def _ai_status(self, account: str) -> dict:
        limits = ai_limits()
        with self.lock:
            row = self.db.execute("SELECT plan FROM accounts WHERE id = ?", (account,)).fetchone()
            used = self.db.execute("SELECT used FROM ai_usage WHERE account = ? AND month = ?",
                                   (account, this_month())).fetchone()
        plan = row[0] if row and row[0] in PLANS else "free"
        return {"plan": plan, "label": PLANS[plan], "used": used[0] if used else 0, "limit": limits.get(plan, 0)}

    def ai_status(self, token: str) -> dict:
        """{plan, label(화면 이름), used(이번 달 쓴 횟수), limit(한 달 횟수)}"""
        return self._ai_status(self._need(token)["account"])

    def use_ai(self, token: str) -> str:
        """AI 기능을 한 번 쓴다: 횟수를 먼저 잡아 두고 계정 번호를 돌려준다 (실패하면 refund_ai로 돌려놓는다).
        못 쓰면 AccountError — 무료로 못 쓰는 기능이면 402, 이번 달 횟수를 다 썼으면 429."""
        account = self._need(token)["account"]
        limits = ai_limits()
        month = this_month()
        with self.lock:
            row = self.db.execute("SELECT plan FROM accounts WHERE id = ?", (account,)).fetchone()
            plan = row[0] if row and row[0] in PLANS else "free"
            limit = limits.get(plan, 0)
            r = self.db.execute("SELECT used FROM ai_usage WHERE account = ? AND month = ?", (account, month)).fetchone()
            used = r[0] if r else 0
            if limit <= 0:
                raise AccountError("AI 설명은 프리미엄 기능이에요.", 402)
            if used >= limit:
                more = " 프리미엄으로 바꾸면 더 쓸 수 있어요." if plan == "free" else ""
                raise AccountError(f"이번 달 AI 설명을 다 썼어요 ({limit}번). 다음 달 1일에 다시 채워져요.{more}", 429)
            self.db.execute("INSERT INTO ai_usage (account, month, used) VALUES (?, ?, 1) "
                            "ON CONFLICT (account, month) DO UPDATE SET used = used + 1", (account, month))
        return account

    def refund_ai(self, account: str) -> None:
        """AI가 답하지 못했을 때 잡아 둔 한 번을 돌려놓는다"""
        with self.lock:
            self.db.execute("UPDATE ai_usage SET used = MAX(0, used - 1) WHERE account = ? AND month = ?",
                            (account, this_month()))

    def set_plan(self, email: str, plan: str) -> None:
        if plan not in PLANS:
            raise AccountError(f"요금제는 {', '.join(PLANS)} 중 하나예요.")
        with self.lock:
            cur = self.db.execute("UPDATE accounts SET plan = ? WHERE email = ?", (plan, normalize_email(email)))
        if cur.rowcount == 0:
            raise AccountError("그런 계정이 없어요.", 404)

    def change_password(self, token: str, old: str, new: str) -> None:
        """비밀번호 바꾸기 (Google로만 가입한 계정은 새로 만들기). 이 기기 말고 다른 기기는 모두 로그아웃된다."""
        s = self._need(token)
        _check_new_password(new)
        with self.lock:
            pw = self.db.execute("SELECT pw FROM accounts WHERE id = ?", (s["account"],)).fetchone()[0]
        if pw != NO_PASSWORD and not check_password(old or "", pw):
            raise AccountError("지금 비밀번호가 맞지 않아요.", 401)
        with self.lock:
            self.db.execute("UPDATE accounts SET pw = ? WHERE id = ?", (hash_password(new), s["account"]))
            self.db.execute("DELETE FROM sessions WHERE account = ? AND token != ?", (s["account"], s["token_hash"]))
            self.db.execute("DELETE FROM codes WHERE purpose = 'reset' AND key = ?", (s["account"],))

    def delete(self, token: str, password: str) -> None:
        """계정과 서버에 있던 노트(동기화 기록·원본 PDF)를 모두 지운다. 기기 안의 노트는 남는다.
        비밀번호가 없는 계정(Google로만 가입)은 password 자리에 계정 이메일을 넣어 확인한다."""
        s = self._need(token)
        with self.lock:
            pw = self.db.execute("SELECT pw FROM accounts WHERE id = ?", (s["account"],)).fetchone()[0]
        if pw == NO_PASSWORD:
            if normalize_email(password) != s["email"]:
                raise AccountError("확인을 위해 계정 이메일을 그대로 넣어 주세요.", 401)
        elif not check_password(password or "", pw):
            raise AccountError("비밀번호가 맞지 않아요.", 401)
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE account = ?", (s["account"],))
            self.db.execute("DELETE FROM codes WHERE purpose = 'reset' AND key = ?", (s["account"],))
            self.db.execute("DELETE FROM accounts WHERE id = ?", (s["account"],))
        self.sync.delete_space(s["space"])

    def sessions(self, token: str) -> list[dict]:
        s = self._need(token)
        with self.lock:
            rows = self.db.execute("SELECT token, device, created, used FROM sessions WHERE account = ? ORDER BY used DESC",
                                   (s["account"],)).fetchall()
        return [{"id": t[:16], "device": d, "created": c, "used": u, "current": t == s["token_hash"]} for t, d, c, u in rows]

    def revoke(self, token: str, sid: str) -> None:
        """로그인된 다른 기기를 로그아웃시키기 (잃어버린 기기 등)"""
        s = self._need(token)
        if not re.fullmatch(r"[0-9a-f]{16}", sid or ""):
            raise AccountError("잘못된 요청입니다.")
        with self.lock:
            self.db.execute("DELETE FROM sessions WHERE account = ? AND substr(token, 1, 16) = ?", (s["account"], sid))

    # ── 메일 코드 (가입 확인·비밀번호 찾기) ──
    def _limit_mail(self, purpose: str, email: str, ip: str) -> None:
        now = time.monotonic()
        with self.fail_lock:
            mine = [t for t in self.sent.get(f"e:{purpose}:{email}", []) if now - t < 3600]
            here = [t for t in self.sent.get(f"i:{ip}", []) if now - t < 3600]
            if mine and now - mine[-1] < RESET_GAP:
                raise AccountError("코드 메일은 1분에 한 번 보낼 수 있어요. 잠시 뒤에 다시 해 주세요.", 429)
            if len(mine) >= RESET_PER_HOUR or len(here) >= RESET_PER_IP_HOUR:
                raise AccountError("코드 메일을 너무 많이 요청했어요. 한 시간 뒤에 다시 해 주세요.", 429)
            self.sent[f"e:{purpose}:{email}"] = mine + [now]
            self.sent[f"i:{ip}"] = here + [now]

    def _issue(self, purpose: str, key: str) -> str:
        """6자리 코드를 새로 만든다 (그 전 코드는 끝). 서버에는 해시만."""
        code = f"{secrets.randbelow(10 ** 6):06d}"
        salt = secrets.token_hex(8)
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO codes (purpose, key, code, expires, tries) VALUES (?, ?, ?, ?, 0)",
                            (purpose, key, f"{salt}${hashlib.sha256((salt + code).encode()).hexdigest()}",
                             time.time() + RESET_TTL))
        return code

    def _verify(self, purpose: str, key: str, code: str, ip: str) -> None:
        """맞으면 코드를 지우고 지나간다. 틀리면(시간 지남·5번 틀림 포함) AccountError(401)."""
        bad = AccountError("코드가 맞지 않거나 시간이 지났어요. 메일의 6자리 코드를 확인하거나 새 코드를 받아 주세요.", 401)
        if self._throttled([(f"i:{ip}", FAIL_PER_IP)]):
            raise AccountError("너무 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.", 429)
        code = re.sub(r"\D", "", code or "")
        with self.lock:
            row = self.db.execute("SELECT code, expires, tries FROM codes WHERE purpose = ? AND key = ?",
                                  (purpose, key)).fetchone()
        if not row or row[1] < time.time() or row[2] >= RESET_TRIES:
            self._failed([f"i:{ip}"])
            raise bad
        salt, want = row[0].split("$")
        if len(code) != 6 or not hmac.compare_digest(hashlib.sha256((salt + code).encode()).hexdigest(), want):
            with self.lock:
                self.db.execute("UPDATE codes SET tries = tries + 1 WHERE purpose = ? AND key = ?", (purpose, key))
            self._failed([f"i:{ip}"])
            raise bad
        with self.lock:
            self.db.execute("DELETE FROM codes WHERE purpose = ? AND key = ?", (purpose, key))

    def _mail(self, to: str, subject: str, text: str) -> None:
        def send():
            try:
                self.mailer.send(to, subject, text)
            except MailError as e:
                self.mail_errors.append(str(e))

        self.deliver(send)

    def forgot(self, email: str, ip: str = "") -> None:
        """비밀번호 찾기 코드를 메일로. 가입되지 않은 이메일이어도 같은 답(보내지는 않음)."""
        if not self.mailer.enabled:
            raise AccountError("이 서버는 메일을 보낼 수 없어요. 서버를 운영하는 사람에게 비밀번호를 새로 정해 달라고 하세요.", 503)
        email = normalize_email(email)
        if not EMAIL.match(email):
            raise AccountError("이메일 주소 모양이 아니에요.")
        self._limit_mail("reset", email, ip)
        with self.lock:
            row = self.db.execute("SELECT id FROM accounts WHERE email = ?", (email,)).fetchone()
        if not row:
            return
        code = self._issue("reset", row[0])
        self._mail(email, f"[필기 노트] 비밀번호 찾기 코드 {code}",
                   f"필기 노트 비밀번호 찾기 코드: {code}\n\n"
                   "앱의 ☁️ 동기화 → '비밀번호를 잊었어요' 화면에 이 코드를 넣고 새 비밀번호를 정하세요.\n"
                   f"코드는 {RESET_TTL // 60}분 동안만 쓸 수 있어요.\n\n"
                   "직접 요청하지 않았다면 이 메일은 무시하세요. 비밀번호는 바뀌지 않아요.\n")

    def reset(self, email: str, code: str, new: str, device: str = "", ip: str = "") -> dict:
        """메일로 받은 코드로 새 비밀번호 정하기 → 모든 기기 로그아웃, 이 기기는 로그인"""
        _check_new_password(new)
        email = normalize_email(email)
        with self.lock:
            row = self.db.execute("SELECT id FROM accounts WHERE email = ?", (email,)).fetchone()
        # 없는 이메일도 같은 답 (가입 여부가 드러나지 않게)
        self._verify("reset", row[0] if row else f"none:{email}", code, ip)
        account = row[0]
        with self.lock:
            # 메일로 코드를 받았으니 이메일도 확인된 셈
            self.db.execute("UPDATE accounts SET pw = ?, verified = 1 WHERE id = ?", (hash_password(new), account))
            self.db.execute("DELETE FROM sessions WHERE account = ?", (account,))
        with self.fail_lock:   # 비밀번호를 틀려 막혀 있었다면 풀어 준다
            self.fails.pop(f"e:{email}", None)
        return {"token": self._new_session(account, device), "email": email}

    # ── 관리자 ──
    def reset_password(self, email: str, new: str) -> None:
        _check_new_password(new)
        email = normalize_email(email)
        with self.lock:
            row = self.db.execute("SELECT id FROM accounts WHERE email = ?", (email,)).fetchone()
            if not row:
                raise AccountError("그런 계정이 없어요.", 404)
            self.db.execute("UPDATE accounts SET pw = ? WHERE id = ?", (hash_password(new), row[0]))
            self.db.execute("DELETE FROM sessions WHERE account = ?", (row[0],))


def main(argv: list[str] | None = None) -> int:
    import argparse
    import getpass
    import os
    import sys
    from pathlib import Path

    p = argparse.ArgumentParser(prog="python -m pdfsummary.accounts", description="필기 앱 계정 관리 (서버 관리자용)")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("reset-password", help="비밀번호를 잊은 사람의 비밀번호를 새로 정하기 (모든 기기 로그아웃)")
    r.add_argument("email")
    sub.add_parser("list", help="가입한 계정 목록")
    pl = sub.add_parser("plan", help="요금제 바꾸기 (free·premium). AI 기능을 한 달에 쓸 수 있는 횟수가 달라진다")
    pl.add_argument("email")
    pl.add_argument("plan", choices=sorted(PLANS))
    t = sub.add_parser("test-mail", help="메일 서버 설정 확인: 시험 메일 보내기")
    t.add_argument("to")
    a = p.parse_args(argv)
    root = Path(os.environ.get("PDFSUMMARY_SYNC_DIR") or (Path.home() / ".pdfsummary" / "sync"))
    if a.cmd == "test-mail":
        m = Mailer.from_env()
        if not m.enabled:
            print("메일 서버가 설정되지 않았어요 (PDFSUMMARY_SMTP_HOST·PDFSUMMARY_SMTP_FROM).", file=sys.stderr)
            return 1
        try:
            m.send(a.to, "[필기 노트] 시험 메일", "메일 서버 설정이 잘 되었어요. 이제 비밀번호 찾기 메일을 보낼 수 있어요.\n")
        except MailError as e:
            print(e, file=sys.stderr)
            return 1
        print(f"{a.to} 로 시험 메일을 보냈어요.")
        return 0
    store = AccountStore(SyncStore(root))
    try:
        if a.cmd == "list":
            with store.lock:
                rows = store.db.execute(
                    "SELECT email, created, verified, google, pw, plan FROM accounts ORDER BY created").fetchall()
            for email, created, verified, google, pw, plan in rows:
                how = "+".join(x for x, on in (("비밀번호", pw != NO_PASSWORD), ("Google", bool(google))) if on)
                print(f"{email}\t{time.strftime('%Y-%m-%d', time.localtime(created))}\t"
                      f"{'이메일 확인됨' if verified else '이메일 확인 안 됨'}\t{how}\t{PLANS.get(plan, plan)}")
            return 0
        if a.cmd == "plan":
            store.set_plan(a.email, a.plan)
            print(f"{a.email} 의 요금제를 '{PLANS[a.plan]}'(으)로 바꿨어요. AI 기능은 한 달 {ai_limits()[a.plan]}번.")
            return 0
        new = os.environ.get("PDFSUMMARY_NEW_PASSWORD") or getpass.getpass("새 비밀번호: ")
        store.reset_password(a.email, new)
        print("바꿨어요. 그 계정의 모든 기기가 로그아웃되었어요.")
        return 0
    except AccountError as e:
        print(e, file=sys.stderr)
        return 1
    finally:
        store.sync.close()


if __name__ == "__main__":
    raise SystemExit(main())
