"""실시간 동기화 서버: 공간·작업 쌓기·받기(오래 기다리기)·재시도·큰 파일."""

import hashlib
import json
import threading
import time

import pytest

import pdfsummary.app as app
from pdfsummary.sync import SyncError, SyncStore, new_code, normalize_code, space_id

from test_server import call, server  # noqa: F401


@pytest.fixture()
def store(tmp_path):
    s = SyncStore(tmp_path / "sync")
    yield s
    s.close()


def op(cid, *writes, nb="n1"):
    return {"cid": cid, "nb": nb, "w": list(writes) or [{"t": "stroke", "id": cid, "v": {"x": 1}}]}


def test_codes():
    c = new_code()
    assert len(c) == 29 and c.count("-") == 4
    assert space_id(c) == space_id(c.lower().replace("-", " "))
    assert normalize_code("ab-cd 1") == "ABCD"


def test_push_pull_and_retry(store):
    code = store.create_space()
    sid = space_id(code)
    assert store.push(sid, "A", [op("aaaaaa1"), op("aaaaaa2")]) == [1, 2]
    # 같은 작업을 다시 보내도(네트워크 재시도) 두 번 쌓이지 않는다
    assert store.push(sid, "A", [op("aaaaaa2"), op("bbbbbb1")]) == [2, 3]
    r = store.pull(sid, 1)
    assert [o["seq"] for o in r["ops"]] == [2, 3] and r["last"] == 3 and not r["more"]
    assert r["ops"][0]["cid"] == "aaaaaa2" and r["ops"][0]["device"] == "A" and r["ops"][0]["w"][0]["id"] == "aaaaaa2"
    # 다른 공간과 섞이지 않는다
    other = space_id(store.create_space())
    assert store.pull(other, 0)["ops"] == []
    with pytest.raises(SyncError):
        store.push(sid, "A", [{"cid": "x", "w": []}])
    with pytest.raises(SyncError):
        store.push(sid, "A", [])


def test_long_poll_wakes_up_on_new_op(store):
    sid = space_id(store.create_space())
    got = {}

    def waiter():
        t = time.monotonic()
        got["r"] = store.pull(sid, 0, wait=10)
        got["dt"] = time.monotonic() - t

    th = threading.Thread(target=waiter)
    th.start()
    time.sleep(0.3)
    store.push(sid, "B", [op("cccccc1")])
    th.join(5)
    assert got["r"]["ops"][0]["cid"] == "cccccc1"
    assert 0.25 < got["dt"] < 3, got["dt"]
    # 새 작업이 없으면 기다린 만큼 기다리고 빈 답
    t = time.monotonic()
    assert store.pull(sid, 1, wait=0.4)["ops"] == []
    assert time.monotonic() - t >= 0.35


def test_blobs(store):
    sid = space_id(store.create_space())
    data = b"%PDF-1.7 hello"
    sha = hashlib.sha256(data).hexdigest()
    assert not store.has_blob(sid, sha)
    with pytest.raises(SyncError):
        store.put_blob(sid, sha, b"other")
    store.put_blob(sid, sha, data)
    assert store.get_blob(sid, sha) == data
    with pytest.raises(SyncError):
        store.get_blob(sid, "../../etc/passwd")


def test_persists_across_restart(tmp_path):
    s = SyncStore(tmp_path / "s")
    code = s.create_space()
    s.push(space_id(code), "A", [op("dddddd1")])
    s.close()
    s2 = SyncStore(tmp_path / "s")
    assert s2.has_space(space_id(code)) and s2.pull(space_id(code), 0)["last"] == 1
    s2.close()


def test_http_flow(server, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setenv("PDFSUMMARY_SYNC_DIR", str(tmp_path / "sync"))
    monkeypatch.setattr(app, "_SYNC", None)
    assert json.loads(call(server, "/api/state")[1])["sync"] is True
    s, b, _ = call(server, "/api/sync/space", data={})
    code = json.loads(b)["code"]
    H = {"X-Sync-Space": code}
    assert call(server, "/api/sync/info", headers={"X-Sync-Space": "WRONG-CODE"})[0] == 403
    assert call(server, "/api/sync/info")[0] == 403
    assert json.loads(call(server, "/api/sync/info", headers=H)[1])["last"] == 0
    s, b, _ = call(server, "/api/sync/push", data={"device": "A", "ops": [op("eeeeee1")]}, headers=H)
    assert s == 200 and json.loads(b)["seqs"] == [1]
    s, b, _ = call(server, "/api/sync/pull?since=0&wait=1", headers=H)
    assert json.loads(b)["ops"][0]["cid"] == "eeeeee1"
    data = b"%PDF blob"
    sha = hashlib.sha256(data).hexdigest()
    assert call(server, f"/api/sync/blob/{sha}", headers=H)[0] == 404
    assert call(server, f"/api/sync/blob/{sha}", raw=data, method="PUT", headers=H)[0] == 200
    s, b, _ = call(server, f"/api/sync/blob/{sha}", headers=H)
    assert s == 200 and b == data
    # 접속 코드가 없으면 동기화도 못 쓴다
    assert call(server, "/api/sync/info", code=None, headers=H)[0] == 403
    app._SYNC.close()
    monkeypatch.setattr(app, "_SYNC", None)
