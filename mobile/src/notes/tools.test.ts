// 도구 설정: 펜 종류·선 모양 그리기, 영역 지우개(획 나누기 + 되돌리기), 형광펜 글줄 맞추기, 올가미 부분 포함
import { test } from "node:test";
import assert from "node:assert/strict";

import { eraseFrom, fitHighlight, penOutline, strokeDraw, type CharBox } from "./geometry.ts";
import { History, type Op } from "./history.ts";
import { HIGHLIGHT_OPACITY, type Ink, type Stroke } from "./model.ts";
import { lassoSelect } from "./shapes.ts";

let n = 0;
const id = () => `n${++n}`;
const line = (sid: string, x0: number, x1: number, y = 50, extra: Partial<Stroke> = {}): Stroke => ({ id: sid, tool: "pen", color: "#000000", width: 2, pts: [x0, y, 0.5, x1, y, 0.5], ...extra });

test("pen types draw differently; dashed/dotted pens and highlighters are drawn as lines", () => {
  const pts: number[] = [];
  for (let i = 0; i <= 20; i++) pts.push(10 + i * 5, 50 + Math.sin(i / 3) * 10, 0.3 + (i % 5) / 10);
  const base: Stroke = { id: "a", tool: "pen", color: "#000000", width: 2, pts };
  const outlines = (["ballpoint", "fountain", "calligraphy", "pencil", "brush"] as const).map((b) => JSON.stringify(penOutline({ ...base, brush: b })));
  assert.equal(new Set(outlines).size, 5, "펜 종류마다 모양이 다르다");
  assert.equal(JSON.stringify(penOutline(base)), outlines[1], "펜 종류가 없으면(예전 노트) 만년필");
  assert.equal(strokeDraw({ ...base, brush: "pencil" })!.alpha, 0.78);
  const dash = strokeDraw({ ...base, dash: "dash" })!;
  assert.equal(dash.kind, "line");
  assert.ok(dash.kind === "line" && dash.dash && dash.dash[0] > dash.dash[1]);
  const dot = strokeDraw({ ...base, dash: "dot" })!;
  assert.ok(dot.kind === "line" && dot.dash && dot.dash[0] < 0.1 && dot.cap === "round");
  const hl = strokeDraw({ ...base, tool: "highlighter", width: 12 })!;
  assert.ok(hl.kind === "line" && hl.multiply && hl.alpha === HIGHLIGHT_OPACITY);
  assert.equal(strokeDraw({ ...base, tool: "highlighter", opacity: 0.6 })!.alpha, 0.6);
  // 붓펜: 펜촉(오른쪽 위)과 나란히 그으면 가늘고, 가로지르면 굵다
  const width = (o: number[][]) => Math.max(...o.map((p) => p[1])) - Math.min(...o.map((p) => p[1]));
  const along = penOutline({ ...base, brush: "calligraphy", pts: [0, 100, 0.5, 50, 50, 0.5] });
  const across = penOutline({ ...base, brush: "calligraphy", pts: [0, 50, 0.5, 50, 100, 0.5] });
  assert.ok(width(across) > width(along) - 1);
});

test("area eraser cuts a stroke where it rubs and keeps both sides", () => {
  const s = line("s", 0, 100);
  const pieces = eraseFrom(s, 50, 40, 50, 60, 4, id)!;
  assert.equal(pieces.length, 2);
  const [a, b] = pieces;
  assert.ok(Math.max(...a.pts.filter((_, i) => i % 3 === 0)) < 46);
  assert.ok(Math.min(...b.pts.filter((_, i) => i % 3 === 0)) > 54);
  assert.ok(a.id !== s.id && b.id !== s.id && a.color === s.color && a.width === s.width);
  assert.equal(eraseFrom(s, 50, 80, 60, 90, 4, id), null, "안 닿으면 그대로");
  assert.deepEqual(eraseFrom(line("t", 0, 3), 1, 50, 2, 50, 6, id), [], "작은 획은 통째로");
  // 길고 곧은 형광펜(점 두 개)도 가운데를 지울 수 있다
  const hl = line("h", 0, 300, 50, { tool: "highlighter", width: 14 });
  assert.equal(eraseFrom(hl, 150, 50, 150, 50, 5, id)!.length, 2);
});

test("area erase is one undo step; redo puts the pieces back", () => {
  const h = new History();
  const ink: Ink = { p: [line("a", 0, 100), line("b", 0, 100, 80), line("c", 0, 100, 110)] };
  const pieces = eraseFrom(ink.p[1], 50, 70, 50, 90, 4, id)!;
  const op: Op = { kind: "split", page: "p", before: [ink.p[1]], at: [1], after: pieces, from: pieces.map(() => "b") };
  const after = h.run(ink, op);
  assert.deepEqual(after.p.map((s) => s.id), ["a", ...pieces.map((s) => s.id), "c"], "조각은 원래 자리(겹침 순서)에");
  const undone = h.undo(after).ink;
  assert.deepEqual(undone.p.map((s) => s.id), ["a", "b", "c"]);
  assert.deepEqual(h.redo(undone).ink.p.map((s) => s.id), after.p.map((s) => s.id));
});

test("highlighter fits the text line it was drawn over", () => {
  // 글줄 두 줄: y 100~112 와 y 120~132, 글자 폭 8
  const chars: CharBox[] = [];
  const word = "형광펜으로칠한글자";
  [...word].forEach((c, i) => chars.push([c, 40 + i * 8, 100, 48 + i * 8, 112]));
  chars.push(["\n", 112, 100, 112, 112]);
  [...word].forEach((c, i) => chars.push([c, 40 + i * 8, 120, 48 + i * 8, 132]));
  // 첫 줄 위를 조금 비뚤게, 굵게, 글자 밖까지 그음
  const f = fitHighlight([30, 104, 0.5, 70, 108, 0.5, 125, 103, 0.5], 20, chars)!;
  assert.ok(f);
  assert.equal(f.pts[1], 106); // 글줄 가운데
  assert.equal(f.pts[4], 106);
  assert.ok(f.width > 12 && f.width < 16, `글자 높이에 맞춘 굵기 ${f.width}`);
  assert.ok(f.pts[0] >= 38 && f.pts[3] <= 115, "칠한 글자 끝까지만");
  // 둘째 줄에 걸치면 둘째 줄로
  assert.equal(fitHighlight([40, 127, 0.5, 100, 127, 0.5], 10, chars)!.pts[1], 126);
  // 글자 없는 곳·세로 획은 그대로
  assert.equal(fitHighlight([40, 300, 0.5, 100, 300, 0.5], 10, chars), null);
  assert.equal(fitHighlight([50, 90, 0.5, 52, 140, 0.5], 10, chars), null);
});

test("lasso: include partially selected strokes only when asked", () => {
  const box = [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5, 0, 100, 0.5, 0, 0, 0.5];
  const inside = line("in", 10, 90, 50);
  const half = line("half", 60, 160, 30); // 절반쯤 걸침
  const tip = { ...line("tip", 95, 300, 70), pts: [95, 70, 0.5, 200, 70, 0.5, 300, 70, 0.5] }; // 끝만 살짝
  assert.deepEqual([...lassoSelect([inside, half, tip], box, false)], ["in"]);
  assert.deepEqual([...lassoSelect([inside, half, tip], box, true)].sort(), ["half", "in", "tip"]);
});
