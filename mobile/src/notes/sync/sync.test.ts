// 실시간 동기화: 여러 기기가 동시에·끊긴 채로 고쳐도 결국 같은 내용이 되는지 (가짜 서버로)
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankNotebook, insertPage, newId, pdfNotebook, type Notebook, type Stroke } from "../model.ts";
import { memoryFs } from "../store.ts";
import { SyncEngine, emptyState, type RemoteOp, type Transport } from "./engine.ts";
import { sha256 } from "./sha256.ts";
import { SyncedStore, type StoreEvent } from "./syncedStore.ts";
import { assignOrder } from "./writes.ts";

class FakeServer {
  ops: RemoteOp[] = [];
  blobs = new Map<string, Uint8Array>();
  online = true;
  transport(): Transport {
    const S = this;
    const need = () => {
      if (!S.online) throw new Error("오프라인");
    };
    return {
      async push(device, ops) {
        need();
        return ops.map((o) => {
          const old = S.ops.find((x) => x.cid === o.cid);
          if (old) return old.seq;
          const seq = S.ops.length + 1;
          S.ops.push({ seq, cid: o.cid, device, ...(o.nb ? { nb: o.nb } : {}), w: JSON.parse(JSON.stringify(o.w)) });
          return seq;
        });
      },
      async pull(since) {
        need();
        const ops = S.ops.filter((o) => o.seq > since);
        return { ops, last: ops.length ? ops[ops.length - 1].seq : since, more: false };
      },
      async hasBlob(sha) {
        need();
        return S.blobs.has(sha);
      },
      async putBlob(sha, data) {
        need();
        assert.equal(sha256(data), sha);
        S.blobs.set(sha, data);
      },
      async getBlob(sha) {
        need();
        return S.blobs.get(sha) ?? null;
      },
    };
  }
}

async function device(server: FakeServer) {
  const fs = memoryFs();
  const store = new SyncedStore(fs);
  const events: StoreEvent[] = [];
  store.subscribe((e) => events.push(e));
  store.engine = new SyncEngine(fs, store, server.transport(), emptyState());
  return { fs, store, engine: store.engine, events };
}

const S = (id: string, x = 1, color = "#000000"): Stroke => ({ id, tool: "pen", color, width: 2, pts: [x, x, 0.5, x + 5, x + 5, 0.5] });

async function snapshot(store: SyncedStore) {
  const out: Record<string, unknown> = { folders: (await store.folders()).sort() };
  for (const nb of (await store.list()).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ink = await store.loadInk(nb);
    out[nb.id] = {
      title: nb.title,
      folder: nb.folder ?? null,
      pages: nb.pages.map((p) => p.id),
      // 같은 쪽 안의 겹침 순서는 기기마다 다를 수 있어 id로 정렬해 비교
      ink: Object.fromEntries(nb.pages.map((p) => [p.id, [...(ink[p.id] ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))])),
    };
  }
  return out;
}

async function settle(...ds: { engine: SyncEngine }[]) {
  for (let round = 0; round < 3; round++) for (const d of ds) await d.engine.syncOnce();
}

test("a notebook made on one device appears on the other, then edits flow both ways", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const B = await device(server);
  const nb = blankNotebook("물리", "lined", 2);
  await A.store.create(nb);
  await A.store.savePage(nb.id, nb.pages[0].id, [S("a1")]);
  await settle(A, B);
  assert.deepEqual(await snapshot(B.store), await snapshot(A.store));
  assert.ok(B.events.some((e) => e.kind === "remote" && e.nb === nb.id));
  // B가 고치면 A에도
  await B.store.savePage(nb.id, nb.pages[1].id, [S("b1", 9)]);
  const nbB = (await B.store.load(nb.id))!;
  await B.store.save({ ...nbB, title: "물리 1단원" });
  await settle(A, B);
  assert.equal((await A.store.load(nb.id))?.title, "물리 1단원");
  assert.deepEqual(await snapshot(A.store), await snapshot(B.store));
});

test("both devices offline, edit the same page and the same stroke, then converge", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const B = await device(server);
  const nb = blankNotebook("화학", "grid", 1);
  const pid = nb.pages[0].id;
  await A.store.create(nb);
  await A.store.savePage(nb.id, pid, [S("x"), S("y")]);
  await settle(A, B);

  server.online = false;
  // A: x 색 바꿈, 새 획 a  /  B: x 옮김, y 지움, 새 획 b
  await A.store.savePage(nb.id, pid, [S("x", 1, "#FF0000"), S("y"), S("a", 30)]);
  await B.store.savePage(nb.id, pid, [S("x", 50), S("b", 40)]);
  await A.engine.syncOnce().catch(() => undefined);
  await B.engine.syncOnce().catch(() => undefined);
  server.online = true;
  await settle(B, A); // B가 먼저 서버에 닿고, A가 나중 → x는 A의 것(더 늦은 번호)이 이긴다
  const a = await snapshot(A.store), b = await snapshot(B.store);
  assert.deepEqual(a, b);
  const ink = (a[nb.id] as { ink: Record<string, Stroke[]> }).ink[pid];
  assert.deepEqual(ink.map((s) => s.id), ["a", "b", "x"]);
  assert.equal(ink.find((s) => s.id === "x")!.color, "#FF0000");
});

test("random concurrent edits on three devices always converge", async () => {
  for (let trial = 0; trial < 6; trial++) {
    const server = new FakeServer();
    const ds = [await device(server), await device(server), await device(server)];
    const nb = blankNotebook("무작위", "plain", 2);
    await ds[0].store.create(nb);
    await settle(...ds);
    let seed = trial * 7919 + 13;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let step = 0; step < 40; step++) {
      const d = ds[Math.floor(rnd() * ds.length)];
      const cur = await d.store.load(nb.id);
      if (!cur) continue;
      const page = cur.pages[Math.floor(rnd() * cur.pages.length)];
      const strokes = await d.store.loadPage(nb.id, page.id);
      const r = rnd();
      if (r < 0.4) await d.store.savePage(nb.id, page.id, [...strokes, S(newId(), Math.floor(rnd() * 100))]);
      else if (r < 0.6 && strokes.length) await d.store.savePage(nb.id, page.id, strokes.slice(1));
      else if (r < 0.75 && strokes.length) await d.store.savePage(nb.id, page.id, strokes.map((s, i) => (i === 0 ? { ...s, color: "#00FF00", pts: s.pts.map((v) => v + 1) } : s)));
      else if (r < 0.85) await d.store.save(insertPage(cur, Math.floor(rnd() * cur.pages.length)));
      else if (r < 0.92) await d.store.save({ ...cur, title: `제목 ${step}` });
      else await d.store.saveFolders([...(await d.store.folders()), `폴더${step % 3}`]);
      // 가끔만 서버와 이야기 (그 사이 다른 기기도 고침 = 동시 편집)
      if (rnd() < 0.35) await d.engine.syncOnce();
    }
    await settle(...ds);
    const snaps = await Promise.all(ds.map((d) => snapshot(d.store)));
    assert.deepEqual(snaps[1], snaps[0], `trial ${trial}: B != A`);
    assert.deepEqual(snaps[2], snaps[0], `trial ${trial}: C != A`);
  }
});

test("pages inserted at the same spot on two devices keep both, in the same order everywhere", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const B = await device(server);
  const nb = blankNotebook("순서", "plain", 2);
  await A.store.create(nb);
  await settle(A, B);
  const a = (await A.store.load(nb.id))!;
  const b = (await B.store.load(nb.id))!;
  await A.store.save(insertPage(a, 0));
  await B.store.save(insertPage(b, 0));
  await settle(A, B);
  const pa = (await A.store.load(nb.id))!.pages.map((p) => p.id);
  const pb = (await B.store.load(nb.id))!.pages.map((p) => p.id);
  assert.equal(pa.length, 4);
  assert.deepEqual(pa, pb);
  assert.equal(pa[0], nb.pages[0].id);
  assert.equal(pa[3], nb.pages[1].id);
});

test("deleting a notebook wins over late edits; folders sync", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const B = await device(server);
  const nb = blankNotebook("지울 노트", "plain", 1);
  await A.store.create(nb);
  await A.store.saveFolders(["영어"]);
  await settle(A, B);
  assert.deepEqual(await B.store.folders(), ["영어"]);
  server.online = false;
  await A.store.remove(nb.id);
  await B.store.savePage(nb.id, nb.pages[0].id, [S("late")]);
  server.online = true;
  await settle(A, B);
  assert.equal(await A.store.load(nb.id), null);
  assert.equal(await B.store.load(nb.id), null);
  assert.ok(B.events.some((e) => e.kind === "deleted"));
});

test("the original PDF travels once by content hash", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const B = await device(server);
  const nb = pdfNotebook("교재", [{ w: 500, h: 700 }]);
  const pdf = new TextEncoder().encode("%PDF-1.7 fake book");
  await A.fs.writeBytes(`notebooks/${nb.id}/source.pdf`, pdf);
  await A.store.save(nb);
  await settle(A, B);
  assert.equal(server.blobs.size, 1);
  assert.deepEqual([...(await B.store.pdfBytes(nb.id))!], [...pdf]);
  assert.ok(B.events.some((e) => e.kind === "pdf" && e.nb === nb.id));
  assert.equal((await B.store.load(nb.id))?.hasPdf, true);
});

test("turning sync on uploads notes that were already on the device", async () => {
  const server = new FakeServer();
  const fs = memoryFs();
  const old = new SyncedStore(fs); // 동기화 없이 쓰던 기기
  const nb: Notebook = blankNotebook("예전 노트", "lined", 1);
  await old.create(nb);
  await old.savePage(nb.id, nb.pages[0].id, [S("old")]);
  old.engine = new SyncEngine(fs, old, server.transport(), emptyState());
  const snap = await old.snapshotWrites();
  await old.engine.record(snap.writes, snap.blobs);
  const B = await device(server);
  await settle({ engine: old.engine }, B);
  assert.deepEqual(await snapshot(B.store), await snapshot(old));
});

test("page order keys: inserting keeps neighbours, fills gaps", () => {
  const ps = assignOrder([{ id: "a", w: 1, h: 1 }, { id: "b", w: 1, h: 1 }]);
  assert.deepEqual(ps.map((p) => p.o), [0, 1]);
  const ins = assignOrder([ps[0], { id: "n", w: 1, h: 1 }, ps[1]]);
  assert.deepEqual(ins.map((p) => p.o), [0, 0.5, 1]);
  const front = assignOrder([{ id: "z", w: 1, h: 1 }, ...ins]);
  assert.ok(front[0].o! < 0);
});

test("sha256 matches Node", async () => {
  const { createHash } = await import("node:crypto");
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
    const d = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    assert.equal(sha256(d), createHash("sha256").update(d).digest("hex"), `len ${n}`);
  }
});

test("joining with a stale copy: the server's newer content wins, device-only notes are uploaded", async () => {
  const server = new FakeServer();
  const A = await device(server);
  const nb = blankNotebook("공유 노트", "plain", 1);
  const pid = nb.pages[0].id;
  await A.store.create(nb);
  await A.store.savePage(nb.id, pid, [S("x")]);
  await settle(A);
  // B는 예전에 같은 노트의 사본을 받아 두었다 (동기화를 끈 사이 A가 고침)
  const fs = memoryFs();
  const B = new SyncedStore(fs);
  await B.create(nb);
  await B.savePage(nb.id, pid, [S("x")]);
  const mine = blankNotebook("B에만 있는 노트", "lined", 1);
  await B.create(mine);
  await A.store.savePage(nb.id, pid, [S("x", 1, "#FF0000"), S("a2", 20)]);
  await A.store.save({ ...(await A.store.load(nb.id))!, title: "공유 노트 (고침)" });
  await settle(A);
  // B가 다시 동기화를 켬
  B.engine = new SyncEngine(fs, B, server.transport(), emptyState());
  await B.engine.join(() => B.snapshotWrites());
  await settle({ engine: B.engine }, A);
  const a = await snapshot(A.store);
  assert.deepEqual(await snapshot(B), a);
  assert.equal((a[nb.id] as { title: string }).title, "공유 노트 (고침)");
  const ink = (a[nb.id] as { ink: Record<string, Stroke[]> }).ink[pid];
  assert.equal(ink.find((s) => s.id === "x")!.color, "#FF0000");
  assert.ok(a[mine.id], "B에만 있던 노트가 A에도");
});
