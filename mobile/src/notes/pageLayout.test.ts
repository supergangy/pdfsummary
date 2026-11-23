import { test } from "node:test";
import assert from "node:assert/strict";
import { docLayout, nearestSpread, pageAt, pagesIn, pageTurnTarget, PAGE_GAP } from "./pageLayout.ts";

const A4 = { w: 595, h: 842 };
const rect = (r: number[], i: number) => r.slice(i * 4, i * 4 + 4);

test("좌우로 넘기기: 쪽이 옆으로 나란히, 틈을 두고 위쪽 맞춤", () => {
  const L = docLayout([A4, A4, A4], "h", false);
  assert.deepEqual(rect(L.rects, 0), [0, 0, 595, 842]);
  assert.deepEqual(rect(L.rects, 1), [595 + PAGE_GAP, 0, 595, 842]);
  assert.deepEqual(rect(L.rects, 2), [2 * (595 + PAGE_GAP), 0, 595, 842]);
  assert.equal(L.w, 3 * 595 + 2 * PAGE_GAP);
  assert.equal(L.h, 842);
  assert.deepEqual(L.spreadOf, [0, 1, 2]);
});

test("위아래로 넘기기: 쪽을 이어 붙이고 폭이 다르면 가운데 맞춤", () => {
  const L = docLayout([A4, { w: 400, h: 300 }], "v", false);
  assert.deepEqual(rect(L.rects, 0), [0, 0, 595, 842]);
  assert.deepEqual(rect(L.rects, 1), [(595 - 400) / 2, 842 + PAGE_GAP, 400, 300]);
  assert.equal(L.w, 595);
  assert.equal(L.h, 842 + PAGE_GAP + 300);
});

test("첫 쪽은 어느 보기에서나 문서 왼쪽 위 (예전 한 쪽 보기와 같은 자리)", () => {
  for (const flow of ["h", "v"] as const) {
    const L = docLayout([A4, A4], flow, false);
    assert.deepEqual(rect(L.rects, 0), [0, 0, 595, 842], flow);
  }
});

test("두 쪽씩 보기: 1·2쪽, 3·4쪽이 한 묶음, 홀수면 마지막은 혼자", () => {
  const L = docLayout([A4, A4, A4], "v", true);
  assert.deepEqual(L.spreadOf, [0, 0, 1]);
  assert.deepEqual(L.spreadPages, [0, 1, 2, 2]);
  assert.deepEqual(rect(L.rects, 0), [0, 0, 595, 842]);
  assert.deepEqual(rect(L.rects, 1), [595 + PAGE_GAP, 0, 595, 842]);
  // 혼자인 3쪽은 두 쪽 폭 가운데로
  const wide = 2 * 595 + PAGE_GAP;
  assert.deepEqual(rect(L.rects, 2), [(wide - 595) / 2, 842 + PAGE_GAP, 595, 842]);
  assert.equal(L.w, wide);

  const H = docLayout([A4, A4, A4, A4], "h", true);
  assert.deepEqual(H.spreadOf, [0, 0, 1, 1]);
  assert.equal(rect(H.rects, 2)[0], wide + PAGE_GAP);
});

test("점이 든 쪽 찾기: 틈과 바깥은 -1", () => {
  const L = docLayout([A4, A4], "h", false);
  assert.equal(pageAt(L.rects, 10, 10), 0);
  assert.equal(pageAt(L.rects, 595 + PAGE_GAP + 10, 400), 1);
  assert.equal(pageAt(L.rects, 595 + PAGE_GAP / 2, 400), -1);
  assert.equal(pageAt(L.rects, 10, 900), -1);
});

test("가장 가까운 묶음, 화면에 걸친 쪽 범위", () => {
  const L = docLayout([A4, A4, A4, A4], "v", false);
  const step = 842 + PAGE_GAP;
  assert.equal(nearestSpread(L.spreads, 300, step * 2 + 10), 2);
  assert.equal(nearestSpread(L.spreads, 300, step - PAGE_GAP / 4), 1); // 틈에서는 가까운 쪽
  assert.deepEqual(pagesIn(L.rects, 0, step - 100, 595, step + 100), [0, 1]);
  assert.deepEqual(pagesIn(L.rects, 0, 99999, 595, 100000), [-1, -1]);
});

test("좌우 넘기기: 빠르게 밀면 한 쪽 넘고, 천천히 놓으면 가까운 쪽, 처음·끝을 넘지 않음", () => {
  assert.equal(pageTurnTarget(3, 3, -900, 10), 4); // 왼쪽으로 휙 → 다음 쪽
  assert.equal(pageTurnTarget(3, 3, 900, 10), 2); // 오른쪽으로 휙 → 이전 쪽
  assert.equal(pageTurnTarget(3, 3, -50, 10), 3); // 조금 끌다 놓음 → 제자리
  assert.equal(pageTurnTarget(3, 4, -50, 10), 4); // 반 넘게 끌고 놓음 → 다음 쪽
  // 속도를 못 쟀어도(0) 화면 폭의 1/5 넘게 끌었으면 넘어간다
  assert.equal(pageTurnTarget(3, 3, 0, 10, -0.3), 4);
  assert.equal(pageTurnTarget(3, 3, 0, 10, 0.3), 2);
  assert.equal(pageTurnTarget(3, 3, 0, 10, -0.1), 3);
  assert.equal(pageTurnTarget(9, 9, -900, 10), 9);
  assert.equal(pageTurnTarget(0, 0, 900, 10), 0);
});
