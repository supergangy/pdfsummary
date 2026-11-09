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
