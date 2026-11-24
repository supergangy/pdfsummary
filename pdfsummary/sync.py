"""필기 앱 실시간 동기화 (서버 쪽).

'동기화 공간' 하나 = 한 사람의 기기들이 함께 쓰는 노트 묶음. 공간은 긴 무작위 코드(동기화 코드)로 열고,
서버에는 코드의 해시만 둔다.

서버는 노트 내용을 해석하지 않는다. 기기가 보낸 '작업(op)'에 차례 번호(seq)를 매겨 그대로 쌓고,
다른 기기는 마지막으로 받은 번호 뒤의 작업을 받아 간다 (오래 기다리기: 새 작업이 생기면 바로 응답).
모든 기기가 같은 순서의 작업을 같은 규칙(값마다 가장 큰 번호가 이김)으로 적용하므로 결과가 같아진다.

원본 PDF처럼 큰 파일은 내용의 SHA-256으로 따로 올리고 받는다 (같은 파일은 한 번만).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

MAX_OPS_PER_PUSH = 500
MAX_OP_BYTES = 4 * 1024 * 1024
MAX_PULL = 2000
MAX_PULL_BYTES = 16 * 1024 * 1024  # 한 번에 돌려줄 작업 내용의 합 (쪽에 붙인 사진이 많으면 커지므로)
CID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
SHA = re.compile(r"^[0-9a-f]{64}$")


class SyncError(ValueError):
    pass


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z2-7]", "", (code or "").upper())


def space_id(code: str) -> str:
    return hashlib.sha256(normalize_code(code).encode()).hexdigest()


def new_code() -> str:
    """사람이 옮겨 적을 수 있는 동기화 코드: 영문 대문자·숫자 25자(125비트), 5자씩 끊어서."""
    raw = base64.b32encode(secrets.token_bytes(16)).decode().rstrip("=")[:25]
    return "-".join(raw[i:i + 5] for i in range(0, 25, 5))


class SyncStore:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root / "sync.db", check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS ops (
                space TEXT NOT NULL, seq INTEGER NOT NULL, cid TEXT NOT NULL, device TEXT NOT NULL,
                ts REAL NOT NULL, body TEXT NOT NULL,
                PRIMARY KEY (space, seq), UNIQUE (space, cid));
        """)
        self.lock = threading.Lock()
        self.conds: dict[str, threading.Condition] = {}

    def close(self) -> None:
        self.db.close()

    # ── 공간 ──
    def create_space(self) -> str:
        code = new_code()
        with self.lock:
            self.db.execute("INSERT INTO spaces (id, created) VALUES (?, ?)", (space_id(code), time.time()))
        return code

    def create_space_id(self) -> str:
        """코드 없이 공간 만들기 (계정용: 계정이 공간을 가리킨다)"""
        sid = secrets.token_hex(32)
        with self.lock:
            self.db.execute("INSERT INTO spaces (id, created) VALUES (?, ?)", (sid, time.time()))
        return sid

    def delete_space(self, sid: str) -> None:
        """공간과 그 안의 작업·큰 파일을 모두 지운다 (계정 삭제)"""
        import shutil

        with self.lock:
            self.db.execute("DELETE FROM ops WHERE space = ?", (sid,))
            self.db.execute("DELETE FROM spaces WHERE id = ?", (sid,))
        shutil.rmtree(self.root / "blobs" / sid[:32], ignore_errors=True)

    def has_space(self, sid: str) -> bool:
        with self.lock:
            return self.db.execute("SELECT 1 FROM spaces WHERE id = ?", (sid,)).fetchone() is not None

    def last_seq(self, sid: str) -> int:
        with self.lock:
            row = self.db.execute("SELECT MAX(seq) FROM ops WHERE space = ?", (sid,)).fetchone()
        return int(row[0] or 0)

    def _cond(self, sid: str) -> threading.Condition:
        with self.lock:
            c = self.conds.get(sid)
            if c is None:
                c = self.conds[sid] = threading.Condition()
            return c

    # ── 작업 ──
    def push(self, sid: str, device: str, ops: list) -> list[int]:
        """작업들을 쌓고 각 작업의 차례 번호를 돌려준다. 같은 cid를 다시 보내면(재시도) 처음 번호를 준다."""
        if not isinstance(ops, list) or not ops:
            raise SyncError("보낼 작업이 없습니다.")
        if len(ops) > MAX_OPS_PER_PUSH:
            raise SyncError(f"한 번에 {MAX_OPS_PER_PUSH}개까지 보낼 수 있습니다.")
        device = str(device or "")[:64]
        rows = []
        for op in ops:
            if not isinstance(op, dict) or not CID.match(str(op.get("cid", ""))):
                raise SyncError("작업 형식이 잘못되었습니다.")
            if not isinstance(op.get("w"), list):
                raise SyncError("작업 형식이 잘못되었습니다.")
            body = json.dumps({k: op[k] for k in ("nb", "w") if k in op}, ensure_ascii=False, separators=(",", ":"))
            if len(body.encode()) > MAX_OP_BYTES:
                raise SyncError("작업 하나가 너무 큽니다.")
            rows.append((op["cid"], body))
        seqs = []
        now = time.time()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                last = int(self.db.execute("SELECT MAX(seq) FROM ops WHERE space = ?", (sid,)).fetchone()[0] or 0)
                for cid, body in rows:
                    old = self.db.execute("SELECT seq FROM ops WHERE space = ? AND cid = ?", (sid, cid)).fetchone()
                    if old:
                        seqs.append(int(old[0]))
                        continue
                    last += 1
                    self.db.execute("INSERT INTO ops (space, seq, cid, device, ts, body) VALUES (?, ?, ?, ?, ?, ?)",
                                    (sid, last, cid, device, now, body))
                    seqs.append(last)
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        c = self._cond(sid)
        with c:
            c.notify_all()
        return seqs

    def pull(self, sid: str, since: int, wait: float = 0, limit: int = MAX_PULL, max_bytes: int = MAX_PULL_BYTES) -> dict:
        """since 뒤의 작업들. 없으면 wait초까지 기다렸다가 새 작업이 생기면 바로 돌려준다."""
        deadline = time.monotonic() + max(0.0, min(wait, 55.0))
        c = self._cond(sid)
        while True:
            with self.lock:
                rows = self.db.execute(
                    "SELECT seq, cid, device, ts, body FROM ops WHERE space = ? AND seq > ? ORDER BY seq LIMIT ?",
                    (sid, since, limit + 1)).fetchall()
            if rows or time.monotonic() >= deadline:
                break
            with c:
                c.wait(timeout=min(5.0, max(0.05, deadline - time.monotonic())))
        more = len(rows) > limit
        rows = rows[:limit]
        # 내용이 너무 크면 앞쪽만 (적어도 하나는) 돌려주고 나머지는 다음에
        total, keep = 0, 0
        for r in rows:
            total += len(r[4])
            if keep and total > max_bytes:
                break
            keep += 1
        if keep < len(rows):
            rows, more = rows[:keep], True
        ops = [{"seq": s, "cid": cid, "device": dev, "ts": ts, **json.loads(body)} for s, cid, dev, ts, body in rows]
        return {"ops": ops, "last": ops[-1]["seq"] if ops else since, "more": more}

    # ── 큰 파일 (원본 PDF) ──
    def _blob(self, sid: str, sha: str) -> Path:
        if not SHA.match(sha):
            raise SyncError("파일 이름이 잘못되었습니다.")
        return self.root / "blobs" / sid[:32] / sha

    def has_blob(self, sid: str, sha: str) -> bool:
        return self._blob(sid, sha).exists()

    def put_blob(self, sid: str, sha: str, data: bytes) -> None:
        if hashlib.sha256(data).hexdigest() != sha:
            raise SyncError("파일 내용이 이름(SHA-256)과 다릅니다.")
        p = self._blob(sid, sha)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(p)

    def get_blob(self, sid: str, sha: str) -> Optional[bytes]:
        p = self._blob(sid, sha)
        return p.read_bytes() if p.exists() else None
