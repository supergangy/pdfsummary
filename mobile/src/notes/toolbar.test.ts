import { test } from "node:test";
import assert from "node:assert/strict";
import { clampFloat, DEFAULT_TOOLBAR, dockAt, groupOf, moveItem, toolbarOrder } from "./toolbar.ts";

test("도구 모음 순서: 처음엔 기본 순서", () => {
  assert.deepEqual(toolbarOrder(undefined), DEFAULT_TOOLBAR);
  assert.deepEqual(toolbarOrder([]), DEFAULT_TOOLBAR);
});

test("예전에 저장된 '도구 설정'(뺀 단추)은 버린다", () => {
  assert.ok(!(toolbarOrder(["toolSettings", "pen"]) as string[]).includes("toolSettings"));
});

test("저장된 순서: 모르는 것·겹친 것은 버리고, 빠진 것은 기본 순서의 앞 항목 뒤에", () => {
  const saved = ["undo", "pen", "pen", "rocket", ...DEFAULT_TOOLBAR.filter((x) => x !== "undo" && x !== "pen" && x !== "zoom")];
  const out = toolbarOrder(saved);
  assert.equal(out.length, DEFAULT_TOOLBAR.length);
  assert.equal(out[0], "undo");
  assert.equal(out[1], "pen");
  // zoom(기본 순서에서 finger 다음)은 finger 바로 뒤에 끼운다
  assert.equal(out[out.indexOf("finger") + 1], "zoom");
});

test("한 칸 앞으로·뒤로, 끝에서는 그대로", () => {
  const o = toolbarOrder(undefined);
  assert.deepEqual(moveItem(o, "eraser", -1).slice(0, 3), ["pen", "eraser", "highlighter"]);
  assert.deepEqual(moveItem(o, "pen", -1), o);
  assert.deepEqual(moveItem(o, o[o.length - 1], 1), o); // 맨 끝은 더 뒤로 못 간다
});

test("나눔 줄 묶음: 도구는 한 무리", () => {
  assert.equal(groupOf("pen"), groupOf("text"));
  assert.notEqual(groupOf("colors"), groupOf("widths"));
});

test("끌어 놓은 자리: 위 줄 근처 → 위, 왼쪽·오른쪽 끝 → 그쪽, 가운데 → 떠 있게", () => {
  assert.equal(dockAt(500, 60, 1200, 50), "top");
  assert.equal(dockAt(30, 400, 1200, 50), "left");
  assert.equal(dockAt(1180, 400, 1200, 50), "right");
  assert.equal(dockAt(600, 400, 1200, 50), "float");
});

test("떠 있는 도구 모음은 화면 밖으로 나가지 않게", () => {
  assert.deepEqual(clampFloat(-50, 10, 300, 50, 1000, 800, 60), { x: 4, y: 64 });
  assert.deepEqual(clampFloat(900, 900, 300, 50, 1000, 800, 60), { x: 696, y: 746 });
});
