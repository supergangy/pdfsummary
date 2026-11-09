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
