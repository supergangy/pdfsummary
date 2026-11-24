import { test } from "node:test";
import assert from "node:assert/strict";
import { blankNotebook, pdfNotebook } from "./model.ts";
import { memoryFs, NoteStore } from "./store.ts";

test("store: create, list (newest first), ink per page, remove", async () => {
  const fs = memoryFs();
  const st = new NoteStore(fs);
  const a = blankNotebook("가", "lined", 2);
  a.updated = 1;
  const b = pdfNotebook("나", [{ w: 100, h: 200 }]);
  b.updated = 2;
  await st.create(a);
  await st.create(b, { uri: "file:///x.pdf" });
  assert.deepEqual((await st.list()).map((n) => n.title), ["나", "가"]);
  assert.ok(await st.pdfBytes(b.id));
  const s = { id: "s1", tool: "pen" as const, color: "#000000", width: 2, pts: [1, 2, 0.5] };
  await st.savePage(a.id, a.pages[1].id, [s]);
  const ink = await st.loadInk(a);
  assert.deepEqual(Object.keys(ink), [a.pages[1].id]);
  // 깨진 파일은 무시
  fs.files.set(`notebooks/${a.id}/ink/${a.pages[0].id}.json`, "{oops");
  assert.deepEqual(Object.keys(await st.loadInk(a)), [a.pages[1].id]);
  await st.remove(a.id);
  assert.deepEqual((await st.list()).map((n) => n.title), ["나"]);
});

test("folders: create, move notes, remove folder keeps notes", async () => {
  const st = new NoteStore(memoryFs());
  const a = blankNotebook("가", "plain", 1);
  await st.create(a);
  await st.saveFolders(["수학", " 영어 ", "수학", ""]);
  assert.deepEqual(await st.folders(), ["수학", "영어"]);
  await st.moveTo(a.id, "수학");
  assert.equal((await st.load(a.id))?.folder, "수학");
  await st.removeFolder("수학");
  assert.deepEqual(await st.folders(), ["영어"]);
  assert.equal((await st.load(a.id))?.folder, undefined);
  assert.equal((await st.list()).length, 1);
});

test("강의 녹음: 노트 폴더에 복사·목록·지우기 (노트를 지우면 함께)", async () => {
  const { NoteStore, memoryFs } = await import("./store.ts");
  const { blankNotebook } = await import("./model.ts");
  const fs = memoryFs();
  const st = new NoteStore(fs);
  const nb = blankNotebook("강의", "plain", 1);
  await st.create(nb);
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  await st.addRecording(nb.id, { id: "r1", start: 10, dur: 3000, ext: "m4a" }, { uri: "x", blob });
  await st.addRecording(nb.id, { id: "r2", start: 20, dur: 4000, ext: "m4a" }, { uri: "y", blob });
  assert.deepEqual((await st.recordings(nb.id)).map((r) => r.id), ["r1", "r2"]);
  await st.removeRecording(nb.id, "r1");
  assert.deepEqual((await st.recordings(nb.id)).map((r) => r.id), ["r2"]);
  await st.remove(nb.id);
  assert.deepEqual(await st.recordings(nb.id), []);
});

test("큰 PDF: 원본이 있는지 볼 때 파일을 통째로 읽지 않는다 (262MB PDF 가져오기가 메모리 부족으로 실패했다)", async () => {
  const mem = memoryFs();
  let reads = 0;
  const fs = {
    ...mem,
    async readBytes(p: string) {
      reads++;
      throw new Error("java.lang.OutOfMemoryError: Failed to allocate a 261862880 byte allocation");
      return mem.readBytes(p);
    },
    async fileSize(p: string) {
      return mem.files.has(p) ? 261862877 : null;
    },
  };
  const st = new NoteStore(fs);
  const nb = pdfNotebook("큰 책", [{ w: 595, h: 842 }]);
  await st.create(nb, { uri: "file:///big.pdf" });
  assert.equal(await st.hasPdf(nb.id), true);
  assert.equal(await st.hasPdf("없는노트"), false);
  assert.equal(reads, 0);
});
