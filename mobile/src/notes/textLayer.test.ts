import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePage, quickHtml, type PdfChar } from "./quick.ts";
import { repairWithTextLayer } from "./textLayer.ts";
import type { Stroke } from "./model.ts";

// 지어낸 시험지 한 단. 갤럭시탭에서 본 것과 같은 꼴: 글자 인식이 ①→0, ③→3 으로 읽고 ②·④는 빠뜨리고, 낱말을 가운데서 끊는다.
const LINES = [
  "1. 사용자가 언제 어디서나 필요한 컴퓨팅 자원(하드웨어/소프트웨어)에",
  "접근하여 활용할 수 있는 유연한 환경을 의미하는 기술은?",
  "① 빅데이터",
  "② 가상현실",
  "③ 사물인터넷",
  "④ 클라우드 컴퓨팅",
  "2. 다음 중 운영체제가 하는 일로 알맞지 않은 것은?",
  "① 기억 장치 관리",
];
const cw = (c: string) => (/[㄰-㆏가-힣①-⑳]/.test(c) ? 10 : 5);
const xOf = (li: number, k: number, x0 = 40) => [...LINES[li]].slice(0, k).reduce((x, c) => x + cw(c), x0);
const yOf = (li: number) => 100 + li * 16;

/** 낱말 상자 하나: 줄 li에서 원문 조각 src가 차지하는 자리에, 인식이 읽은 글 read */
type El = { text: string; left: number; right: number; li: number };
function el(li: number, src: string, read = src, x0 = 40): El {
  const k = [...LINES[li].slice(0, LINES[li].indexOf(src))].length;
  return { text: read, left: xOf(li, k, x0), right: xOf(li, k + [...src].length, x0), li };
}
const words = (li: number, skip: string[] = [], read: Record<string, string> = {}, x0 = 40) =>
  LINES[li].split(" ").filter((w) => !skip.includes(w)).map((w) => el(li, w, read[w] ?? w, x0));

/** OcrText.kt 와 같은 계산: 낱말 사이는 무조건 " ", 낱말 상자를 글자 수로 똑같이 나눔, 줄 끝은 "\n" */
function ocrChars(lines: El[][], y = yOf): PdfChar[] {
  const out: PdfChar[] = [];
  for (const line of lines) {
    let prev = NaN;
    const top = y(line[0].li), bottom = top + 12;
    for (const e of line) {
      if (!Number.isNaN(prev)) out.push([" ", prev, top, e.left, bottom]);
      const cs = [...e.text], w = (e.right - e.left) / cs.length;
      cs.forEach((c, i) => out.push([c, e.left + w * i, top, e.left + w * (i + 1), bottom]));
      prev = e.right;
    }
    out.push(["\n", prev, top, prev, bottom]);
  }
  return out;
}
const tabletLike = () =>
  ocrChars([
    [el(0, "1."), el(0, "사용자가"), el(0, "언제"), el(0, "어디서나"), el(0, "필요한"), el(0, "컴퓨팅"), el(0, "자원(하드웨"), el(0, "어/소프트웨어)에")],
    words(1),
    words(2, [], { "①": "0" }),
    words(3, ["②"]),
    words(4, [], { "③": "3" }),
    words(5, ["④"]),
    words(6),
    words(7, [], { "①": "0" }),
  ]);
const text = (cs: PdfChar[]) => cs.map((c) => c[0]).join("");
const LAYER = LINES.join("\r\n"); // PdfRenderer가 주는 쪽 글 (줄 끝은 \r\n)

test("text-layer characters replace misread OCR characters, boxes stay", () => {
  const ocr = tabletLike();
  assert.match(text(ocr), /하드웨 어/);
  assert.match(text(ocr), /0 빅데이터\n가상현실\n3 사물인터넷\n클라우드 컴퓨팅/);
  const fixed = repairWithTextLayer(ocr, LAYER);
  assert.equal(text(fixed), LINES.join("\n") + "\n");
  // 잘못 읽은 ①은 '0'의 상자를 그대로, 빠졌던 ②는 '가상현실' 바로 왼쪽 같은 줄에
  const one = fixed.find((c) => c[0] === "①")!, zero = ocr.find((c) => c[0] === "0")!;
  assert.deepEqual(one.slice(1), zero.slice(1));
  const k = fixed.findIndex((c) => c[0] === "②");
  assert.equal(fixed[k + 1][0], " ");
  assert.equal(fixed[k + 2][0], "가");
  assert.ok(fixed[k][3] <= fixed[k + 2][1] && fixed[k][2] === fixed[k + 2][2]);
  // 맞게 읽은 글자의 상자는 바뀌지 않는다
  const ga = (cs: PdfChar[]) => cs.find((c) => c[0] === "빅")!;
  assert.deepEqual(ga(fixed), ga(ocr));
});

test("quick summary on the repaired characters reads like the page", () => {
  const fixed = repairWithTextLayer(tabletLike(), LAYER);
  const l0 = [...LINES[0]], l3 = [...LINES[3]];
  const hl = (id: string, li: number, a: number, b: number): Stroke => ({ id, tool: "highlighter", color: "#FFE14D", width: 12, pts: [xOf(li, a) + 1, yOf(li) + 6, 0.5, xOf(li, b + 1) - 1, yOf(li) + 6, 0.5] });
  // 태블릿에서 칠한 두 군데: '가 언제 어디서나 필요한 컴퓨팅 자' 와 '가상현실'
  const items = analyzePage(0, [hl("h1", 0, l0.indexOf("가"), l0.indexOf("원") - 1), hl("h2", 3, l3.indexOf("가"), l3.length - 1)], fixed);
  const shown = [...quickHtml({ title: "t", pages: [{ page: 0, items }] }).matchAll(/<li[^>]*><p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<mark[^>]*>/g, "[").replace(/<\/mark>/g, "]"));
  assert.deepEqual(shown, [
    "1. 사용자[가 언제 어디서나 필요한 컴퓨팅 자]원(하드웨어/소프트웨어)에 접근하여 활용할 수 있는 유연한 환경을 의미하는 기술은?",
    "② [가상현실]",
  ]);
});

test("reading order may differ from the text layer (two columns): every line is still repaired", () => {
  // 글자 층은 왼쪽 단(문제 1) → 오른쪽 단(문제 2), 인식은 위에서부터 왼쪽·오른쪽을 번갈아 읽었다
  const right = (li: number, skip: string[] = [], read: Record<string, string> = {}) => words(li, skip, read, 340);
  const ocr = ocrChars([words(0), right(6), words(1), right(7, [], { "①": "0" }), words(2, [], { "①": "0" }), words(3, ["②"]), words(4, [], { "③": "3" }), words(5, ["④"])], (li) => (li >= 6 ? yOf(li - 6) : yOf(li)));
  const fixed = repairWithTextLayer(ocr, LAYER);
  assert.equal(text(fixed), [0, 6, 1, 7, 2, 3, 4, 5].map((i) => LINES[i]).join("\n") + "\n");
});

test("lines that are not in the text layer stay as recognised; letters are never invented at line edges", () => {
  const ocr = tabletLike();
  assert.deepEqual(repairWithTextLayer(ocr, "전혀 다른 글입니다. 맞는 글자가 거의 없어요."), ocr);
  assert.equal(repairWithTextLayer(ocr, ""), ocr);
  assert.equal(repairWithTextLayer(ocr, " \r\n "), ocr);
  // '이다.' 한 줄: 글자 층의 다른 줄 '것이다.'와 맞아도 '것'을 끌어오지 않는다 (번호·기호만 되살린다)
  const short: PdfChar[] = [["이", 40, 100, 50, 112], ["다", 50, 100, 60, 112], [".", 60, 100, 65, 112], ["\n", 65, 100, 65, 112]];
  assert.deepEqual(repairWithTextLayer(short, "그런\r\n것이다.\r\n"), short);
  // 그 자리에 이미 다른 줄의 글자가 있으면 번호도 끌어오지 않는다 (같은 번호가 두 번 나오지 않게)
  const split = ocrChars([[el(3, "②")], [el(3, "가상현실")]]);
  assert.equal(text(repairWithTextLayer(split, LAYER)), "②\n가상현실\n");
});
