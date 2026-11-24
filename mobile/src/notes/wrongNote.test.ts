import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stroke } from "./model.ts";
import type { PdfChar } from "./quick.ts";
import { isRed, isWrongSlash, layoutWrongNote, questionBlocks, questionNumber, wrongQuestions } from "./wrongNote.ts";

const pen = (pts: [number, number][], color = "#D7263D"): Stroke => ({ id: Math.random().toString(36), tool: "pen", color, width: 2, pts: pts.flatMap(([x, y]) => [x, y, 0.5]) });
const slash = (x: number, y: number, size = 30, color = "#D7263D") => pen([[x, y + size], [x + size / 2, y + size / 2], [x + size, y]], color);

/** 시험지 글자: 줄마다 (글, x, y), 글자 폭 7, 높이 10 */
function sheet(lines: [string, number, number][]): PdfChar[] {
  return lines.flatMap(([t, x, y]) => [...[...t].map((c, i) => [c, x + i * 7, y, x + (i + 1) * 7, y + 10] as PdfChar), ["\n", x + t.length * 7, y, x + t.length * 7, y + 10] as PdfChar]);
}

test("틀린 표시: 빨간 펜 사선만 (다른 색·가로줄·동그라미·짧은 점은 아님)", () => {
  assert.ok(isRed("#D7263D") && isRed("#FF0000") && !isRed("#E67E22") && !isRed("#EC4899") && !isRed("#1F2328") && !isRed("#8B5A2B"));
  assert.ok(isWrongSlash(slash(100, 100)));
  assert.ok(isWrongSlash(pen([[100, 100], [130, 135]])), "＼ 방향도");
  assert.ok(!isWrongSlash(slash(100, 100, 30, "#1E4FD8")), "파란 사선");
  assert.ok(!isWrongSlash(pen([[100, 100], [160, 103]])), "가로줄(밑줄)");
  assert.ok(!isWrongSlash(pen([[100, 100], [102, 160]])), "세로줄");
  assert.ok(!isWrongSlash(slash(100, 100, 6)), "점처럼 짧음");
  const loop: [number, number][] = [];
  for (let k = 0; k <= 20; k++) loop.push([120 + 20 * Math.cos((k / 20) * 6.28), 120 + 20 * Math.sin((k / 20) * 6.28)]);
  assert.ok(!isWrongSlash(pen(loop)), "동그라미");
  assert.ok(!isWrongSlash({ ...slash(100, 100), tool: "highlighter" }), "형광펜");
});

test("문제 번호: 줄 첫머리 '1.' '12)' '문 3.' '01.' (보기 ①·소수는 아님)", () => {
  assert.equal(questionNumber("1. 다음 중 옳은 것은?"), 1);
  assert.equal(questionNumber("12) 빈칸에"), 12);
  assert.equal(questionNumber("문 3. 운영체제"), 3);
  assert.equal(questionNumber("01. 첫 문제"), 1);
  assert.equal(questionNumber("① 보기"), null);
  assert.equal(questionNumber("1.5배 늘어난"), null);
  assert.equal(questionNumber("가. 설명"), null);
});

test("두 단 시험지: 사선이 그어진 문제의 칸만, 단마다 다음 번호 앞까지", () => {
  const chars = sheet([
    ["1. 첫째 문제", 40, 60], ["① 가", 50, 80], ["② 나", 50, 95],
    ["2. 둘째 문제", 40, 200], ["① 다", 50, 220],
    ["3. 셋째 문제", 320, 60], ["① 라", 330, 80],
    ["4. 넷째 문제", 320, 300], ["① 마", 330, 320], ["② 바", 330, 340],
  ]);
  const blocks = questionBlocks(chars, 595, 842);
  assert.deepEqual(blocks.map((b) => b.num), [1, 2, 3, 4]);
  // 1번: 왼쪽 단, 2번 앞까지 / 4번: 오른쪽 단 끝 글까지
  assert.deepEqual(blocks[0].box, [37, 54, 99, 196]); // 그 단의 글이 있는 곳까지만 (두 단 사이 세로줄은 안 들어가게)
  assert.equal(blocks[3].box[0] >= 297, true);
  assert.equal(blocks[3].box[3], 358);
  // 2번 문제 번호 위에 사선, 4번 보기 위에 사선 두 개(같은 문제) → 2번·4번
  const ink = [slash(42, 195, 20), slash(335, 315), slash(340, 330, 15)];
  assert.deepEqual(wrongQuestions(ink, chars, 595, 842).map((q) => q.num), [2, 4]);
  // 파란 사선·빨간 밑줄은 안 센다
  assert.deepEqual(wrongQuestions([slash(42, 195, 20, "#1E4FD8"), pen([[40, 72], [120, 73]])], chars, 595, 842), []);
});

test("문제 번호를 못 찾으면 사선 둘레를 넉넉히 자른다", () => {
  const [q] = wrongQuestions([slash(200, 300)], null, 595, 842);
  assert.equal(q.num, null);
  assert.ok(q.box[0] < 200 && q.box[1] < 300 && q.box[2] > 230 && q.box[3] > 330);
});

test("오답 노트: 문제마다 한 쪽, 칸에 들어가면 '오답 노트' 서식 문제 칸에 + 어디서 왔는지·날짜, 긴 문제는 빈 쪽에 크게", () => {
  const img = "data:image/jpeg;base64,AAAA";
  const { nb, ink } = layoutWrongNote("오답 노트", [
    { source: "컴퓨터일반", page: 3, num: 7, img, w: 500, h: 180 },
    { source: "컴퓨터일반", page: 5, num: null, img, w: 300, h: 900 },
  ], new Date(2026, 10, 25).getTime());
  assert.equal(nb.pages.length, 2);
  assert.equal(nb.pages[0].paper, "wrong");
  assert.equal(nb.pages[1].paper, "plain");
  const [a, b] = nb.pages.map((p) => ink[p.id]);
  const pic = a.find((s) => s.tool === "image")!;
  assert.ok(pic.pts[0] >= 44 && pic.pts[3] <= 551.5 && pic.pts[1] >= 108 && pic.pts[4] <= 334, "문제 칸 안");
  assert.ok(a.some((s) => s.text === "7번 · 3쪽 · 컴퓨터일반") && a.some((s) => s.text === "2026.11.25"));
  assert.ok(b.some((s) => s.text === "5쪽 · 컴퓨터일반 · 2026.11.25"));
  const tall = b.find((s) => s.tool === "image")!;
  assert.ok(tall.pts[4] - tall.pts[1] > 400, "긴 문제는 크게");
});

test("오답 노트: 긴 노트 이름은 줄여 과목 줄 한 줄에 (번호·쪽이 앞에)", () => {
  const { nb, ink } = layoutWrongNote("오답", [{ source: "2025_9급_국가직_컴퓨터일반(나)_2025년_04월_05일", page: 1, num: 6, img: "x", w: 500, h: 200 }], 0);
  assert.ok(ink[nb.pages[0].id].some((s) => s.text === "6번 · 1쪽 · 2025_9급_국가직_컴퓨터…"));
});
