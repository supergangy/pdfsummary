import { test } from "node:test";
import assert from "node:assert/strict";
import { applyExplains, boxesToMeasure, buildDraft, countOn, explainRequest, layoutNote, meaningOf, measureKey, moveEntry, patchEntry, tagOf, usedHighlightColors, wholeWords, type MyNoteDraft } from "./myNote.ts";
import { A4, type Stroke } from "./model.ts";
import type { QuickItem, QuickSummary } from "./quick.ts";

const item = (p: Partial<QuickItem> & Pick<QuickItem, "kind" | "box">): QuickItem => ({ page: 0, color: "#FFE14D", text: "", strokes: [], ...p });
const sent = (before: string, mark: string, after: string) => ({ before, mark, after });
const pen = (id: string, pts: number[]): Stroke => ({ id, tool: "pen", color: "#1A1A1A", width: 2, pts });

function sample(): QuickSummary {
  return {
    title: "생물 교재",
    pages: [
      {
        page: 2,
        items: [
          item({ page: 2, kind: "highlight", text: "경쟁적 저해제", sentence: sent("", "경쟁적 저해제", "는 기질과 구조가 비슷하여 활성 부위에 결합한다."), box: [50, 100, 120, 112] }),
          // 같은 줄 오른쪽 여백의 메모 → 위 항목에 붙는다
          item({ page: 2, kind: "handwriting", color: "#1A1A1A", text: "시험\n나옴", box: [480, 98, 530, 130] }),
          item({ page: 2, kind: "underline", color: "#1A1A1A", text: "기질 농도", sentence: sent("", "기질 농도", "를 높이면 저해가 줄어든다."), box: [50, 200, 100, 212] }),
          item({ page: 2, kind: "circle", color: "#E53935", text: "알로스테릭", sentence: sent("", "알로스테릭", " 조절"), box: [50, 300, 110, 312] }),
          // 칠한 곳에서 먼 메모 → 따로
          item({ page: 2, kind: "memo", color: "#1A1A1A", text: "다음 시간에 질문하기", box: [60, 600, 300, 620] }),
          // 글자로 못 읽은 손글씨 → 그림 항목
          item({ page: 2, kind: "handwriting", color: "#1A1A1A", text: "", box: [60, 700, 160, 760], strokes: [pen("w", [60, 700, 0.5, 160, 760, 0.5])] }),
          // 짧은 표시·글자 없는 형광펜은 넣지 않는다
          item({ page: 2, kind: "mark", color: "#1A1A1A", box: [10, 10, 14, 12] }),
          item({ page: 2, kind: "highlight", text: "", box: [10, 400, 90, 410] }),
        ],
      },
      { page: 5, items: [item({ page: 5, kind: "highlight", color: "#8FE38F", text: "예: 말론산", sentence: sent("", "예: 말론산", ""), box: [50, 100, 120, 112] })] },
    ],
  };
}

test("summary → draft: textbook page order, memos attached to nearby marks, loose memo and ink kept", () => {
  const d = buildDraft(sample());
  assert.equal(d.title, "생물 교재 정리");
  assert.deepEqual(d.sections.map((s) => s.title), ["3쪽", "6쪽"]);
  const [a, b] = d.sections;
  assert.deepEqual(a.entries.map((e) => e.kind), ["point", "point", "term", "memo", "ink"]);
  assert.equal(a.entries[0].text, "경쟁적 저해제");
  assert.equal(a.entries[0].context, "경쟁적 저해제는 기질과 구조가 비슷하여 활성 부위에 결합한다.");
  assert.equal(a.entries[0].memo, "시험 나옴"); // 줄바꿈은 한 줄로
  assert.equal(a.entries[3].text, "다음 시간에 질문하기");
  assert.equal(a.entries[4].strokes.length, 1);
  assert.equal(b.entries[0].context, ""); // 문장이 칠한 글과 같으면 문장은 빼고
  assert.equal(d.glossary, true);
  assert.deepEqual(countOn(d), { on: 6, all: 6 });
});

test("two highlights of one color in one sentence become one entry", () => {
  const s = sent("", "효소는", " 반응의 활성화 에너지를 낮춘다.");
  const d = buildDraft({
    title: "t",
    pages: [{ page: 0, items: [
      item({ kind: "highlight", text: "효소는", sentence: s, box: [50, 100, 80, 112] }),
      item({ kind: "highlight", text: "활성화 에너지", sentence: sent("효소는 반응의 ", "활성화 에너지", "를 낮춘다."), box: [120, 100, 190, 112] }),
    ] }],
  });
  assert.equal(d.sections[0].entries.length, 1);
  assert.equal(d.sections[0].entries[0].text, "효소는 · 활성화 에너지");
});

test("color meanings: defaults by highlighter color, custom names win, blank falls back", () => {
  assert.equal(meaningOf("#ffe14d", {}), "핵심");
  assert.equal(meaningOf("#FFE14D", { "#FFE14D": "개념" }), "개념");
  assert.equal(meaningOf("#FFE14D", { "#FFE14D": "  " }), "형광펜");
  assert.equal(meaningOf("#123456", {}), "형광펜");
  const d = buildDraft(sample());
  const [a] = d.sections;
  assert.deepEqual(a.entries.map((e) => tagOf(e, {})), ["핵심", "밑줄", "용어", "내 메모", "손글씨"]);
  assert.deepEqual(usedHighlightColors(d), ["#FFE14D", "#8FE38F"]);
});

test("move and edit entries without touching others", () => {
  const d = buildDraft(sample());
  const [first, second] = d.sections[0].entries;
  const moved = moveEntry(d, second.id, -1);
  assert.deepEqual(moved.sections[0].entries.slice(0, 2).map((e) => e.id), [second.id, first.id]);
  assert.equal(moveEntry(d, first.id, -1).sections[0], d.sections[0]); // 맨 위에서 위로는 그대로
  const off = patchEntry(d, first.id, { on: false, memo: "고친 메모" });
  assert.equal(off.sections[0].entries[0].on, false);
  assert.equal(off.sections[0].entries[0].memo, "고친 메모");
  assert.equal(d.sections[0].entries[0].on, true); // 원래 초안은 그대로
  assert.deepEqual(countOn(off), { on: 5, all: 6 });
});

/** 같은 쪽의 글상자끼리 겹치지 않는지 */
function overlaps(ss: Stroke[]): string[] {
  const boxes = ss.filter((s) => s.tool === "text");
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].pts, b = boxes[j].pts;
      if (a[0] < b[3] - 0.5 && b[0] < a[3] - 0.5 && a[1] < b[4] - 0.5 && b[1] < a[4] - 0.5) bad.push(`${boxes[i].text} ↔ ${boxes[j].text}`);
    }
  return bad;
}

test("layout: title, legend, sections and glossary as text boxes inside the page, nothing overlapping", () => {
  const d = buildDraft(sample());
  const { nb, ink } = layoutNote(d, { "#8FE38F": "보기" }, Date.UTC(2026, 10, 22, 3));
  assert.equal(nb.title, "생물 교재 정리");
  assert.equal(nb.hasPdf, false);
  assert.equal(nb.pages.length, 1);
  const ss = ink[nb.pages[0].id];
  const texts = ss.filter((s) => s.tool === "text").map((s) => s.text);
  assert.equal(texts[0], "생물 교재 정리");
  assert.match(texts[1], /^생물 교재 · 2026\. 11\. 22\. · 6개$/);
  for (const t of ["핵심", "밑줄", "용어", "내 메모", "손글씨", "보기", "3쪽", "6쪽", "경쟁적 저해제", "메모: 시험 나옴", "용어 모음", "예: 말론산"]) assert.ok(texts.includes(t), `없음: ${t}`);
  assert.equal(texts.filter((t) => t === "알로스테릭").length, 2); // 본문 + 용어 모음
  // 손글씨 그림은 펜 획 그대로 옮겨진다
  assert.ok(ss.some((s) => s.tool === "pen" && s.color === "#1A1A1A"));
  for (const s of ss) {
    for (let i = 0; i < s.pts.length; i += 3) {
      assert.ok(s.pts[i] >= 0 && s.pts[i] <= A4.w, `쪽 밖(가로): ${s.text ?? s.tool}`);
      assert.ok(s.pts[i + 1] >= 0 && s.pts[i + 1] <= A4.h, `쪽 밖(세로): ${s.text ?? s.tool}`);
    }
  }
  assert.deepEqual(overlaps(ss), []);
});

test("layout: entries left out, no sentences, no glossary", () => {
  let d: MyNoteDraft = buildDraft(sample());
  d = patchEntry(d, d.sections[0].entries[1].id, { on: false });
  d = { ...d, withContext: false, glossary: false };
  const { nb, ink } = layoutNote(d, {});
  const texts = Object.values(ink).flat().filter((s) => s.tool === "text").map((s) => s.text);
  assert.ok(!texts.includes("기질 농도"));
  assert.ok(!texts.includes("밑줄")); // 뜻 풀이에도 없다
  assert.ok(!texts.some((t) => t?.includes("활성 부위에 결합한다")));
  assert.ok(!texts.includes("용어 모음"));
  assert.equal(nb.pages.length, 1);
});

test("layout: long notes flow onto more pages and stay above the bottom margin", () => {
  const items: QuickItem[] = [];
  for (let k = 0; k < 40; k++) {
    items.push(item({ kind: "highlight", color: k % 2 ? "#FF9EC7" : "#FFE14D", text: `중요한 문장 ${k}번`, sentence: sent("앞에 오는 꽤 긴 설명 글과 함께 ", `중요한 문장 ${k}번`, "이 이어지고 그 뒤로도 한참 이어지는 문장이라 두 줄쯤 된다."), box: [50, 20 + k * 18, 200, 32 + k * 18] }));
  }
  const { nb, ink } = layoutNote(buildDraft({ title: "긴 노트", pages: [{ page: 0, items }] }), {});
  assert.ok(nb.pages.length >= 3, `쪽 수 ${nb.pages.length}`);
  for (const p of nb.pages) {
    const ss = ink[p.id];
    assert.ok(ss.length > 0);
    for (const s of ss.filter((x) => x.tool === "text")) assert.ok(s.pts[4] <= A4.h - 40, `아래 여백 침범: ${s.text} ${s.pts[4]}`);
    assert.deepEqual(overlaps(ss), []);
  }
  const all = Object.values(ink).flat().map((s) => s.text);
  for (let k = 0; k < 40; k++) assert.ok(all.includes(`중요한 문장 ${k}번`));
});

test("layout: big handwriting is shrunk to fit the column", () => {
  const big = [pen("a", [0, 0, 0.5, 900, 300, 0.5])];
  const d = buildDraft({ title: "t", pages: [{ page: 0, items: [item({ kind: "handwriting", text: "", box: [0, 0, 900, 300], strokes: big })] }] });
  const { nb, ink } = layoutNote(d, {});
  const s = ink[nb.pages[0].id].find((x) => x.tool === "pen" && x.color === "#1A1A1A")!;
  const w = s.pts[3] - s.pts[0];
  assert.ok(w <= A4.w - 112 && w > 100, `폭 ${w}`);
  assert.ok(s.width < 2);
});

test("a highlight cut in the middle of a word is widened to the whole word, but not over a particle", () => {
  assert.equal(
    wholeWords(sent("1. 사용자", "가 언제 어디서나 필요한 컴퓨팅 자", "원(하드웨어/소프트웨어)에 접근하여")),
    "사용자가 언제 어디서나 필요한 컴퓨팅 자원(하드웨어/소프트웨어)에",
  );
  assert.equal(wholeWords(sent("", "경쟁적 저해제", "는 결합한다.")), "경쟁적 저해제"); // 조사는 붙이지 않는다
  assert.equal(wholeWords(sent("효소는 ", "활성화 에너지", "를 낮춘다.")), "활성화 에너지");
  assert.equal(wholeWords(sent("② ", "가상현실", "")), "가상현실");
  assert.equal(wholeWords(sent("", "결합한", "다.")), "결합한다.");
  assert.equal(wholeWords(sent("", "아닌 것은", "?")), "아닌 것은"); // 문장 부호만이면 그대로
  const d = buildDraft({ title: "t", pages: [{ page: 0, items: [item({ kind: "highlight", text: "가 언제", sentence: sent("1. 사용자", "가 언제", " 어디서나"), box: [50, 100, 90, 112] })] }] });
  assert.equal(d.sections[0].entries[0].text, "사용자가 언제");
});

test("handwriting read as a lone symbol stays a drawing; file-name titles read nicely", () => {
  const d = buildDraft({
    title: "2025_9급_국가직_컴퓨터일반(나)",
    pages: [{ page: 0, items: [item({ kind: "handwriting", color: "#1A1A1A", text: "~", box: [60, 700, 160, 760], strokes: [pen("w", [60, 700, 0.5, 160, 760, 0.5])] })] }],
  });
  assert.equal(d.sections[0].entries[0].kind, "ink");
  assert.equal(d.title, "2025 9급 국가직 컴퓨터일반(나) 정리");
  assert.equal(d.source, "2025 9급 국가직 컴퓨터일반(나)");
});

test("layout uses the heights measured on the device: a title that wraps more pushes everything down", () => {
  const d = buildDraft(sample());
  const boxes = boxesToMeasure(d, {});
  const keys = new Set(boxes.map((b) => b.key));
  assert.equal(keys.size, boxes.length); // 같은 글상자는 한 번만 잰다
  assert.ok(boxes.some((b) => b.text === "생물 교재 정리" && b.size === 24));
  // 기기에서는 제목이 3줄, 나머지는 어림과 같다고 치자
  const titleKey = boxes.find((b) => b.size === 24)!;
  const tall = 24 * 1.4 * 3;
  const { nb, ink } = layoutNote(d, {}, 0, (text, size, w) => (measureKey(text, size, w) === titleKey.key ? tall : undefined));
  const ss = ink[nb.pages[0].id].filter((s) => s.tool === "text");
  const title = ss.find((s) => s.text === "생물 교재 정리")!;
  assert.equal(title.pts[4] - title.pts[1], tall);
  const meta = ss[1];
  assert.ok(meta.pts[1] >= title.pts[4], "제목 아래에 붙는 줄이 제목과 겹침");
  for (const p of nb.pages) assert.deepEqual(overlaps(ink[p.id]), []);
});

test("AI explanations: request only the entries that are on and have words, then attach the answers", () => {
  let d = buildDraft(sample());
  const [first, second] = d.sections[0].entries;
  d = patchEntry(d, second.id, { on: false });
  const req = explainRequest(d, {});
  assert.ok(req.some((r) => r.id === first.id && r.tag === "핵심" && r.text === "경쟁적 저해제" && r.sentence.includes("활성 부위")));
  assert.ok(!req.some((r) => r.id === second.id)); // 끈 항목
  assert.ok(!req.some((r) => d.sections[0].entries.find((e) => e.id === r.id)?.kind === "ink")); // 그림 항목
  const withEx = applyExplains(d, [{ id: first.id, explain: "기질과 경쟁해요." }]);
  assert.equal(withEx.sections[0].entries[0].explain?.explain, "기질과 경쟁해요.");
  assert.equal(withEx.sections[0].entries[2].explain, undefined);
});

test("AI explanations are drawn under the entry: text, a gridded table, a bar chart and step boxes, inside the page", () => {
  let d = buildDraft(sample());
  const ids = d.sections[0].entries.map((e) => e.id);
  d = applyExplains(d, [
    { id: ids[0], explain: "경쟁적 저해제는 기질 대신 활성 부위에 붙어요.", table: { title: "저해제 비교", columns: ["종류", "붙는 곳", "기질을 늘리면"], rows: [["경쟁적", "활성 부위", "저해가 줄어듦"], ["비경쟁적", "다른 부위", "그대로"]] } },
    { id: ids[1], explain: "", chart: { title: "반응 속도", labels: ["기질 적음", "기질 많음"], values: [2, 8], unit: "배" } },
    { id: ids[2], explain: "조절 과정", steps: { title: "", items: ["신호 분자 결합", "모양 바뀜", "활성 변화"] } },
  ]);
  const { nb, ink } = layoutNote(d, {});
  const all = Object.values(ink).flat();
  const texts = all.filter((s) => s.tool === "text").map((s) => s.text);
  for (const t of ["AI 설명", "경쟁적 저해제는 기질 대신 활성 부위에 붙어요.", "저해제 비교", "종류", "붙는 곳", "비경쟁적", "그대로", "반응 속도", "기질 많음", "8배", "2배", "신호 분자 결합", "활성 변화"]) {
    assert.ok(texts.includes(t), `없음: ${t}`);
  }
  // 막대 길이는 값에 비례
  const bars = all.filter((s) => s.tool === "highlighter" && s.color === "#C9A7FF" && s.width === 11);
  assert.equal(bars.length, 2);
  const len = (s: Stroke) => s.pts[3] - s.pts[0];
  assert.ok(Math.abs(len(bars[1]) / len(bars[0]) - 4) < 0.01);
  // 표의 칸 선, 순서 그림의 네모
  assert.ok(all.filter((s) => s.tool === "pen" && s.color === "#BDBDBD").length >= 4 + 3);
  // 순서 그림: 네모 3개(변 4개씩) + 화살표 2개(선 3개씩), 모두 두 점짜리 곧은 선
  const stepLines = all.filter((s) => s.tool === "pen" && s.color === "#9E9E9E");
  assert.equal(stepLines.length, 3 * 4 + 2 * 3);
  assert.ok(stepLines.every((s) => s.pts.length === 6));
  for (const p of nb.pages) {
    assert.deepEqual(overlaps(ink[p.id]), []);
    for (const s of ink[p.id]) for (let i = 0; i < s.pts.length; i += 3) assert.ok(s.pts[i] <= A4.w && s.pts[i + 1] <= A4.h, `쪽 밖: ${s.text ?? s.tool}`);
  }
  // 표 칸의 글은 칸 폭 안에서 잰다 (기기에서 잰 높이와 맞도록)
  const keys = boxesToMeasure(d, {}).map((b) => b.text);
  assert.ok(keys.includes("저해가 줄어듦") && keys.includes("신호 분자 결합"));
});

test("long or many steps are stacked downwards instead of across", () => {
  let d = buildDraft(sample());
  const id = d.sections[0].entries[0].id;
  d = applyExplains(d, [{ id, explain: "", steps: { title: "", items: ["하나", "둘", "셋", "넷", "다섯"] } }]);
  const { nb, ink } = layoutNote(d, {});
  const ss = ink[nb.pages[0].id];
  assert.equal(ss.filter((s) => s.tool === "pen" && s.color === "#9E9E9E").length, 5 * 4 + 4 * 3);
  const words = ss.filter((s) => s.tool === "text" && ["하나", "둘", "셋", "넷", "다섯"].includes(s.text!));
  assert.equal(words.length, 5);
  assert.ok(words.every((b) => b.pts[0] === words[0].pts[0])); // 모두 같은 왼쪽 → 세로로 쌓임
  assert.ok(words.every((b, i) => i === 0 || b.pts[1] > words[i - 1].pts[4]));
  assert.deepEqual(overlaps(ss), []);
});
