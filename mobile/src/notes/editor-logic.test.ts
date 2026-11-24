// 필기 화면의 작은 계산 시험: 쪽 바탕 그림(쪽 끼우기), 다른 쪽 되돌리기, 처음 열 쪽, 형광펜 톡 누르기, 색 단추 테두리
import { test } from "node:test";
import assert from "node:assert/strict";

import { clampPage, parsePageInput, openingPage, rememberPage, isHighlighterTap, justAfter, otherPage, pageBg, penDoubleClick, penSwap, previewPts, previewScale, reach, ro, swatchEdge, type BgCache, type SwapSaved, colorName, widthName } from "./editor-logic.ts";
import { History } from "./history.ts";
import { insertPage, removePage, type Ink, type Notebook, type Stroke } from "./model.ts";

const pdfNote = (n: number): Notebook => ({
  v: 1, id: "nb", title: "교재", created: 0, updated: 0, hasPdf: true,
  pages: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, w: 595, h: 842, pdf: i })),
});

test("a blank page put into a PDF note has no background, and later pages keep their own", () => {
  const nb = pdfNote(5);
  // 1쪽을 보는 동안 1쪽과 (미리 불러 둔) 2쪽, 그리고 넘겨 본 3쪽의 그림이 기억돼 있다
  const bg: BgCache = { p1: { uri: "교재 1쪽", w: 1400 }, p2: { uri: "교재 2쪽", w: 1400 }, p3: { uri: "교재 3쪽", w: 1400 } };
  const next = insertPage(nb, 0);
  assert.equal(next.pages.length, 6);
  assert.equal(pageBg(bg, next.pages[0]), "교재 1쪽");
  assert.equal(pageBg(bg, next.pages[1]), null, "새 빈 쪽에는 교재 그림이 없다");
  assert.equal(pageBg(bg, next.pages[2]), "교재 2쪽", "빈 쪽 다음은 교재 2쪽 (한 쪽 밀리지 않음)");
  assert.equal(pageBg(bg, next.pages[3]), "교재 3쪽");
  assert.equal(pageBg(bg, next.pages[4]), null, "아직 안 불러온 쪽은 그림 없음 (불러오면 채워짐)");
  // 쪽을 지워도 남은 쪽은 제 그림을 쓴다
  const less = removePage(nb, 0);
  assert.equal(pageBg(bg, less.pages[0]), "교재 2쪽");
  // 빈 속지는 같은 id로 그림이 기억돼 있어도 쓰지 않는다
  assert.equal(pageBg({ x: { uri: "잘못", w: 1 } }, { id: "x" }), null);
});

test("undo that changes another page tells which page to show", () => {
  const nb = pdfNote(2);
  const line = (id: string): Stroke => ({ id, tool: "pen", color: "#000000", width: 2, pts: [0, 0, 0.5, 10, 0, 0.5] });
  const hist = new History();
  let ink: Ink = {};
  for (const id of ["a", "b", "c"]) ink = hist.run(ink, { kind: "add", page: "p1", strokes: [line(id)] });
  ink = hist.run(ink, { kind: "add", page: "p2", strokes: [line("d")] });
  // 2쪽을 보는 채로 되돌리기: 첫 번째는 2쪽(지금 쪽), 그다음은 1쪽
  let r = hist.undo(ink);
  assert.equal(otherPage(nb.pages, "p2", r.page), -1, "지금 쪽이면 옮기지 않는다");
  r = hist.undo(r.ink);
  assert.equal(otherPage(nb.pages, "p2", r.page), 0, "1쪽이 바뀌었으니 1쪽으로");
  // 1쪽으로 옮긴 뒤에는 같은 쪽
  r = hist.undo(r.ink);
  assert.equal(otherPage(nb.pages, "p1", r.page), -1);
  // 다시 하기도 같다
  const again = hist.redo(r.ink);
  assert.equal(otherPage(nb.pages, "p2", again.page), 0);
  // 되돌릴 것이 없거나(쪽 없음) 지워진 쪽이면 옮기지 않는다
  assert.equal(otherPage(nb.pages, "p1", undefined), -1);
  assert.equal(otherPage(nb.pages, "p1", "없는쪽"), -1);
});

test("the page to open on is kept inside the notebook", () => {
  assert.equal(clampPage(undefined, 3), 0);
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(7, 3), 2, "쪽이 줄었으면 마지막 쪽");
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(clampPage(Number.NaN, 3), 0);
  assert.equal(clampPage(1.7, 3), 1);
  assert.equal(clampPage(0, 0), 0);
});

test("a highlighter tap is not a stroke, a short highlight is", () => {
  assert.equal(reach([10, 10, 0.5]), 0);
  assert.equal(reach([10, 10, 0.5, 10, 10, 0.5]), 0);
  assert.equal(reach([0, 0, 0.5, 30, 40, 0.5, 3, 4, 0.5]), 50, "돌아와도 가장 멀리 간 거리");
  assert.ok(isHighlighterTap([10, 10, 0.5, 10, 10, 0.5]), "길이 0 (톡 누름)");
  assert.ok(isHighlighterTap([10, 10, 0.5, 10.5, 10.3, 0.5]), "살짝 떨린 톡 (0.6pt)");
  assert.ok(!isHighlighterTap([10, 10, 0.5, 14, 10, 0.5]), "글자 하나쯤 칠한 것은 남긴다");
});

test("a press right after the menu closed is skipped", () => {
  assert.ok(justAfter(1200, 1000), "0.2초 뒤");
  assert.ok(justAfter(1350, 1000), "0.35초 뒤");
  assert.ok(!justAfter(1500, 1000), "0.5초 뒤는 보통 누름");
  assert.ok(!justAfter(5000, 0));
});

test("colour button edge is light on a dark card, unchanged on a light card", () => {
  assert.equal(swatchEdge("#ffffff"), "rgba(0,0,0,0.15)");
  assert.equal(swatchEdge("#ffffff", "rgba(0,0,0,0.18)"), "rgba(0,0,0,0.18)");
  assert.match(swatchEdge("#1e2025"), /^rgba\(255,255,255/, "어두운 모드 바탕");
  assert.equal(swatchEdge("이상한 값"), "rgba(0,0,0,0.15)");
});

test("pen preview is drawn at the zoom the page is shown at, and still fits its box", () => {
  assert.equal(previewScale(undefined), 1);
  assert.equal(previewScale(2.31), 2.31);
  assert.equal(previewScale(0.4), 1, "작게 보고 있어도 견본은 줄이지 않는다");
  assert.equal(previewScale(8), 3, "견본 칸을 넘지 않게");
  for (const s of [1, 2.31, 3]) {
    const pts = previewPts(s);
    const xs = pts.filter((_, i) => i % 3 === 0).map((x) => x * s);
    const ys = pts.filter((_, i) => i % 3 === 1).map((y) => y * s);
    assert.ok(Math.min(...xs) >= 14 - 1e-6 && Math.max(...xs) <= 330, "키워도 가로 330 안");
    assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 64, "키워도 세로 64 안");
  }
});

test("S Pen side button: two short presses while hovering = double click; holding it to erase does not count", () => {
  const feed = (events: [boolean, boolean, number][]) => {
    const f = penDoubleClick();
    return events.map(([pressed, hover, at]) => f(pressed, hover, at));
  };
  // 떠 있는 채로 짧게 두 번 → 두 번째 누름에서 true
  assert.deepEqual(feed([[true, true, 0], [false, true, 120], [true, true, 260], [false, true, 380]]), [false, false, true, false]);
  // 너무 느리게 두 번 → 아님
  assert.deepEqual(feed([[true, true, 0], [false, true, 120], [true, true, 700]]), [false, false, false]);
  // 첫 번째를 길게 누름 → 아님
  assert.deepEqual(feed([[true, true, 0], [false, true, 400], [true, true, 440]]), [false, false, false]);
  // 단추를 누른 채 화면에 대고 지움(닿은 채 뗌) → 바로 다시 눌러도 아님
  assert.deepEqual(feed([[true, true, 0], [false, false, 150], [true, true, 250]]), [false, false, false]);
  // 쓰다가(닿은 채) 눌렀다 뗌 → 아님
  assert.deepEqual(feed([[true, false, 0], [false, false, 100], [true, true, 200]]), [false, false, false]);
  // 세 번 빠르게: 두 번째에서 한 번만
  assert.deepEqual(feed([[true, true, 0], [false, true, 100], [true, true, 200], [false, true, 300], [true, true, 400]]), [false, false, true, false, false]);
});

test("double click switches to the registered tool and back", () => {
  const pen = { tool: "pen" as const, penBrush: "fountain" as const, penColor: "#1F2328", penWidth: 2, penDash: "solid" as const, favorite: null };
  // 펜 → 형광펜 → (그대로 두 번) → 펜
  const a = penSwap({ ...pen, swapTool: "highlighter" }, null)!;
  assert.deepEqual(a.patch, { tool: "highlighter" });
  assert.equal(a.say, "형광펜으로 바꿨어요");
  const b = penSwap({ ...pen, tool: "highlighter", swapTool: "highlighter" }, a.saved)!;
  assert.deepEqual(b.patch, { tool: "pen", penBrush: "fountain", penColor: "#1F2328", penWidth: 2, penDash: "solid" });
  assert.equal(b.say, "만년필로 돌아왔어요");
  assert.equal(b.saved, null);
  // 바꾼 뒤 손으로 다른 도구를 골랐으면, 그 도구에서 다시 바꾼다 (예전 상태로 끌려가지 않게)
  const c = penSwap({ ...pen, tool: "eraser", swapTool: "highlighter" }, a.saved as SwapSaved)!;
  assert.deepEqual(c.patch, { tool: "highlighter" });
  // 즐겨찾는 펜: 펜 모양을 통째로 바꾸고, 돌아올 때 원래 펜 모양으로
  const fav = { penBrush: "ballpoint" as const, penColor: "#D7263D", penWidth: 1.2, penDash: "solid" as const };
  const d = penSwap({ ...pen, swapTool: "favorite", favorite: fav }, null)!;
  assert.deepEqual(d.patch, { tool: "pen", ...fav });
  const e = penSwap({ ...pen, ...fav, swapTool: "favorite", favorite: fav }, d.saved)!;
  assert.equal(e.patch.penBrush, "fountain");
  assert.equal(e.patch.penColor, "#1F2328");
  // 즐겨찾는 펜이 없으면 알려만 준다, 끄기면 아무것도
  assert.equal(penSwap({ ...pen, swapTool: "favorite" }, null)!.say, "즐겨찾는 펜을 먼저 등록해 주세요 (펜 설정)");
  assert.equal(penSwap({ ...pen, swapTool: "off" }, null), null);
  // 이미 그 도구면 펜으로
  assert.deepEqual(penSwap({ ...pen, tool: "highlighter", swapTool: "highlighter" }, null)!.patch, { tool: "pen" });
  assert.equal(ro("지우개"), "지우개로");
  assert.equal(ro("볼펜"), "볼펜으로");
  assert.equal(ro("연필"), "연필로");
});

test("색·굵기 단추 이름표: 도구 모음의 모든 색에 이름이 있다", async () => {
  const { PEN_COLORS, HIGHLIGHT_COLORS } = await import("./model.ts");
  for (const c of [...PEN_COLORS, ...HIGHLIGHT_COLORS]) assert.ok(!colorName(c).startsWith("#"), c);
  assert.equal(colorName("#1f2328"), "검정");
  assert.equal(colorName("#123456"), "#123456");
  assert.equal(widthName(0), "굵기: 가늘게");
  assert.equal(widthName(2), "굵기: 굵게");
});

test("마지막에 보던 쪽 기억: 다시 열면 그 쪽, 요약에서 돌아오면 요약에서 보던 쪽, 지운 쪽이면 첫 쪽", () => {
  const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(openingPage(pages, undefined, "c"), 2);
  assert.equal(openingPage(pages, 1, "c"), 1); // 요약에서 돌아올 때가 먼저
  assert.equal(openingPage(pages, undefined, "gone"), 0);
  assert.equal(openingPage(pages, undefined, null), 0);
  let m = rememberPage({}, "n1", "a");
  m = rememberPage(m, "n2", "x");
  m = rememberPage(m, "n1", "c"); // 같은 노트는 덮어쓰고 가장 최근으로
  assert.deepEqual(m, { n2: "x", n1: "c" });
  // 너무 많으면 오래된 노트부터 잊는다
  let big: Record<string, string> = {};
  for (let i = 0; i < 5; i++) big = rememberPage(big, "n" + i, "p", 3);
  assert.deepEqual(Object.keys(big), ["n2", "n3", "n4"]);
});

test("쪽 번호 입력해서 가기: 숫자만, 범위 밖은 첫·마지막 쪽으로", () => {
  assert.equal(parsePageInput("45", 92), 44);
  assert.equal(parsePageInput(" 45쪽 ", 92), 44);
  assert.equal(parsePageInput("４５", 92), 44); // 전각 숫자
  assert.equal(parsePageInput("p.7", 92), 6);
  assert.equal(parsePageInput("200", 92), 91);
  assert.equal(parsePageInput("0", 92), 0);
  assert.equal(parsePageInput("", 92), null);
  assert.equal(parsePageInput("마흔", 92), null);
  assert.equal(parsePageInput("4-5", 92), null);
});
