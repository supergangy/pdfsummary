// 기기 파일 저장: 진짜 expo-file-system처럼 write·move가 늦게 끝나는(비동기) 가짜로 시험한다.
// 예전 코드는 write·move를 기다리지 않아 '요약 갔다 오면 필기가 사라지는' 문제가 있었다.
import { test } from "node:test";
import assert from "node:assert/strict";

import { LEGACY_TMP, makeFileFs, type DirLike, type FileApi, type FileLike } from "./fileFs.ts";
import { NoteStore } from "./store.ts";
import { blankNotebook, type Stroke } from "./model.ts";

/** 메모리 파일 시스템. write·move·copy는 무작위로 조금 늦게 끝난다. */
function fakeApi(seed = 1) {
  const files = new Map<string, string | Uint8Array>();
  const dirs = new Set<string>([""]);
  let s = seed;
  const delay = () => new Promise<void>((r) => setTimeout(r, ((s = (s * 16807) % 2147483647) % 7) + 1));
  const join = (parts: (string | object)[]) =>
    parts.map((p) => (typeof p === "string" ? p : (p as { path: string }).path)).filter(Boolean).join("/");
  const root = { path: "" };
  class Dir implements DirLike {
    path: string;
    constructor(...parts: (string | object)[]) {
      this.path = join(parts);
    }
    get exists() {
      return dirs.has(this.path);
    }
    get name() {
      return this.path.split("/").pop()!;
    }
    create() {
      const segs = this.path.split("/");
      for (let i = 1; i <= segs.length; i++) dirs.add(segs.slice(0, i).join("/"));
    }
    delete() {
      for (const d of [...dirs]) if (d === this.path || d.startsWith(this.path + "/")) dirs.delete(d);
      for (const f of [...files.keys()]) if (f.startsWith(this.path + "/")) files.delete(f);
    }
    list() {
      const out: (FileLike | DirLike)[] = [];
      const pre = this.path ? this.path + "/" : "";
      for (const d of dirs) if (d && d !== this.path && d.startsWith(pre) && !d.slice(pre.length).includes("/")) out.push(new Dir(d));
      return out;
    }
  }
  class F implements FileLike {
    path: string;
    constructor(...parts: (string | object)[]) {
      this.path = join(parts);
    }
    get uri() {
      return "file:///" + this.path;
    }
    get exists() {
      return files.has(this.path);
    }
    get parentDirectory() {
      return new Dir(this.path.split("/").slice(0, -1).join("/"));
    }
    async text() {
      await delay();
      const v = files.get(this.path);
      if (v === undefined) throw new Error("없음 " + this.path);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    }
    async bytes() {
      await delay();
      const v = files.get(this.path)!;
      return typeof v === "string" ? new TextEncoder().encode(v) : v;
    }
    async write(c: string | Uint8Array) {
      files.set(this.path, typeof c === "string" ? "" : new Uint8Array()); // 쓰는 중에는 비어 있다
      await delay();
      files.set(this.path, c);
    }
    async move(to: FileLike, o?: { overwrite?: boolean }) {
      await delay();
      const dest = (to as F).path;
      if (files.has(dest) && !o?.overwrite) throw new Error("이미 있음");
      const v = files.get(this.path);
      if (v === undefined) throw new Error("옮길 파일 없음");
      files.delete(this.path);
      files.set(dest, v);
      this.path = dest;
    }
    async copy(to: FileLike) {
      await delay();
      files.set((to as F).path, files.get(this.path)!);
    }
    delete() {
      files.delete(this.path);
    }
  }
  return { api: { File: F, Directory: Dir, root } as unknown as FileApi, files };
}

const S = (id: string): Stroke => ({ id, tool: "pen", color: "#000000", width: 2, pts: [1, 1, 0.5, 9, 9, 0.5] });

test("writes are awaited: what was saved is there when the note is opened again", async () => {
  const { api } = fakeApi();
  const fs = makeFileFs(api);
  await fs.writeText("a/b.json", "hello");
  assert.equal(await fs.readText("a/b.json"), "hello");
  await fs.writeBytes("a/c.bin", new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await fs.readBytes("a/c.bin"))!], [1, 2, 3]);
});

test("many saves of the same page in a row: the last one always wins", async () => {
  for (let seed = 1; seed < 20; seed++) {
    const { api } = fakeApi(seed);
    const fs = makeFileFs(api);
    const all = Array.from({ length: 12 }, (_, i) => fs.writeText("ink/p.json", `v${i}`)); // 기다리지 않고 연달아
    await Promise.all(all);
    assert.equal(await fs.readText("ink/p.json"), "v11", `seed ${seed}`);
  }
});

test("editor → quick summary → back: strokes are still there (whole store path)", async () => {
  const { api } = fakeApi(7);
  const store = new NoteStore(makeFileFs(api));
  const nb = blankNotebook("요약 왕복", "plain", 2);
  await store.create(nb);
  // 쓰는 동안 여러 번 저장 (편집 화면이 700ms마다 저장하듯, 끝나기 전에 다음 저장)
  const saves = [];
  for (let i = 1; i <= 6; i++) saves.push(store.savePage(nb.id, nb.pages[0].id, Array.from({ length: i }, (_, k) => S(`s${k}`))));
  saves.push(store.savePage(nb.id, nb.pages[1].id, [S("x")]));
  await Promise.all(saves);
  // 요약 화면에서 돌아와 노트를 다시 연다
  const again = (await store.load(nb.id))!;
  const ink = await store.loadInk(again);
  assert.equal(ink[nb.pages[0].id].length, 6);
  assert.deepEqual(ink[nb.pages[1].id].map((s) => s.id), ["x"]);
});

test("strokes left in the old temp file by the earlier bug are recovered", async () => {
  const { api, files } = fakeApi(3);
  const fs = makeFileFs(api);
  // 예전 코드: 원래 파일은 지워지고 임시 파일만 남은 상태
  files.set("notebooks/n1/ink/p1.json" + LEGACY_TMP, JSON.stringify([S("lost")]));
  const t = await fs.readText("notebooks/n1/ink/p1.json");
  assert.deepEqual(JSON.parse(t!).map((s: Stroke) => s.id), ["lost"]);
  assert.ok(files.has("notebooks/n1/ink/p1.json"), "제자리로 옮겨 둔다");
  assert.ok(!files.has("notebooks/n1/ink/p1.json" + LEGACY_TMP));
  // 원래 파일이 있으면 임시 파일은 쓰지 않는다 (다음 저장 때 지움)
  files.set("x.json", "real");
  files.set("x.json" + LEGACY_TMP, "old");
  assert.equal(await fs.readText("x.json"), "real");
  await fs.writeText("x.json", "new");
  assert.ok(!files.has("x.json" + LEGACY_TMP));
});

test("no half-written files are left behind", async () => {
  const { api, files } = fakeApi(11);
  const fs = makeFileFs(api);
  await Promise.all([fs.writeText("d/a.json", "1"), fs.writeText("d/a.json", "2"), fs.writeText("d/b.json", "3")]);
  assert.deepEqual([...files.keys()].sort(), ["d/a.json", "d/b.json"]);
  assert.deepEqual(await fs.listDirs(""), ["d"]);
});
