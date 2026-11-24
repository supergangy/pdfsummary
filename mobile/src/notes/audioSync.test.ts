import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, fadeStep, pageAt, parseRecordings, seekFor, timedStrokeAt } from "./audioSync.ts";
import type { Stroke } from "./model.ts";

const S = (id: string, x: number, rt?: number, rec = "r1"): Stroke => ({
  id, tool: "pen", color: "#000000", width: 2, pts: [x, 100, 0.5, x + 40, 100, 0.5], ...(rt !== undefined ? { rec, rt } : {}),
});

test("필기를 누르면: 녹음 시각이 있는 획만, 겹치면 나중에 쓴 것", () => {
  const ss = [S("a", 100, 5000), S("b", 100, 9000), S("c", 300)];
  assert.equal(timedStrokeAt(ss, 120, 101, 6)?.id, "b");
  assert.equal(timedStrokeAt(ss, 320, 100, 6), null); // 녹음 없이 쓴 획
  assert.equal(timedStrokeAt(ss, 120, 300, 6), null);
});

test("쓰기 2초 전부터 듣는다 (처음보다 앞으로는 안 감)", () => {
  assert.equal(seekFor(S("a", 0, 9500)), 7.5);
  assert.equal(seekFor(S("a", 0, 800)), 0);
});

test("쪽 따라가기: 재생 위치까지 쓴 것 중 가장 늦은 획의 쪽", () => {
  const ink = { p1: [S("a", 0, 1000), S("b", 0, 20000)], p2: [S("c", 0, 8000), S("d", 0, 9000, "r2")] };
  assert.equal(pageAt(ink, "r1", 500), null);
  assert.equal(pageAt(ink, "r1", 9500), "p2");
  assert.equal(pageAt(ink, "r1", 25000), "p1");
  assert.equal(pageAt(ink, "r2", 9000), "p2");
});

test("시간 글자, 흐리게 하는 기준 0.5초 단위, 녹음 목록 읽기", () => {
  assert.equal(clock(65), "01:05");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(fadeStep(3.74), 3500);
  assert.deepEqual(parseRecordings([{ id: "a", start: 1, dur: 2, ext: "m4a" }, { id: 3 }, null]), [{ id: "a", start: 1, dur: 2, ext: "m4a" }]);
  assert.deepEqual(parseRecordings("x"), []);
});
