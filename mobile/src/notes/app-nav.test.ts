import { test } from "node:test";
import assert from "node:assert/strict";
import { backTarget, exitOnSecondBack, keepFolder, tooSoon } from "./app-nav.ts";
import { ALL_NOTES } from "./folders.ts";

type Scr = { name: string; id?: string; page?: number; backTo?: Scr };
const LIB: Scr = { name: "library" };

test("뒤로: 요약 화면에서는 왔던 노트의 보던 쪽으로, 없으면 목록으로", () => {
  const ed: Scr = { name: "editor", id: "n1", page: 2 };
  assert.deepEqual(backTarget({ name: "quick", backTo: ed }, LIB), ed);
  assert.deepEqual(backTarget({ name: "summary", backTo: ed }, LIB), ed);
  assert.deepEqual(backTarget({ name: "summary" }, LIB), LIB);
});

test("뒤로: 목록(앱 닫기)과 필기 화면(Editor가 저장하고 닫음)은 App이 처리하지 않는다", () => {
  assert.equal(backTarget(LIB, LIB), null);
  assert.equal(backTarget({ name: "editor", id: "n1" }, LIB), null);
});

test("화면이 뜬 직후(0.4초 안)의 누름만 무시한다", () => {
  assert.equal(tooSoon(1000, 1070), true);
  assert.equal(tooSoon(1000, 1250), true);
  assert.equal(tooSoon(1000, 1399), true);
  assert.equal(tooSoon(1000, 1400), false);
  assert.equal(tooSoon(1000, 3000), false);
});

test("고른 폴더가 지워졌으면 '전체'로, 있으면 그대로", () => {
  assert.equal(keepFolder("과학", ["수학", "과학"]), "과학");
  assert.equal(keepFolder("과학", ["수학"]), null);
  assert.equal(keepFolder(ALL_NOTES, []), ALL_NOTES); // '모든 노트' 보기는 폴더가 없어도 그대로
  assert.equal(keepFolder("과학", []), null);
  assert.equal(keepFolder(null, ["수학"]), null);
});

test("library: the app closes only on a second back press within 2 seconds", () => {
  assert.equal(exitOnSecondBack(null, 1000), false);
  assert.equal(exitOnSecondBack(1000, 2500), true);
  assert.equal(exitOnSecondBack(1000, 3500), false);
});
