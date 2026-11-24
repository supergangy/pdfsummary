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
  assert.equal(s.after, " 문장이다."); // 경계의 띄어쓰기는 원문 그대로
  assert.match(quickHtml({ title: "<t>", pages: [] }), /&lt;t&gt;/);
});

// 여러 줄 글 → 글자 상자 (줄 끝마다 "\n")
function para(text: string): PdfChar[] {
  return text.split("\n").flatMap((ln, li) => [...line(ln, 40, 100 + li * 16), ["\n", 40 + [...ln].length * 10, 100 + li * 16, 40 + [...ln].length * 10, 112 + li * 16] as PdfChar]);
}
// quickHtml에서 화면에 보이는 글만: <mark>…</mark> → […]
const shown = (html: string) => [...html.matchAll(/<li[^>]*><p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<mark[^>]*>/g, "[").replace(/<\/mark>/g, "]"));

test("a mark that starts or ends inside a word keeps the word together ('사용자 [가 …자] 원' on the tablet)", () => {
  const chars = para("1. 사용자가 언제 어디서나 필요한 자원(하드웨어)에\n접근한다.");
  const a = chars.findIndex((c) => c[0] === "가"), b = chars.findIndex((c) => c[0] === "원") - 1;
  // '가 언제 어디서나 필요한 자' 만 칠한다 ('사용자' 뒤에서 시작, '자원' 가운데서 끝)
  const hl = S("h", "highlighter", [chars[a][1] + 1, 106, 0.5, chars[b][3] - 1, 106, 0.5], 12, "#FFE14D");
  const items = analyzePage(0, [hl], chars);
  assert.deepEqual(items[0].sentence, { before: "1. 사용자", mark: "가 언제 어디서나 필요한 자", after: "원(하드웨어)에 접근한다." });
  assert.deepEqual(shown(quickHtml({ title: "t", pages: [{ page: 0, items }] })), ["1. 사용자[가 언제 어디서나 필요한 자]원(하드웨어)에 접근한다."]);
  // 낱말을 통째로 칠하면 앞뒤 띄어쓰기가 원문대로 하나씩 남는다
  const whole = S("w", "highlighter", [chars[a + 2][1] + 1, 106, 0.5, chars[a + 3][3] - 1, 106, 0.5], 12, "#FFE14D");
  assert.deepEqual(shown(quickHtml({ title: "t", pages: [{ page: 0, items: analyzePage(0, [whole], chars) }] })), ["1. 사용자가 [언제] 어디서나 필요한 자원(하드웨어)에 접근한다."]);
});

test("question and choice numbers at the start of a line bound the sentence ('1.' was dropped, the next '2.' was glued on)", () => {
  const exam = para("3. 유연한 환경을 뜻하는 기술은?\n① 빅데이터\n② 가상현실\n③ 사물인터넷\n4. 둘째 문제이다");
  const at = (word: string) => {
    const k = exam.map((c) => c[0]).join("").indexOf(word);
    return sentenceAround(exam, k, k + [...word].length - 1);
  };
  // 보기에는 마침표가 없다: 보기 하나만, 다음 보기·다음 문제 번호는 딸려 오지 않는다
  assert.deepEqual(at("가상현실"), { before: "② ", mark: "가상현실", after: "" });
  assert.deepEqual(at("사물인터넷"), { before: "③ ", mark: "사물인터넷", after: "" });
  // 문제 번호 "3."은 문장에 남고, "4."의 마침표는 문장 끝이 아니다
  assert.deepEqual(at("유연한"), { before: "3. ", mark: "유연한", after: " 환경을 뜻하는 기술은?" });
  assert.deepEqual(at("둘째"), { before: "4. ", mark: "둘째", after: " 문제이다" });
  // 문장 가운데의 숫자·마침표는 예전처럼 문장 끝
  const mid = para("값은 3. 그리고 다음은 넷이다.");
  assert.deepEqual(sentenceAround(mid, 6, 8), { before: "", mark: "그리고", after: " 다음은 넷이다." });
});

test("the sentence stays inside its own block (tablet: table cells and code boxes were glued around an underline)", () => {
  // 글자 차례: 큰 제목 → 본문 두 줄 → 옆 표 칸 → 아래 코드 상자 (태블릿의 글자 인식 덩어리 차례처럼 뒤섞임)
  const big = (text: string, x: number, y: number): PdfChar[] => [...text].map((c, i) => [c, x + i * 20, y, x + (i + 1) * 20, y + 24] as PdfChar);
  const nl = (x: number, y: number, h = 12): PdfChar => ["\n", x, y, x, y + h];
  const chars: PdfChar[] = [
    ...big("개념 및 배경", 40, 40), nl(180, 40, 24),
    ...line("네트워크 공격은 모두 계층별", 40, 80), nl(190, 80),
    ...line("취약점을 이용하므로", 40, 96), nl(140, 96),
    ...line("TTL 필드", 400, 60), nl(460, 60), // 오른쪽 표 칸 (위쪽)
    ...line("arp -a 캐시 조회", 40, 300), // 한참 아래 코드 상자
  ];
  const text = chars.map((c) => c[0]).join("");
  const k = text.indexOf("공격은");
  const s = sentenceAround(chars, k, k + 2);
  assert.equal(s.before, "네트워크 ");
  assert.equal(s.mark, "공격은");
  assert.equal(s.after, " 모두 계층별 취약점을 이용하므로"); // 바로 밑 줄까지만, 표 칸·코드는 안 붙는다
  // 상자 높이를 모르는 글자는 예전처럼 마침표까지 이어 본다
  const flatChars = line("앞 문장. 칠한 말 뒤 문장.").map((c) => [c[0], c[1], 0, c[3], 0] as PdfChar);
  assert.equal(sentenceAround(flatChars, 6, 7).after, " 말 뒤 문장.");
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

test("underlines on neighbouring lines each pick their own line (they used to become one '표시' or only the middle line)", () => {
  // 줄 간격 16pt: 밑줄끼리 가까워 한 덩어리로 묶인다
  const chars = [...line("광합성은 엽록체에서 일어난다", 50, 100), ["\n", 200, 100, 200, 112] as PdfChar, ...line("명반응은 틸라코이드 막에서", 50, 116), ["\n", 190, 116, 190, 128] as PdfChar, ...line("암반응은 스트로마에서 진행", 50, 132)];
  const under = (id: string, x0: number, x1: number, y: number) => S(id, "pen", [x0, y, 0.5, (x0 + x1) / 2, y + 0.8, 0.5, x1, y, 0.5]);
  const two = analyzePage(0, [under("u1", 51, 89, 113.5), under("u2", 101, 169, 129.5)], chars);
  assert.deepEqual(two.map((i) => [i.kind, i.text]), [["underline", "광합성은"], ["underline", "틸라코이드 막"]]);
  const three = analyzePage(0, [under("u1", 51, 89, 113.5), under("u2", 101, 169, 129.5), under("u3", 51, 89, 145.5)], chars);
  assert.deepEqual(three.map((i) => [i.kind, i.text]), [["underline", "광합성은"], ["underline", "틸라코이드 막"], ["underline", "암반응은"]]);
  // 글자가 없는 곳에 그은 줄은 같은 덩어리여도 밑줄 글자에 섞이지 않고 '표시'로 남는다
  const loose = analyzePage(0, [under("u1", 51, 89, 113.5), under("x", 51, 89, 160)], chars);
  assert.deepEqual(loose.map((i) => i.kind).sort(), ["mark", "underline"]);
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
