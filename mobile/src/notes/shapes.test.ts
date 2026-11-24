import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "./history.ts";
import { bounds, hits, objectAt } from "./geometry.ts";
import { makeImage, makeStamp, parseStrokes, type Stroke } from "./model.ts";
import { lassoSelect, moved, snapShape, transformed } from "./shapes.ts";

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

test("lasso partial: circling only the middle of a 2-point highlighter or a text box selects it", () => {
  // 곧게 편 형광펜은 양 끝 2점만 저장된다
  const hl: Stroke = { id: "hl", tool: "highlighter", color: "#FFE14D", width: 14, pts: [50, 100, 0.5, 400, 100, 0.5] };
  const box: Stroke = { id: "tx", tool: "text", color: "#000000", width: 16, pts: [100, 200, 0, 300, 245, 0], text: "첫 줄\n둘째 줄" };
  const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, 0.5, x1, y0, 0.5, x1, y1, 0.5, x0, y1, 0.5];
  const midLine = rect(180, 80, 260, 120); // 형광펜 가운데만 (양 끝은 밖)
  const midText = rect(150, 210, 250, 235); // 글상자 안쪽 가운데만 (모서리는 밖)
  assert.deepEqual([...lassoSelect([hl, box], midLine, true)], ["hl"]);
  assert.deepEqual([...lassoSelect([hl, box], midText, true)], ["tx"]);
  // 부분 선택이 꺼져 있으면 가운데만으로는 안 골라지고, 다 둘러싸야 골라진다
  assert.equal(lassoSelect([hl, box], midLine, false).size, 0);
  assert.equal(lassoSelect([hl, box], midText, false).size, 0);
  assert.deepEqual([...lassoSelect([hl, box], rect(30, 60, 420, 260), false)].sort(), ["hl", "tx"]);
  // 닿지 않은 것은 부분 선택에서도 안 골라진다
  assert.equal(lassoSelect([hl, box], rect(320, 150, 400, 300), true).size, 0);
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

// ── 사진·스티커 옮기기·크기·돌리기 ──
const near = (a: number[], b: number[], eps = 0.05) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

test("스티커 돌리기·크기: 상자 가운데는 축 둘레로, 크기는 k배, 각도는 rot에 (90도 돌리면 테두리 상자가 눕는다)", () => {
  const img = makeImage("i", 100, 100, 40, 20, "data:image/png;base64,AAAA"); // 가운데 (120, 110)
  // 자기 가운데를 축으로 90도
  const r = transformed(img, 0, 0, 1, 90, 120, 110);
  assert.equal(r.rot, 90);
  assert.ok(near(r.pts, [100, 100, 0, 140, 120, 0]), "상자 자체(돌리기 전 모양)는 그대로");
  assert.ok(near(bounds(r), [110, 90, 130, 130]), "돌린 테두리: 폭 20, 높이 40");
  // 다른 축(쪽 0,0)을 축으로 2배: 가운데가 (240, 220)으로, 크기 80×40
  const k = transformed(img, 5, -5, 2, 0, 0, 0);
  assert.ok(near(k.pts, [205, 195, 0, 285, 235, 0]));
  assert.equal(k.rot, undefined);
  // 네 번 90도면 각도는 사라진다 (0도)
  let z = img;
  for (let i = 0; i < 4; i++) z = transformed(z, 0, 0, 1, 90, 120, 110);
  assert.equal(z.rot, undefined);
  // 펜 획은 점 하나하나를 돌리고, 굵기는 k배
  const pen: Stroke = { id: "p", tool: "pen", color: "#000000", width: 2, pts: [10, 0, 0.5, 20, 0, 0.5] };
  const pr = transformed(pen, 0, 0, 1.5, 90, 0, 0);
  assert.ok(near(pr.pts, [0, 15, 0.5, 0, 30, 0.5]));
  assert.equal(pr.width, 3);
  // 도장(글상자)은 글자 크기도 k배
  const st = makeStamp("s", 200, 200, "중요", "#D7263D", 18);
  assert.equal(transformed(st, 0, 0, 2, 0, 200, 200).width, 36);
});

test("돌린 스티커: 누른 자리 판정·올가미 고르기·누르기만으로 고르기", () => {
  const img = { ...makeImage("i", 100, 100, 40, 20, "data:image/png;base64,AAAA"), rot: 90 }; // 세워진 모양: x 110~130, y 90~130
  assert.ok(hits(img, 120, 92, 0), "돌린 뒤 위쪽 끝");
  assert.ok(!hits(img, 102, 110, 0), "돌리기 전 왼쪽 끝은 이제 빈 곳");
  // 올가미: 세워진 모양을 감싸면 골라진다
  assert.ok(lassoSelect([img], [108, 88, 0, 132, 88, 0, 132, 132, 0, 108, 132, 0]).has("i"));
  // 누르기만으로: 맨 위의 사진·도장만 (그냥 글상자·펜 획은 아님)
  const pen: Stroke = { id: "p", tool: "pen", color: "#000000", width: 2, pts: [0, 0, 0.5, 300, 300, 0.5] };
  const text: Stroke = { id: "t", tool: "text", color: "#000000", width: 16, pts: [0, 0, 0, 300, 300, 0], text: "글" };
  const stamp = makeStamp("s", 120, 110, "암기", "#1E4FD8");
  assert.equal(objectAt([img, pen, text], 120, 92)?.id, "i");
  assert.equal(objectAt([img, stamp], 120, 110)?.id, "s", "겹치면 나중에 넣은 것(위)");
  assert.equal(objectAt([pen, text], 150, 150), null);
});

test("각도(rot)는 선택 칸: 예전 노트·다른 기기와 그대로 오가고, 이상한 값은 버린다", () => {
  const img = makeImage("i", 0, 0, 10, 10, "data:image/png;base64,AAAA");
  assert.equal(parseStrokes([img]).length, 1);
  assert.equal(parseStrokes([{ ...img, rot: 33.5 }])[0].rot, 33.5);
  assert.equal(parseStrokes([{ ...img, rot: "90" }]).length, 0);
});
