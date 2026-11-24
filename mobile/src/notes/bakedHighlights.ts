// 쪽 그림에 굳어 있는 형광펜 찾기 (다른 필기 앱에서 칠한 뒤 PDF로 내보낸 책, 스캔본 등).
// 형광펜은 밝고 채도가 높은 색으로 '글자 뒤 바탕'을 칠한다 → 그런 색 덩어리 중 글줄 모양인 것만 고른다.
// 파이썬 요약 프로그램의 pdfsummary/scan.py와 같은 방법 (계산만 — 쪽 그림을 얻는 일은 findBaked.ts)
import type { Box } from "./geometry.ts";
import type { PdfChar } from "./quick.ts";

export type ColorKey = "yellow" | "orange" | "red" | "pink" | "purple" | "blue" | "green";

/** 색 이름과 요약에 칠할 색 */
export const COLOR_INFO: Record<ColorKey, { name: string; hex: string }> = {
  yellow: { name: "노랑", hex: "#FFE14D" },
  orange: { name: "주황", hex: "#FFB86B" },
  red: { name: "빨강", hex: "#FF7B7B" },
  pink: { name: "분홍", hex: "#FF9EC7" },
  purple: { name: "보라", hex: "#C9A7FF" },
  blue: { name: "파랑", hex: "#7FD3FF" },
  green: { name: "초록", hex: "#8FE38F" },
};

/** RGB(0~1) → 색 이름 (scan.py의 color_key와 같은 기준, 무채색은 null) */
export function colorKeyOf(r: number, g: number, b: number): ColorKey | null {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d < 1e-6 ? 0 : l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  if (s < 0.18 || l < 0.12) return null;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const deg = (h * 60 + 360) % 360;
  if (deg < 15 || deg >= 345) return l > 0.7 ? "pink" : "red";
  if (deg < 40) return "orange";
  if (deg < 80) return "yellow"; // 연두빛 노랑 형광펜도 노랑으로 (파이썬은 70)
  if (deg < 165) return "green";
  if (deg < 255) return "blue";
  if (deg < 290) return "purple";
  return "pink";
}

export type BakedMark = { rect: Box; parts: Box[]; color: ColorKey };

const CELL_PT = 2.9; // 칸 하나의 크기 (쪽 단위). 파이썬은 100dpi에서 4픽셀

/**
 * 쪽 그림(RGBA, w×h 픽셀)에서 형광펜 칠한 곳. pageW·pageH: 쪽 크기(쪽 단위) — 결과 상자는 쪽 단위.
 * 가로로 긴 쪽(책 두 쪽을 펼쳐 한 장에 담은 것)은 왼쪽·오른쪽 쪽을 따로 잇는다.
 */
export function findBakedHighlights(rgba: Uint8Array, w: number, h: number, pageW: number, pageH: number): BakedMark[] {
  const zoom = w / pageW; // 픽셀 / 쪽 단위
  const cell = Math.max(2, Math.round(CELL_PT * zoom));
  const n = w * h;
  const mask = new Uint8Array(n);
  const lum = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = L;
    if (mx > 0 && (mx - mn) / mx > 0.18 && L > 0.6) mask[i] = 1;
  }
  const gw = Math.floor(w / cell), gh = Math.floor(h / cell);
  if (!gw || !gh) return [];
  const cells = new Uint8Array(gw * gh);
  const need = 0.3 * cell * cell;
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let c = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        const row = y * w + cx * cell;
        for (let x = 0; x < cell; x++) c += mask[row + x];
      }
      if (c > need) cells[cy * gw + cx] = 1;
    }
  }
  // 글자 획 때문에 생긴 구멍·틈을 메운다 (가로 2칸, 세로 1칸)
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!cells[y * gw + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < gw) grown[yy * gw + xx] = 1;
        }
      }
    }
  }
  /** 칸 상자 하나를 형광펜인지 보고, 그렇다면 표시로 */
  const judge = (x0: number, y0: number, x1: number, y1: number): BakedMark | null => {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    let fillC = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fillC += grown[y * gw + x];
    // 글자 줄 모양의 띠만 (너무 작거나 덜 찬 덩어리는 뺀다)
    if (bh < 2 || bw < 5 || fillC / (bw * bh) < 0.45) return null;
    const px0 = x0 * cell, py0 = y0 * cell, px1 = (x1 + 1) * cell, py1 = (y1 + 1) * cell;
    const c = looksLikeHighlighter(rgba, mask, lum, w, h, px0, py0, px1, py1, zoom);
    if (!c) return null;
    const r: Box = [px0 / zoom, py0 / zoom, px1 / zoom, py1 / zoom];
    return { rect: r, parts: [[...r] as Box], color: c };
  };
  const seen = new Uint8Array(gw * gh);
  const stack: number[] = [];
  const marks: BakedMark[] = [];
  for (let start = 0; start < gw * gh; start++) {
    if (!grown[start] || seen[start]) continue;
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw, y = (k - x) / gw;
      // 덩어리 상자는 메우기 전 칸으로 (메운 만큼 다시 줄인다)
      if (cells[k]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x > 0 && grown[k - 1] && !seen[k - 1]) (seen[k - 1] = 1), stack.push(k - 1);
      if (x < gw - 1 && grown[k + 1] && !seen[k + 1]) (seen[k + 1] = 1), stack.push(k + 1);
      if (y > 0 && grown[k - gw] && !seen[k - gw]) (seen[k - gw] = 1), stack.push(k - gw);
      if (y < gh - 1 && grown[k + gw] && !seen[k + gw]) (seen[k + gw] = 1), stack.push(k + gw);
    }
    if (x1 < 0) continue;
    // 줄 사이가 좁으면 메운 칸 때문에 위아래 두 줄이 한 덩어리가 된다 → 칠한 칸이 없는 줄에서 나눠 줄마다 본다
    // (한 덩어리로 보면 두 줄 사이 빈 곳 때문에 덜 찼다고 둘 다 버려졌다)
    let ry = y0;
    while (ry <= y1) {
      while (ry <= y1 && !rowHas(cells, gw, ry, x0, x1)) ry++;
      if (ry > y1) break;
      let ry1 = ry;
      while (ry1 + 1 <= y1 && rowHas(cells, gw, ry1 + 1, x0, x1)) ry1++;
      let bx0 = x1, bx1 = x0;
      for (let y = ry; y <= ry1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (cells[y * gw + x]) {
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
          }
        }
      }
      const m = judge(bx0, ry, bx1, ry1);
      if (m) marks.push(m);
      ry = ry1 + 1;
    }
  }
  return mergeLines(marks, pageW > pageH * 1.15 ? pageW / 2 : null);
}

function rowHas(cells: Uint8Array, gw: number, y: number, x0: number, x1: number): boolean {
  for (let x = x0; x <= x1; x++) if (cells[y * gw + x]) return true;
  return false;
}

/** 색 덩어리가 '형광펜'인지 (책에 인쇄된 색 글씨·머리 띠·뱃지가 아닌지). 형광펜이면 그 색 이름 */
function looksLikeHighlighter(rgba: Uint8Array, mask: Uint8Array, lum: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, zoom: number): ColorKey | null {
  const edge = 0.015;
  if (x0 <= w * edge || y0 <= h * edge || x1 >= w * (1 - edge) || y1 >= h * (1 - edge)) return null; // 쪽 가장자리 장식
  if ((y1 - y0) / zoom > 50) return null; // 한 번 그은 형광펜은 한두 줄 높이
  let on = 0, all = 0, r = 0, g = 0, b = 0;
  const tint: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      all++;
      if (mask[i]) {
        on++;
        r += rgba[i * 4];
        g += rgba[i * 4 + 1];
        b += rgba[i * 4 + 2];
        if ((on & 3) === 0) tint.push(lum[i]); // 중간값용 (넷 중 하나만)
      }
    }
  }
  if (!all || on / all < 0.5) return null; // 형광펜은 상자 대부분이 색 (색 글씨는 획만 색)
  tint.sort((a, c) => a - c);
  const tl = tint.length ? tint[tint.length >> 1] : 1;
  let dark = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lum[y * w + x] < tl * 0.65) dark++;
  // 밑에 글자가 있어야 형광펜. 파이썬(100dpi)은 3%인데 기기는 더 작게 그려 글자가 흐려지므로 2%
  if (dark / all < 0.02) return null;
  // 종이 위 형광펜은 연하게 찍히므로 채도를 올려서 색 이름을 고른다
  const R = r / on / 255, G = g / on / 255, B = b / on / 255;
  const mn = Math.min(R, G, B), mx = Math.max(R, G, B);
  if (mx - mn < 1e-3) return null;
  const s = (c: number) => ((c - mn) / (mx - mn)) * 0.9 + 0.1;
  return colorKeyOf(s(R), s(G), s(B));
}

/** 같은 색으로 이어 칠한 여러 줄을 한 덩어리로 — 같은 단의 바로 윗줄에만 (펼친 두 쪽에서 왼쪽·오른쪽이 섞이지 않게) */
export function mergeLines(marks: BakedMark[], spreadMid: number | null): BakedMark[] {
  marks.sort((a, c) => a.rect[1] - c.rect[1] || a.rect[0] - c.rect[0]);
  const sameCol = (a: Box, c: Box) => {
    if (Math.min(a[2], c[2]) > Math.max(a[0], c[0])) return true;
    if (spreadMid === null) return true;
    return (a[0] + a[2]) / 2 < spreadMid === (c[0] + c[2]) / 2 < spreadMid;
  };
  const out: BakedMark[] = [];
  for (const m of marks) {
    let joined = false;
    for (let k = out.length - 1; k >= Math.max(0, out.length - 8); k--) {
      const p = out[k];
      const last = p.parts[p.parts.length - 1];
      const lh = last[3] - last[1];
      const gap = m.rect[1] - last[3];
      if (p.color === m.color && gap >= 0 && gap <= Math.max(8, 0.8 * lh) && sameCol(last, m.rect)) {
        p.rect = [Math.min(p.rect[0], m.rect[0]), p.rect[1], Math.max(p.rect[2], m.rect[2]), m.rect[3]];
        p.parts.push(...m.parts);
        joined = true;
        break;
      }
    }
    if (!joined) out.push(m);
  }
  return out;
}

/** 칠한 상자들 안의 글자 번호 (글자 가운데가 상자 안) */
export function charsIn(chars: PdfChar[], parts: Box[]): number[] {
  const out: number[] = [];
  chars.forEach(([c, x0, y0, x1, y1], i) => {
    if (!c.trim()) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (parts.some((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3])) out.push(i);
  });
  return out;
}

export type FoundColor = { key: ColorKey; count: number; pages: number; printed: boolean };

/** 찾은 색과 개수. 살펴본 쪽의 절반 넘게 나오는 색은 책에 인쇄된 색(머리 띠·그림 번호 상자 등)일 가능성이 높아
 *  printed로 표시하고 뒤로 보낸다 — 기본으로 고르는 색은 맨 앞(사람이 칠한 것 같은 색 중 가장 많은 것) */
export function foundColors(pages: Map<number, BakedMark[]>, scanned: number): FoundColor[] {
  const by = new Map<ColorKey, { count: number; pages: Set<number> }>();
  for (const [i, ms] of pages) {
    for (const m of ms) {
      const e = by.get(m.color) ?? { count: 0, pages: new Set<number>() };
      e.count++;
      e.pages.add(i);
      by.set(m.color, e);
    }
  }
  return [...by]
    .map(([key, e]) => ({ key, count: e.count, pages: e.pages.size, printed: scanned >= 6 && e.pages.size / scanned > 0.5 }))
    .sort((a, b) => Number(a.printed) - Number(b.printed) || b.count - a.count);
}
