// 오답 노트 모으기: 문제지 노트에서 빨간 펜 사선(／)을 그은 문제만 찾아, 문제 칸을 잘라 '오답 노트' 서식 쪽에 하나씩 담는다.
//  - 틀린 표시: 빨간 펜으로 그은 거의 곧은 사선 하나 (가로·세로줄, 동그라미, 다른 색은 아님)
//  - 문제 칸: 쪽 글자에서 줄 첫머리의 문제 번호('1.', '12)', '문 3.')를 찾아, 그 번호부터 같은 단의 다음 번호 앞까지.
//    두 단 시험지는 쪽 가운데로 단을 나눈다. 번호를 못 찾으면 사선 둘레를 넉넉히 자른다.
// 여기는 계산만 (쪽 그림 자르기·저장은 makeWrongNote.ts)
import { bounds, type Box } from "./geometry.ts";
import { A4, blankNotebook, makeImage, makeTextBox, newId, type Ink, type Notebook, type Stroke } from "./model.ts";
import type { PdfChar } from "./quick.ts";

/** 빨간색인지 (빨강 펜 #D7263D 등. 주황·분홍·갈색은 아님) */
export function isRed(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return r >= 150 && g <= 110 && b <= 120 && r - Math.max(g, b) >= 70;
}

/** 틀린 표시(빨간 사선)인지: 빨간 펜, 거의 곧고, 기울기 20~70도, 짧지 않음 */
export function isWrongSlash(s: Stroke): boolean {
  if (s.tool !== "pen" || !isRed(s.color) || s.pts.length < 6) return false;
  const p = s.pts, n = p.length;
  const x0 = p[0], y0 = p[1], x1 = p[n - 3], y1 = p[n - 2];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 14) return false;
  let path = 0, dev = 0;
  for (let i = 3; i < n; i += 3) {
    path += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
    dev = Math.max(dev, Math.abs((p[i] - x0) * dy - (p[i + 1] - y0) * dx) / len);
  }
  if (path > len * 1.25 || dev > Math.max(4, len * 0.12)) return false;
  const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  return ang >= 20 && ang <= 70;
}

export type Question = { num: number | null; box: Box };

type Line = { text: string; x0: number; y0: number; x1: number; y1: number };

/** 글자 상자 → 줄 ("\n"으로 나뉜다) */
function linesOf(chars: PdfChar[]): Line[] {
  const out: Line[] = [];
  let cur: PdfChar[] = [];
  const flush = () => {
    const solid = cur.filter((c) => c[0].trim());
    if (solid.length) {
      out.push({
        text: cur.map((c) => c[0]).join("").trim(),
        x0: Math.min(...solid.map((c) => c[1])),
        y0: Math.min(...solid.map((c) => c[2])),
        x1: Math.max(...solid.map((c) => c[3])),
        y1: Math.max(...solid.map((c) => c[4])),
      });
    }
    cur = [];
  };
  for (const c of chars) {
    if (c[0] === "\n") flush();
    else cur.push(c);
  }
  flush();
  return out;
}

/** 줄 첫머리의 문제 번호 ('1.', '12)', '01.', '문 3.', '문제 4)'). 보기 ①②, '1.5' 같은 소수는 아님 */
export function questionNumber(text: string): number | null {
  const m = /^(?:문(?:제)?\s*)?0?(\d{1,3})\s*[.)．](?!\d)/.exec(text);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 200 ? n : null;
}

/** 쪽의 문제 칸들 (쪽 좌표). 두 단이면 단마다 */
export function questionBlocks(chars: PdfChar[] | null, pageW: number, pageH: number): Question[] {
  if (!chars?.length) return [];
  const lines = linesOf(chars);
  const heads = lines.map((l) => ({ l, num: questionNumber(l.text) })).filter((h) => h.num !== null);
  if (!heads.length) return [];
  const mid = pageW / 2;
  const twoCols = heads.some((h) => h.l.x0 > pageW * 0.42) && heads.some((h) => h.l.x0 < pageW * 0.3);
  const colOf = (x: number) => (twoCols && x >= mid - 4 ? 1 : 0);
  const out: Question[] = [];
  for (const col of twoCols ? [0, 1] : [0]) {
    const inCol = lines.filter((l) => colOf(l.x0) === col);
    const hs = heads.filter((h) => colOf(h.l.x0) === col).sort((a, b) => a.l.y0 - b.l.y0);
    if (!hs.length || !inCol.length) continue;
    const left = Math.max(0, Math.min(...inCol.map((l) => l.x0)) - 8);
    const right = twoCols && col === 0 ? mid - 2 : Math.min(pageW, Math.max(...inCol.map((l) => l.x1)) + 8);
    hs.forEach((h, i) => {
      const top = Math.max(0, h.l.y0 - 6);
      const next = hs[i + 1];
      let bottom: number;
      if (next) bottom = next.l.y0 - 4;
      else {
        const below = inCol.filter((l) => l.y0 >= h.l.y0);
        bottom = Math.min(pageH, Math.max(...below.map((l) => l.y1)) + 8);
      }
      if (bottom - top > 8) out.push({ num: h.num, box: [left, top, right, bottom] });
    });
  }
  return out;
}

/** 이 쪽에서 틀린 문제들 (같은 문제에 사선이 여럿이면 하나). 번호를 못 찾은 사선은 둘레를 넉넉히 */
export function wrongQuestions(strokes: Stroke[], chars: PdfChar[] | null, pageW: number, pageH: number): Question[] {
  const slashes = strokes.filter(isWrongSlash);
  if (!slashes.length) return [];
  const blocks = questionBlocks(chars, pageW, pageH);
  const out: Question[] = [];
  for (const s of slashes) {
    const b = bounds(s);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const inside = (q: Question) => cx >= q.box[0] && cx <= q.box[2] && cy >= q.box[1] && cy <= q.box[3];
    // 그 자리가 든 칸, 없으면 같은 단에서 바로 위에서 시작한 칸
    let hit = blocks.find(inside);
    if (!hit) {
      const above = blocks.filter((q) => cx >= q.box[0] && cx <= q.box[2] && q.box[1] <= cy).sort((a, c) => c.box[1] - a.box[1]);
      hit = above[0];
    }
    const q: Question = hit ?? {
      num: null,
      box: [Math.max(0, b[0] - 120), Math.max(0, b[1] - 40), Math.min(pageW, b[2] + 220), Math.min(pageH, b[3] + 140)],
    };
    if (!out.some((o) => o.box.every((v, i) => Math.abs(v - q.box[i]) < 0.5))) out.push(q);
  }
  return out.sort((a, c) => a.box[1] - c.box[1] || a.box[0] - c.box[0]);
}

/** 잘라 낸 문제 하나 (그림 + 어디서 왔는지) */
export type WrongItem = { source: string; page: number; num: number | null; img: string; w: number; h: number };

// '오답 노트' 서식의 문제 칸 (paperTemplates.ts의 wrong과 같은 자리): x 36~559, y 84~334, 칸 이름 줄 아래부터
const BOX = { x: 44, y: 108, w: A4.w - 88, h: 334 - 108 - 6 };

/** 오답 노트 만들기: 문제마다 한 쪽. 문제가 칸에 들어가면 '오답 노트' 서식 문제 칸에, 너무 길면 빈 쪽 위쪽에 크게 */
export function layoutWrongNote(title: string, items: WrongItem[], now: number): { nb: Notebook; ink: Ink } {
  const nb = blankNotebook(title, "wrong", 0);
  const ink: Ink = {};
  const date = new Date(now);
  const day = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  for (const it of items) {
    const fit = Math.min(BOX.w / it.w, BOX.h / it.h);
    const fits = fit >= 0.6;
    const page = { id: newId(), w: A4.w, h: A4.h, paper: fits ? ("wrong" as const) : ("plain" as const) };
    nb.pages.push(page);
    const where = `${it.source} · ${it.page}쪽${it.num !== null ? ` · ${it.num}번` : ""}`;
    const strokes: Stroke[] = [];
    if (fits) {
      const k = Math.min(fit, 1.6);
      const w = it.w * k, h = it.h * k;
      strokes.push(makeImage(newId(), BOX.x + (BOX.w - w) / 2, BOX.y, w, h, it.img));
      strokes.push(makeTextBox(newId(), 74, 46, where, 11, "#5C6670", A4.w / 2 + 6)); // "과목" 칸 (오른쪽 끝 = 쪽 가운데 - 12)
      strokes.push(makeTextBox(newId(), A4.w / 2 + 38, 46, day, 11, "#5C6670", A4.w));
    } else {
      // 긴 문제: 폭에 맞춰 위쪽에 (아래는 풀이를 쓸 자리)
      const k = Math.min((A4.w - 72) / it.w, (A4.h * 0.62) / it.h);
      const w = it.w * k, h = it.h * k;
      strokes.push(makeTextBox(newId(), 36, 28, `${where} · ${day}`, 11, "#5C6670", A4.w));
      strokes.push(makeImage(newId(), (A4.w - w) / 2, 56, w, h, it.img));
    }
    ink[page.id] = strokes;
  }
  return { nb, ink };
}
