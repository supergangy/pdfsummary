import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraft, countOn, layoutNote, meaningOf, moveEntry, patchEntry, tagOf, usedHighlightColors, type MyNoteDraft } from "./myNote.ts";
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
