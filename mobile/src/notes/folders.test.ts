import { test } from "node:test";
import assert from "node:assert/strict";
import { allFolders, childrenOf, cleanName, crumbs, isWithin, joinPath, nameOf, parentOf, renamePath, treeRows } from "./folders.ts";

test("폴더 경로: 이름·부모·잇기, / 는 이름에 못 쓴다", () => {
  assert.equal(joinPath(null, "공부"), "공부");
  assert.equal(joinPath("공부", "NCS"), "공부/NCS");
  assert.equal(parentOf("공부/NCS"), "공부");
  assert.equal(parentOf("공부"), null);
  assert.equal(nameOf("공부/컴퓨터일반/공무원"), "공무원");
  assert.equal(cleanName("  A/B  "), "A-B");
});

test("아래 폴더인지: 이름이 비슷한 옆 폴더는 아니다", () => {
  assert.ok(isWithin("공부/NCS", "공부"));
  assert.ok(isWithin("공부", "공부"));
  assert.ok(!isWithin("공부방", "공부"));
  assert.ok(!isWithin(undefined, "공부"));
});

test("윗 폴더가 목록에 없어도 나무가 이어진다 (예전 폴더는 맨 위 폴더)", () => {
  const fs = allFolders(["수학"], ["공부/NCS", undefined]);
  assert.deepEqual([...fs].sort(), ["공부", "공부/NCS", "수학"]);
  assert.deepEqual(childrenOf(fs, null), ["공부", "수학"]);
  assert.deepEqual(childrenOf(fs, "공부"), ["공부/NCS"]);
});

test("폴더 나무: 펼친 폴더의 아래만 들여 쓴다", () => {
  const fs = allFolders(["공부/컴퓨터일반/공무원", "공부/NCS", "Notes"]);
  // 한글 이름 먼저, 그다음 영어
  assert.deepEqual(treeRows(fs, new Set()).map((r) => r.path), ["공부", "Notes"]);
  const rows = treeRows(fs, new Set(["공부", "공부/컴퓨터일반"]));
  assert.deepEqual(rows.map((r) => `${r.depth}:${nameOf(r.path)}`), ["0:공부", "1:컴퓨터일반", "2:공무원", "1:NCS", "0:Notes"]);
  assert.equal(rows.find((r) => r.path === "공부")!.hasKids, true);
  assert.equal(rows.find((r) => r.path === "공부/NCS")!.hasKids, false);
});

test("위 경로 단추와 이름 바꾸기", () => {
  assert.deepEqual(crumbs("공부/NCS"), [{ name: "공부", path: "공부" }, { name: "NCS", path: "공부/NCS" }]);
  assert.deepEqual(crumbs(null), []);
  assert.equal(renamePath("공부/NCS/모의고사", "공부/NCS", "공부/공기업"), "공부/공기업/모의고사");
  assert.equal(renamePath("공부방", "공부", "학습"), "공부방");
});
