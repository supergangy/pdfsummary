// 노트 데이터·획 계산·되돌리기 시험 (기기 없이 Node로)
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankNotebook, insertPage, makeTextBox, movePage, parseNotebook, parseStrokes, pdfNotebook, removePage, type Stroke } from "./model.ts";
import { bounds, clampView, fitWidth, hitAlong, hits, penOutline, polylineSvg, straighten, strokeSvg, thin, toPage } from "./geometry.ts";
import { History, removal } from "./history.ts";

const S = (id: string, pts: number[], tool: Stroke["tool"] = "pen", width = 2): Stroke => ({ id, tool, color: "#000000", width, pts });

test("notebook pages: insert, move, remove", () => {
  let nb = blankNotebook("수학", "grid", 2);
  assert.equal(nb.pages.length, 2);
  nb = insertPage(nb, 0);
  assert.equal(nb.pages.length, 3);
  assert.equal(nb.pages[1].paper, "grid");
  const ids = nb.pages.map((p) => p.id);
  nb = movePage(nb, 0, 2);
  assert.deepEqual(nb.pages.map((p) => p.id), [ids[1], ids[2], ids[0]]);
  nb = removePage(nb, 1);
  assert.equal(nb.pages.length, 2);
  const one = blankNotebook("x", "plain", 1);
  assert.equal(removePage(one, 0).pages.length, 1, "마지막 쪽은 지우지 않음");
  const pdf = pdfNotebook("책", [{ w: 500, h: 700 }, { w: 600, h: 800 }]);
  assert.deepEqual(pdf.pages.map((p) => p.pdf), [0, 1]);
  assert.ok(pdf.hasPdf);
});

test("parse tolerates broken saved data", () => {
  assert.equal(parseNotebook(null), null);
  assert.equal(parseNotebook({ id: "a", pages: [] }), null);
  const nb = parseNotebook({ id: "a", title: "", pages: [{ id: "p", w: 10, h: 10, pdf: 2 }, { id: "q", w: 0, h: 5 }] });
  assert.equal(nb?.title, "제목 없는 노트");
  assert.equal(nb?.pages.length, 1);
  assert.equal(nb?.pages[0].pdf, 2);
  const ss = parseStrokes([S("a", [1, 2, 0.5]), { id: "b", tool: "pen", color: "#000", width: 1, pts: [1, 2] }, null]);
  assert.deepEqual(ss.map((s) => s.id), ["a"]);
});

test("text box fits its text and stays inside the page", () => {
  const W = 595.28;
  // 짧은 글: 상자가 글만큼만 (예전에는 폭 320 → 옆의 필기를 지우다 같이 지워졌다)
  const memo = makeTextBox("m", 60, 100, "메모", 16, "#000000", W);
  const mw = memo.pts[3] - memo.pts[0];
  assert.equal(memo.pts[0], 60);
  assert.ok(mw >= 32 && mw <= 60, `'메모' 상자 폭 ${mw}`);
  assert.ok(Math.abs(memo.pts[4] - memo.pts[1] - 16 * 1.4) < 1e-9, "한 줄 높이");
  assert.ok(!hits(memo, 200, 110, 6), "글에서 떨어진 곳을 지워도 글상자는 안 닿음");
  assert.ok(hits(memo, 75, 110, 6));
  // 여러 줄: 가장 긴 줄에 맞춤
  const two = makeTextBox("t", 60, 100, "가\n가나다라마바사", 16, "#000000", W);
  assert.ok(two.pts[3] - two.pts[0] >= 7 * 16 && two.pts[3] - two.pts[0] < 320);
  assert.ok(Math.abs(two.pts[4] - two.pts[1] - 2 * 16 * 1.4) < 1e-9, "두 줄 높이");
  // 긴 글: 많아야 320, 줄이 바뀜
  const long = makeTextBox("l", 60, 100, "가".repeat(60), 16, "#000000", W);
  assert.equal(long.pts[3] - long.pts[0], 320);
  assert.ok(long.pts[4] - long.pts[1] > 16 * 1.4 * 2);
  // 쪽 오른쪽 끝에서: 왼쪽으로 당겨 쪽 안에 (예전에는 x 570~650으로 쪽 밖)
  const edge = makeTextBox("e", 570, 100, "오른쪽 끝에 쓴 조금 긴 메모입니다", 16, "#000000", W);
  assert.ok(edge.pts[0] >= 0 && edge.pts[3] <= W - 18 + 1e-9, `x ${edge.pts[0]}~${edge.pts[3]}`);
  assert.ok(edge.pts[3] - edge.pts[0] >= 80);
  const edgeShort = makeTextBox("s", 590, 100, "메모", 16, "#000000", W);
  assert.ok(edgeShort.pts[3] <= W - 18 + 1e-9 && edgeShort.pts[3] - edgeShort.pts[0] < 80);
  // 저장 모양은 그대로 (글상자 = 두 모서리 6개 값)
  assert.equal(parseStrokes([memo, edge]).length, 2);
});

test("pen outline and svg paths", () => {
  const s = S("a", [0, 0, 0.5, 10, 0, 0.5, 20, 5, 0.5, 30, 10, 0.5]);
  const o = penOutline(s);
  assert.ok(o.length > 4);
  const d = strokeSvg(s);
  assert.match(d, /^M[\d.,-]+ Q/);
  assert.ok(d.endsWith("Z"));
  // 점 하나도 그려진다
  assert.ok(strokeSvg(S("dot", [5, 5, 0.5])).length > 0);
  const h = polylineSvg(S("h", [0, 0, 0.5, 10, 1, 0.5], "highlighter", 12));
  assert.equal(h, "M0,0L10,1");
});

test("bounds and eraser hits", () => {
  const s = S("a", [0, 0, 0.5, 100, 0, 0.5], "pen", 4);
  assert.deepEqual(bounds(s), [-2, -2, 102, 2]);
  assert.ok(hits(s, 50, 3, 2));
  assert.ok(!hits(s, 50, 10, 2));
  // 빠르게 지나가도 사이의 획을 맞힌다
  const t = S("b", [50, -100, 0.5, 50, 100, 0.5]);
  const got = hitAlong([s, t], 0, 50, 100, 50, 3);
  assert.deepEqual(got.map((x) => x.id), ["b"]);
});

test("thin keeps ends and drops crowded points", () => {
  const pts: number[] = [];
  for (let i = 0; i <= 100; i++) pts.push(i * 0.1, 0, 0.5);
  const out = thin(pts, 1);
  assert.ok(out.length / 3 < 15);
  assert.deepEqual(out.slice(0, 3), [0, 0, 0.5]);
  assert.deepEqual(out.slice(-3), [10, 0, 0.5]);
});

test("straight highlighter: nearly horizontal → flat line, otherwise unchanged", () => {
  const wobbly = [0, 100, 0.5, 30, 103, 0.5, 60, 98, 0.5, 90, 101, 0.5];
  const st = straighten(wobbly);
  assert.equal(st.length, 6);
  assert.equal(st[1], st[4]);
  const diag = [0, 0, 0.5, 30, 30, 0.5];
  assert.deepEqual(straighten(diag), diag);
});

test("view math", () => {
  const v = fitWidth(600, 800, 1000, 700);
  assert.ok(Math.abs(v.scale * 600 + 24 - 1000) < 1e-6);
  const [x, y] = toPage(v, v.tx + v.scale * 10, v.ty + v.scale * 20);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 20) < 1e-9);
  // 작은 쪽은 가운데로
  const c = clampView({ scale: 0.5, tx: 0, ty: 0 }, 600, 800, 1000, 700, 0.1, 10);
  assert.equal(c.tx, (1000 - 300) / 2);
  // 큰 쪽은 가장자리를 넘어 끌리지 않는다
  const big = clampView({ scale: 3, tx: 100, ty: -99999 }, 600, 800, 1000, 700, 0.1, 10);
  assert.equal(big.tx, 0);
  assert.equal(big.ty, 700 - 2400);
});

test("undo / redo keeps stacking order", () => {
  const h = new History();
  let ink = {};
  const a = S("a", [0, 0, 0.5]), b = S("b", [1, 1, 0.5]), c = S("c", [2, 2, 0.5]);
  ink = h.run(ink, { kind: "add", page: "p", strokes: [a] });
  ink = h.run(ink, { kind: "add", page: "p", strokes: [b] });
  ink = h.run(ink, { kind: "add", page: "p", strokes: [c] });
  const op = removal(ink, "p", new Set(["a", "c"]))!;
  ink = h.run(ink, op);
  assert.deepEqual((ink as Record<string, Stroke[]>).p.map((s) => s.id), ["b"]);
  ink = h.undo(ink).ink;
  assert.deepEqual((ink as Record<string, Stroke[]>).p.map((s) => s.id), ["a", "b", "c"], "지운 획이 원래 순서로");
  ink = h.undo(ink).ink;
  assert.deepEqual((ink as Record<string, Stroke[]>).p.map((s) => s.id), ["a", "b"]);
  ink = h.redo(ink).ink;
  ink = h.redo(ink).ink;
  assert.deepEqual((ink as Record<string, Stroke[]>).p.map((s) => s.id), ["b"]);
  assert.ok(!h.canRedo);
  assert.equal(removal(ink, "p", new Set(["zz"])), null);
});
