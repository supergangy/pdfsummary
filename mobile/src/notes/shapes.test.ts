import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "./history.ts";
import type { Stroke } from "./model.ts";
import { lassoSelect, moved, snapShape } from "./shapes.ts";

const S = (id: string, pts: number[]): Stroke => ({ id, tool: "pen", color: "#000000", width: 2, pts });
const wob = (pts: [number, number][], j = 1.2) => pts.flatMap(([x, y], i) => [x + ((i * 7) % 3 - 1) * j * 0.5, y + ((i * 5) % 3 - 1) * j * 0.5, 0.5]);

function path(pts: [number, number][], step = 4): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

test("lasso selects strokes mostly inside", () => {
  const a = S("a", [10, 10, 0.5, 20, 20, 0.5]);
  const b = S("b", [200, 200, 0.5, 210, 210, 0.5]);
  const c = S("c", [40, 40, 0.5, 300, 300, 0.5, 310, 310, 0.5]); // 대부분 밖
  const lasso = [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5, 0, 100, 0.5];
  assert.deepEqual([...lassoSelect([a, b, c], lasso)], ["a"]);
});

test("move with undo/redo (replace op)", () => {
  const h = new History();
  const a = S("a", [10, 10, 0.5]);
  let ink: Record<string, Stroke[]> = h.run({}, { kind: "add", page: "p", strokes: [a] });
  ink = h.run(ink, { kind: "replace", page: "p", before: [a], after: [moved(a, 5, -3)] });
  assert.deepEqual(ink.p[0].pts, [15, 7, 0.5]);
  ink = h.undo(ink).ink as Record<string, Stroke[]>;
  assert.deepEqual(ink.p[0].pts, [10, 10, 0.5]);
  ink = h.redo(ink).ink as Record<string, Stroke[]>;
  assert.deepEqual(ink.p[0].pts, [15, 7, 0.5]);
});

test("shape snapping", () => {
  const line = snapShape(wob(path([[0, 0], [120, 30]])));
  assert.equal(line?.shape, "line");
  const lp = line!.pts;
  assert.ok(lp.length > 6, "선도 촘촘한 점으로");
  // 모든 점이 한 직선 위
  for (let i = 3; i < lp.length - 3; i += 3) {
    const cross = (lp[i] - lp[0]) * (lp[lp.length - 2] - lp[1]) - (lp[i + 1] - lp[1]) * (lp[lp.length - 3] - lp[0]);
    assert.ok(Math.abs(cross) / Math.hypot(lp[lp.length - 3] - lp[0], lp[lp.length - 2] - lp[1]) < 0.05);
  }
  const rect = snapShape(wob(path([[0, 0], [100, 0], [100, 60], [0, 60], [1, 2]])));
  assert.equal(rect?.shape, "rectangle");
  const tri = snapShape(wob(path([[50, 0], [100, 80], [0, 80], [49, 2]])));
  assert.equal(tri?.shape, "triangle");
  const circ: [number, number][] = [];
  for (let k = 0; k <= 40; k++) circ.push([60 + 50 * Math.cos((k / 40) * Math.PI * 2), 60 + 30 * Math.sin((k / 40) * Math.PI * 2)]);
  assert.equal(snapShape(wob(circ, 2))?.shape, "ellipse");
  // 글씨(꼬불꼬불, 열린 획)는 그대로
  const scrib = [0, 0, 0.5, 10, 20, 0.5, 20, 0, 0.5, 30, 20, 0.5, 40, 0, 0.5, 50, 25, 0.5, 30, 40, 0.5];
  assert.equal(snapShape(scrib), null);
  assert.equal(snapShape([0, 0, 0.5, 3, 3, 0.5, 5, 5, 0.5, 6, 6, 0.5]), null, "너무 작으면 그대로");
});
