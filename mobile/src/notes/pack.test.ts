import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { blankNotebook, pdfNotebook } from "./model.ts";
import { packNotebook, unpackNotebook } from "./pack.ts";
import { memoryFs, NoteStore } from "./store.ts";

test("pack → unpack keeps pages, strokes, text and the PDF; new id each import", () => {
  const nb = pdfNotebook("효소", [{ w: 500, h: 700 }, { w: 500, h: 700 }]);
  const ink = { [nb.pages[1].id]: [{ id: "s", tool: "text" as const, color: "#000000", width: 16, pts: [1, 2, 0, 3, 4, 0], text: "메모" }] };
  const pdf = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
  const bytes = packNotebook(nb, ink, pdf);
  const a = unpackNotebook(bytes);
  const b = unpackNotebook(bytes);
  assert.notEqual(a.nb.id, nb.id);
  assert.notEqual(a.nb.id, b.nb.id);
  assert.deepEqual(a.nb.pages, nb.pages);
  assert.equal(a.ink[nb.pages[1].id][0].text, "메모");
  assert.deepEqual([...a.pdf!], [...pdf]);
});

test("rejects other zip files and broken data", () => {
  assert.throws(() => unpackNotebook(new Uint8Array([1, 2, 3])), /깨졌/);
  assert.throws(() => unpackNotebook(zipSync({ "a.txt": strToU8("x") })), /노트 파일이 아니에요/);
  const nb = pdfNotebook("x", [{ w: 1, h: 1 }]);
  assert.throws(() => unpackNotebook(packNotebook(nb, {}, null)), /원본 PDF가 없어요/);
});

test("imported notebook can be stored and read back", async () => {
  const st = new NoteStore(memoryFs());
  const nb = blankNotebook("빈", "grid", 2);
  const ink = { [nb.pages[0].id]: [{ id: "p", tool: "pen" as const, color: "#000000", width: 2, pts: [1, 1, 0.5, 5, 5, 0.5] }] };
  const u = unpackNotebook(packNotebook(nb, ink, null));
  await st.create(u.nb);
  for (const [pid, ss] of Object.entries(u.ink)) await st.savePage(u.nb.id, pid, ss);
  const back = await st.load(u.nb.id);
  assert.equal(back?.title, "빈");
  assert.equal((await st.loadInk(back!))[nb.pages[0].id].length, 1);
});
