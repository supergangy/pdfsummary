import { test } from "node:test";
import assert from "node:assert/strict";
import { charsIn, colorKeyOf, findBakedHighlights } from "./bakedHighlights.ts";
import type { PdfChar } from "./quick.ts";

/** 흰 종이 그림 (쪽 단위 1 = 1픽셀) */
function paper(w: number, h: number) {
  const px = new Uint8Array(w * h * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([...rgb, 255], (y * w + x) * 4);
  };
  /** 글자 대신 세로 획들 (검정) */
  const text = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0 + 2; x < x1 - 2; x += 7) fill(x, y0 + 3, x + 2, y1 - 3, [20, 20, 20]);
  };
  return { px, fill, text };
}
const YELLOW: [number, number, number] = [255, 236, 110];

test("쪽 그림의 형광펜: 글자 뒤를 칠한 노랑 띠만 (색 글씨·글자 없는 색 상자·가장자리 띠는 아님)", () => {
  const { px, fill, text } = paper(800, 600);
  fill(100, 100, 400, 118, YELLOW); // 칠한 줄
  text(100, 100, 400, 118);
  fill(100, 200, 400, 230, [140, 210, 250]); // 글자 없는 하늘색 상자 (책 장식)
  for (let x = 100; x < 400; x += 7) fill(x, 300, x + 2, 316, [40, 120, 230]); // 파란 색 글씨 (획만 색)
  fill(0, 560, 800, 600, YELLOW); // 쪽 아래 가장자리 띠
  text(0, 560, 800, 600);
  const ms = findBakedHighlights(px, 800, 600, 800, 600);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].color, "yellow");
  const [x0, y0, x1, y1] = ms[0].rect;
  assert.ok(Math.abs(x0 - 100) <= 4 && Math.abs(y0 - 100) <= 4 && Math.abs(x1 - 400) <= 4 && Math.abs(y1 - 118) <= 4, JSON.stringify(ms[0].rect));
});

test("쪽 그림의 형광펜: 다음 줄로 이어 칠한 것은 하나로, 펼친 두 쪽의 같은 높이는 따로", () => {
  const { px, fill, text } = paper(1600, 600);
  const band = (x0: number, y0: number, x1: number) => {
    fill(x0, y0, x1, y0 + 18, YELLOW);
    text(x0, y0, x1, y0 + 18);
  };
  band(100, 100, 700); // 왼쪽 쪽
  band(100, 128, 300); // 왼쪽 쪽 다음 줄 (이어 칠함, 줄 사이 10)
  band(900, 100, 1500); // 오른쪽 쪽 같은 높이
  const ms = findBakedHighlights(px, 1600, 600, 1600, 600);
  assert.equal(ms.length, 2);
  const left = ms.find((m) => m.rect[0] < 800)!, right = ms.find((m) => m.rect[0] >= 800)!;
  assert.equal(left.parts.length, 2);
  assert.equal(right.parts.length, 1);
});

test("색 이름: 노랑(연두빛 포함)·분홍·파랑·초록, 무채색은 없음", () => {
  assert.equal(colorKeyOf(1, 0.92, 0.2), "yellow");
  assert.equal(colorKeyOf(0.87, 1, 0.1), "yellow"); // 연두빛 노랑 형광펜
  assert.equal(colorKeyOf(1, 0.6, 0.8), "pink");
  assert.equal(colorKeyOf(0.5, 0.8, 1), "blue");
  assert.equal(colorKeyOf(0.5, 1, 0.5), "green");
  assert.equal(colorKeyOf(0.6, 0.6, 0.6), null);
});

test("칠한 상자 안의 글자", () => {
  const chars: PdfChar[] = [["가", 0, 0, 10, 10], [" ", 10, 0, 15, 10], ["나", 15, 0, 25, 10], ["다", 100, 0, 110, 10]];
  assert.deepEqual(charsIn(chars, [[0, 0, 30, 10]]), [0, 2]);
});
