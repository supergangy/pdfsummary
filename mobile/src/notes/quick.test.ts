import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePage, clusterStrokes, quickHtml, sentenceAround, type PdfChar } from "./quick.ts";
import type { Stroke } from "./model.ts";

// 한 줄에 글자 하나 10pt 폭: "효소는 촉매이다. 경쟁적 저해제는 결합한다." (y 100~112)
function line(text: string, x = 50, y = 100): PdfChar[] {
  return [...text].map((c, i) => [c, x + i * 10, y, x + (i + 1) * 10, y + 12] as PdfChar);
}
const S = (id: string, tool: Stroke["tool"], pts: number[], width = 2, color = "#000000"): Stroke => ({ id, tool, color, width, pts });

test("highlighter picks the characters under it and the sentence around", () => {
  const chars = line("효소는 촉매이다. 경쟁적 저해제는 결합한다.");
  // '경쟁적 저해제' = 10~16번째 글자 → x 150~220
  const hl = S("h", "highlighter", [152, 106, 0.5, 218, 106, 0.5], 12, "#FFE14D");
  const [it] = analyzePage(0, [hl], chars);
  assert.equal(it.kind, "highlight");
  assert.equal(it.text, "경쟁적 저해제");
  assert.deepEqual(it.sentence, { before: "", mark: "경쟁적 저해제", after: "는 결합한다." });
});

test("highlight across a line break is one item", () => {
  const chars = [...line("활성화 에너지를", 50, 100), ["\n", 130, 100, 130, 112] as PdfChar, ...line("낮추는 촉매이다.", 50, 120)];
  const a = S("a", "highlighter", [52, 106, 0.5, 128, 106, 0.5], 12);
  const b = S("b", "highlighter", [52, 126, 0.5, 78, 126, 0.5], 12);
  const items = analyzePage(0, [a, b], chars);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "활성화 에너지를 낮추는");
});

test("pen line under text = underline, loop = circle, scribble = handwriting", () => {
  const chars = line("효소는 촉매이다. 경쟁적 저해제는 결합한다.");
  const under = S("u", "pen", [150, 114, 0.5, 185, 114.5, 0.5, 220, 114, 0.5]);
  const loop: number[] = [];
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    loop.push(66 + 21 * Math.cos(a), 106 + 10 * Math.sin(a), 0.5);
  }
  const circle = S("c", "pen", loop);
  const scrib: number[] = [];
  for (let k = 0; k < 20; k++) scrib.push(300 + k * 3, 300 + (k % 4) * 5, 0.5);
  const hw = S("w", "pen", scrib);
  const items = analyzePage(2, [under, circle, hw], chars);
  const by = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.equal(by.underline.text, "경쟁적 저해제");
  assert.equal(by.circle.text, "효소는");
  assert.equal(by.handwriting.strokes.length, 1);
  assert.equal(by.handwriting.page, 2);
});

test("no text layer (blank page / scan): everything stays as pictures", () => {
  const items = analyzePage(0, [S("h", "highlighter", [0, 0, 0.5, 50, 0, 0.5], 12), S("p", "pen", [0, 50, 0.5, 10, 60, 0.5])], null);
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["highlight", ""], ["handwriting", ""]]);
  const html = quickHtml({ title: "빈 노트", pages: [{ page: 0, items }] });
  assert.match(html, /<svg class="ink"/);
  assert.match(html, /형광펜 1 · 손글씨 1/);
});

test("strokes close together form one handwriting group", () => {
  const a = S("a", "pen", [0, 0, 0.5, 5, 10, 0.5]);
  const b = S("b", "pen", [12, 0, 0.5, 18, 10, 0.5]);
  const c = S("c", "pen", [200, 200, 0.5, 210, 210, 0.5]);
  assert.deepEqual(clusterStrokes([a, b, c]).map((g) => g.map((s) => s.id)), [["a", "b"], ["c"]]);
});

test("sentence boundaries", () => {
  const chars = line("첫 문장이다. 둘째 문장이다. 셋째.");
  const s = sentenceAround(chars, 8, 9); // '둘째'
  assert.equal(s.before, "");
  assert.equal(s.mark, "둘째");
  assert.equal(s.after, "문장이다.");
  assert.match(quickHtml({ title: "<t>", pages: [] }), /&lt;t&gt;/);
});

test("multi-line handwriting is split into lines (top to bottom, strokes in writing order)", async () => {
  const { splitInkLines } = await import("./quick.ts");
  const st = (id: string, x: number, y: number, w = 12, h = 14): Stroke => ({ id, tool: "pen", color: "#000000", width: 2, pts: [x, y, 0.5, x + w, y + h, 0.5] });
  // "?" 하나가 위에 크게, 그 밑에 세 줄 (사진의 '안녕하세요 / 만나서 / 반가워요' 처럼)
  const strokes = [
    st("q", 10, 0, 20, 60),
    st("l1a", 40, 80), st("l1b", 56, 78), st("l1c", 72, 82),
    st("l2a", 60, 120), st("l2b", 78, 122),
    st("l3a", 90, 160), st("dot", 104, 170, 2, 2), st("l3b", 110, 158),
  ];
  const lines = splitInkLines(strokes).map((l) => l.map((s) => s.id));
  assert.deepEqual(lines, [["q"], ["l1a", "l1b", "l1c"], ["l2a", "l2b"], ["l3a", "dot", "l3b"]]);
});

// 획 하나를 상자 [x0, y0, x1, y1]로 (줄 나누기는 상자만 본다)
const boxStroke = (id: string, x0: number, y0: number, x1: number, y1: number): Stroke => ({ id, tool: "pen", color: "#000000", width: 2, pts: [x0, y0, 0.5, x1, y1, 0.5] });

test("Hangul final consonants stay on their line ('안녕' was read as '아녀' + 'U')", async () => {
  const { splitInkLines } = await import("./quick.ts");
  // 쓴 차례: ㅇ ㅏ ㄴ(받침) / ㄴ ㅕ ㅇ(받침). 받침 둘은 윗부분보다 아래에 있어 세로로 거의 안 겹친다
  const annyeong = [
    boxStroke("an-o", 0, 8, 12, 20), boxStroke("an-a", 14, 4, 20, 24), boxStroke("an-n", 2, 25, 22, 36),
    boxStroke("nyeong-n", 28, 6, 38, 16), boxStroke("nyeong-yeo", 40, 0, 46, 26), boxStroke("nyeong-o", 30, 22, 44, 38),
  ];
  assert.deepEqual(splitInkLines(annyeong).map((l) => l.map((s) => s.id)), [["an-o", "an-a", "an-n", "nyeong-n", "nyeong-yeo", "nyeong-o"]]);

  // 글자 하나('안') + 멀리 떨어진 다음 줄: 받침은 붙고 다음 줄은 그대로 따로
  const an = [boxStroke("o", 0, 8, 12, 20), boxStroke("a", 14, 4, 20, 24), boxStroke("n", 2, 27, 22, 36), boxStroke("next1", 0, 70, 12, 90), boxStroke("next2", 16, 70, 28, 90)];
  assert.deepEqual(splitInkLines(an).map((l) => l.map((s) => s.id)), [["o", "a", "n"], ["next1", "next2"]]);

  // 마지막 글자에만 받침('가방'): 윗줄 끝 글자 밑의 받침은 같은 줄
  const gabang = [boxStroke("g", 0, 2, 10, 14), boxStroke("a1", 12, 0, 18, 20), boxStroke("b", 24, 2, 34, 14), boxStroke("a2", 36, 0, 42, 20), boxStroke("ng", 26, 23, 40, 32)];
  assert.deepEqual(splitInkLines(gabang).map((l) => l.length), [5]);
});

test("two real lines written close together stay two lines", async () => {
  const { splitInkLines } = await import("./quick.ts");
  // 윗줄을 다 쓰고 아랫줄을 썼다. 줄 사이가 좁아도 아랫줄이 길면 받침이 아니다
  const top = [0, 1, 2, 3, 4].map((i) => boxStroke(`t${i}`, i * 18, 0, i * 18 + 12, 14));
  const bottom = [0, 1, 2, 3, 4].map((i) => boxStroke(`b${i}`, i * 18, 19, i * 18 + 12, 33));
  assert.deepEqual(splitInkLines([...top, ...bottom]).map((l) => l.length), [5, 5]);
  // 짧은 아랫줄이 왼쪽 끝에서 시작해도 (새 줄) 그대로 따로
  const short = [boxStroke("s0", 0, 19, 12, 33)];
  assert.deepEqual(splitInkLines([...top, ...short]).map((l) => l.length), [5, 1]);
});

test("a short flat line or a dot with no text under it is a mark, not handwriting", () => {
  const dash: Stroke = { id: "d", tool: "pen", color: "#000000", width: 2, pts: [10, 50, 0.5, 40, 51, 0.5] };
  const dot: Stroke = { id: "o", tool: "pen", color: "#000000", width: 2, pts: [200, 200, 0.5, 202, 201, 0.5] };
  const items = analyzePage(0, [dash, dot], null);
  assert.deepEqual(items.map((i) => i.kind), ["mark", "mark"]);
  assert.match(quickHtml({ title: "t", pages: [{ page: 0, items }] }), /표시 2/);
});
