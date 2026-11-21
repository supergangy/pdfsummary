// 쪽 모아보기: 지금 쪽이 있는 줄과 줄 자리 계산
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_LABEL_H, GRID_PAD, GRID_ROW_GAP, gridRow, gridRows } from "./objects-grid.ts";

test("page grid opens at the row of the current page (rows, not page numbers)", () => {
  // 60쪽·8칸: 10쪽(차례 9)은 둘째 줄(1). 예전에는 8을 넘겨 '8번째 줄'로 읽혀 마지막 줄만 보였다
  assert.equal(gridRow(9, 8), 1);
  assert.ok(gridRow(9, 8) < Math.ceil(60 / 8), "줄 수 안의 값");
  assert.equal(gridRow(9, 5), 1); // 5칸이면 6~10쪽 줄
  assert.equal(gridRow(2, 8), 0);
  assert.equal(gridRow(59, 8), 7);
  assert.equal(gridRow(-1, 8), 0);
});

test("page grid row positions (mixed page sizes use the tallest page of the row)", () => {
  const a4 = { w: 600, h: 800 }, wide = { w: 800, h: 600 };
  // 3칸, 칸 폭 150: 첫 줄은 세로 쪽(200), 둘째 줄은 가로 쪽만(112.5), 셋째 줄은 섞임(200)
  const rows = gridRows([a4, a4, a4, wide, wide, wide, wide, a4], 3, 150);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { length: 200 + GRID_LABEL_H, offset: GRID_PAD });
  assert.deepEqual(rows[1], { length: 112.5 + GRID_LABEL_H, offset: GRID_PAD + 200 + GRID_LABEL_H + GRID_ROW_GAP });
  assert.equal(rows[2].length, 200 + GRID_LABEL_H);
  assert.equal(rows[2].offset, rows[1].offset + rows[1].length + GRID_ROW_GAP);
  assert.deepEqual(gridRows([], 3, 150), []);
});
