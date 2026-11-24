import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { buildPdf, needsKoreanFont } from "./exportPdf.ts";
import { blankNotebook } from "./model.ts";
import { PAPER_CHOICES, isPaper, paperHasText, paperMarks } from "./paperTemplates.ts";

const W = 595.28, H = 841.89;

test("속지·서식: 무지는 빈 목록, 나머지는 쪽 안에만 그린다", () => {
  assert.deepEqual(paperMarks("plain", W, H), []);
  assert.deepEqual(paperMarks(undefined, W, H), []);
  for (const { value } of PAPER_CHOICES) {
    for (const m of paperMarks(value, W, H)) {
      const pts = m.k === "line" ? [[m.x1, m.y1], [m.x2, m.y2]] : m.k === "rect" ? [[m.x, m.y], [m.x + m.w, m.y + m.h]] : [[m.x, m.y]];
      for (const [x, y] of pts) assert.ok(x >= 0 && x <= W + 0.01 && y >= 0 && y <= H + 0.01, `${value} 무늬가 쪽 밖: ${x},${y}`);
    }
  }
});

test("서식: 달력은 요일 7개와 7칸, 코넬 노트·오답 노트는 칸 이름", () => {
  const month = paperMarks("month", W, H);
  const days = month.filter((m) => m.k === "text" && m.center).map((m) => (m.k === "text" ? m.text : ""));
  assert.deepEqual(days, ["일", "월", "화", "수", "목", "금", "토"]);
  const texts = (p: Parameters<typeof paperMarks>[0]) => paperMarks(p, W, H).flatMap((m) => (m.k === "text" ? [m.text] : []));
  assert.ok(texts("cornell").includes("요약"));
  assert.ok(texts("wrong").includes("정답") && texts("wrong").includes("풀이"));
  assert.ok(texts("week").includes("메모"));
  // 할 일: 네모 칸이 여러 개
  assert.ok(paperMarks("todo", W, H).filter((m) => m.k === "rect").length >= 15);
  assert.equal(paperHasText("lined"), false);
  assert.equal(paperHasText("month"), true);
  assert.ok(isPaper("week") && !isPaper("calendar2"));
});

test("서식 노트를 PDF로: 글꼴이 필요하다고 알리고, 칸 이름 글까지 넣는다", async () => {
  const nb = blankNotebook("달력", "month", 2);
  assert.equal(needsKoreanFont(nb, {}), true);
  assert.equal(needsKoreanFont(blankNotebook("줄", "lined"), {}), false);
  const font = new Uint8Array(readFileSync(new URL("../../assets/fonts/NanumGothic-Regular.ttf", import.meta.url)));
  const pdf = await buildPdf(nb, {}, null, font);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 2);
  // 글꼴(2MB)이 통째로 들어갔다 = 칸 이름(요일)을 글로 썼다. 글꼴 없이 만들면 작다
  const plain = await buildPdf(nb, {}, null, null);
  assert.ok(pdf.length > 500_000 && plain.length < 50_000, `${pdf.length} / ${plain.length}`);
});
