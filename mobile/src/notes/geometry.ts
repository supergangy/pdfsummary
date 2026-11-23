// 획 계산: 매끄러운 윤곽(필압), 경계 상자, 지우개 맞히기, 점 줄이기. 화면과 분리해 Node로 시험한다.
import { getStroke } from "perfect-freehand";
import { HIGHLIGHT_OPACITY, type Stroke } from "./model.ts";

export type Box = [number, number, number, number]; // x0, y0, x1, y1

/** 펜 획의 윤곽(채워 그릴 다각형). 펜 종류마다 굵기 변화가 다르다. */
export function penOutline(s: Stroke, last = true): number[][] {
  const pts: number[][] = [];
  let hasPressure = false;
  for (let i = 0; i < s.pts.length; i += 3) {
    const p = s.pts[i + 2];
    if (p > 0 && p !== 0.5) hasPressure = true;
    pts.push([s.pts[i], s.pts[i + 1], p > 0 ? p : 0.5]);
  }
  if (s.brush === "calligraphy") return nibOutline(pts, s.width, hasPressure);
  const base = { smoothing: 0.5, streamline: 0.2, last }; // streamline이 크면 글씨가 뭉개진다 (한글 획은 짧고 꺾임이 많음)
  switch (s.brush) {
    case "ballpoint":
      return getStroke(pts, { ...base, size: s.width * 1.4, thinning: hasPressure ? 0.12 : 0, simulatePressure: false });
    case "pencil":
      return getStroke(pts, { ...base, size: s.width * 1.1, thinning: hasPressure ? 0.3 : 0.1, simulatePressure: !hasPressure });
    case "brush": {
      // 끝을 가늘게 빼는 길이(taper)는 획 길이에 맞춘다. taper가 조금이라도 있으면 둥근 끝이 안 그려져서
      // 점·아주 짧은 획(ㅏ의 곁줄, 마침표)은 윤곽 넓이가 0이 된다 → 그런 획은 taper 없이 둥근 점·짧은 막대로.
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      // 짧은 획 = 붓 크기(굵기×2.4)의 1.5배보다 짧은 것. 가는 붓(굵기 2 이하)은 8pt까지도 taper가 있으면 안 보여서 같이 넣는다
      const short = len < Math.max(s.width * 3.6, 8);
      return getStroke(pts, {
        ...base,
        size: s.width * 2.4,
        thinning: hasPressure ? 0.85 : 0.6,
        smoothing: 0.6,
        simulatePressure: !hasPressure,
        start: { taper: short ? 0 : Math.min(s.width * 5, len * 0.25) },
        end: { taper: short ? 0 : Math.min(s.width * 7, len * 0.35) },
      });
    }
    default: // 만년필 (예전 노트도 이것)
      return getStroke(pts, { ...base, size: s.width * 1.6, thinning: hasPressure ? 0.55 : 0.2, simulatePressure: !hasPressure });
  }
}

/** 붓펜: 45° 기운 납작한 펜촉. 펜촉 방향으로 양쪽에 벌린 두 줄을 이어 윤곽을 만든다
 *  → 펜촉과 나란히 그으면 가늘고, 가로질러 그으면 굵다. */
function nibOutline(pts: number[][], width: number, hasPressure: boolean): number[][] {
  if (!pts.length) return [];
  const nx = Math.SQRT1_2, ny = -Math.SQRT1_2; // 오른쪽 위를 향한 펜촉
  const left: number[][] = [], right: number[][] = [];
  for (const [x, y, p] of pts) {
    const h = width * 1.1 * (hasPressure ? 0.55 + 0.9 * p : 1);
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
  }
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return [left[0], [x + 0.6, y + 0.6], right[0], [x - 0.6, y - 0.6]];
  }
  return [...left, ...right.reverse()];
}

/** 획을 어떻게 그릴지 — 화면(Skia)·PDF 내보내기·요약 그림이 모두 이것을 따른다.
 *  fill: 윤곽을 채움 / line: 가운데 선을 굵기 width로 그음 (형광펜, 파선·점선 펜) */
export type StrokeDraw =
  | { kind: "fill"; d: string; alpha: number }
  | { kind: "line"; d: string; width: number; alpha: number; cap: "butt" | "round"; dash?: [number, number]; multiply: boolean };

export function strokeDraw(s: Stroke): StrokeDraw | null {
  if (s.tool === "text") return null; // 글상자는 글자로 따로 그린다
  if (s.tool === "highlighter") {
    return { kind: "line", d: polylineSvg(s), width: s.width, alpha: s.opacity ?? HIGHLIGHT_OPACITY, cap: "butt", multiply: true };
  }
  const alpha = s.brush === "pencil" ? 0.78 : 1;
  if (s.dash === "dash" || s.dash === "dot") {
    const w = s.width * 1.2;
    return { kind: "line", d: polylineSvg(s), width: w, alpha, cap: "round", dash: s.dash === "dash" ? [w * 3, w * 2.6] : [0.01, w * 2.2], multiply: false };
  }
  return { kind: "fill", d: outlineToSvg(penOutline(s)), alpha };
}

const avg = (a: number, b: number) => (a + b) / 2;

/** 윤곽 다각형 → SVG 경로 (perfect-freehand 설명서의 방법: 중점을 잇는 2차 곡선). */
export function outlineToSvg(points: number[][], closed = true): string {
  const n = points.length;
  if (n < 4) {
    if (!n) return "";
    // 아주 짧은 획(점): 작은 원 대신 다각형 그대로
    return "M" + points.map((p) => `${r(p[0])},${r(p[1])}`).join("L") + "Z";
  }
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${r(a[0])},${r(a[1])} Q${r(b[0])},${r(b[1])} ${r(avg(b[0], c[0]))},${r(avg(b[1], c[1]))} T`;
  for (let i = 2, max = n - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${r(avg(a[0], b[0]))},${r(avg(a[1], b[1]))} `;
  }
  if (closed) d += "Z";
  return d;
}

/** 형광펜 획: 굵기가 일정한 선 (끝은 각지게 그린다). */
export function polylineSvg(s: Stroke): string {
  const p = s.pts;
  if (p.length < 3) return "";
  let d = `M${r(p[0])},${r(p[1])}`;
  if (p.length === 3) return d + `L${r(p[0] + 0.01)},${r(p[1])}`;
  for (let i = 3; i < p.length; i += 3) d += `L${r(p[i])},${r(p[i + 1])}`;
  return d;
}

export function strokeSvg(s: Stroke): string {
  return strokeDraw(s)?.d ?? "";
}

const r = (v: number) => Math.round(v * 100) / 100;

export function bounds(s: Stroke): Box {
  if (s.tool === "text") return [s.pts[0], s.pts[1], s.pts[3], s.pts[4]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const h = s.width / 2;
  return [x0 - h, y0 - h, x1 + h, y1 + h];
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** (x, y)를 반지름 radius인 지우개로 문질렀을 때 이 획에 닿는지. */
export function hits(s: Stroke, x: number, y: number, radius: number): boolean {
  if (s.tool === "text") {
    const [x0, y0, x1, y1] = [s.pts[0], s.pts[1], s.pts[3], s.pts[4]];
    return x >= x0 - radius && x <= x1 + radius && y >= y0 - radius && y <= y1 + radius;
  }
  const reach = radius + s.width / 2;
  const b = bounds(s);
  if (x < b[0] - radius || x > b[2] + radius || y < b[1] - radius || y > b[3] + radius) return false;
  const p = s.pts;
  if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= reach * reach;
  for (let i = 3; i < p.length; i += 3) {
    if (segDist2(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach * reach) return true;
  }
  return false;
}

/** 지우개가 (x0,y0)→(x1,y1)로 지나갈 때 닿는 획들 (빠르게 움직여도 사이를 놓치지 않게 나눠서 본다). */
export function hitAlong(strokes: Stroke[], x0: number, y0: number, x1: number, y1: number, radius: number): Stroke[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, radius / 2)));
  const out: Stroke[] = [];
  for (const s of strokes) {
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (hits(s, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius)) {
        out.push(s);
        break;
      }
    }
  }
  return out;
}

/** 너무 촘촘한 점을 줄인다 (저장 크기·그리기 속도). 첫 점과 끝 점은 남긴다. */
export function thin(pts: number[], minDist: number): number[] {
  if (pts.length <= 6) return pts.slice();
  const out = [pts[0], pts[1], pts[2]];
  let lx = pts[0], ly = pts[1];
  for (let i = 3; i < pts.length - 3; i += 3) {
    if (Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= minDist) {
      out.push(pts[i], pts[i + 1], pts[i + 2]);
      lx = pts[i];
      ly = pts[i + 1];
    }
  }
  const n = pts.length;
  out.push(pts[n - 3], pts[n - 2], pts[n - 1]);
  return out;
}

/** 형광펜을 '곧게'(삼성노트·굿노트의 직선 형광펜처럼): 거의 가로로 그었으면 시작~끝을 수평선으로.
 *  긋는 동안 화면(UI 스레드)에서도 같은 규칙으로 미리 보여 주므로 worklet. */
export function straighten(pts: number[]): number[] {
  "worklet";
  const n = pts.length;
  if (n < 6) return pts.slice();
  const x0 = pts[0], y0 = pts[1], x1 = pts[n - 3], y1 = pts[n - 2];
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx) * 0.25) return pts.slice();
  let sum = 0, k = 0;
  for (let i = 0; i < n; i += 3) {
    sum += pts[i + 1];
    k++;
  }
  const y = sum / k;
  return [x0, y, pts[2], x1, y, pts[n - 1]];
}

/** 화면 좌표 ↔ 쪽 좌표. view = { scale, tx, ty } (쪽 좌표 × scale + t = 화면 좌표). */
export type View = { scale: number; tx: number; ty: number };

export function toPage(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.tx) / v.scale, (sy - v.ty) / v.scale];
}

/** 확대·이동 범위 제한: 쪽이 화면보다 작으면 가운데, 크면 가장자리가 화면 안으로 들어오지 않게. */
export function clampView(v: View, pageW: number, pageH: number, viewW: number, viewH: number, minScale: number, maxScale: number): View {
  const scale = Math.max(minScale, Math.min(maxScale, v.scale));
  const w = pageW * scale, h = pageH * scale;
  const tx = w <= viewW ? (viewW - w) / 2 : Math.min(0, Math.max(viewW - w, v.tx));
  const ty = h <= viewH ? (viewH - h) / 2 : Math.min(0, Math.max(viewH - h, v.ty));
  return { scale, tx, ty };
}

/** 쪽이 화면 폭에 꽉 차는 보기. */
export function fitWidth(pageW: number, pageH: number, viewW: number, viewH: number, margin = 12): View {
  const scale = Math.min((viewW - margin * 2) / pageW, 4);
  return clampView({ scale, tx: margin, ty: margin }, pageW, pageH, viewW, viewH, scale * 0.5, scale * 6);
}


// ── 영역 지우개: 문지른 자리만 지우고 획을 나눈다 ───────────────────────────

/** 점 사이를 step 간격 이하로 촘촘하게 (긴 직선 형광펜의 가운데를 지울 수 있게) */
function densify(pts: number[], step: number): number[] {
  if (pts.length <= 3) return pts.slice();
  const out = [pts[0], pts[1], pts[2]];
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3], ay = pts[i - 2], ap = pts[i - 1], bx = pts[i], by = pts[i + 1], bp = pts[i + 2];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t);
    }
  }
  return out;
}

/** 지우개가 (x0,y0)→(x1,y1)로 지나간 자리(반지름 r)를 획에서 지운다.
 *  안 닿았으면 null, 닿았으면 남은 조각들(없으면 [] = 통째로 지워짐). 조각은 makeId로 새 id를 받는다. */
export function eraseFrom(s: Stroke, x0: number, y0: number, x1: number, y1: number, r: number, makeId: () => string): Stroke[] | null {
  if (s.tool === "text") return hitAlong([s], x0, y0, x1, y1, r).length ? [] : null;
  const reach = r + s.width / 2;
  const b = bounds(s);
  if (Math.max(x0, x1) < b[0] - r || Math.min(x0, x1) > b[2] + r || Math.max(y0, y1) < b[1] - r || Math.min(y0, y1) > b[3] + r) return null;
  const p = densify(s.pts, Math.max(0.5, r / 2));
  const keep: boolean[] = [];
  let any = false;
  for (let i = 0; i < p.length; i += 3) {
    const hit = segDist2(p[i], p[i + 1], x0, y0, x1, y1) <= reach * reach;
    keep.push(!hit);
    if (hit) any = true;
  }
  if (!any) return null;
  const pieces: Stroke[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 6) pieces.push({ ...s, id: makeId(), pts: cur.map((v) => Math.round(v * 100) / 100) });
    cur = [];
  };
  keep.forEach((k, j) => {
    if (k) cur.push(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
    else flush();
  });
  flush();
  return pieces;
}

// ── 형광펜을 글자 크기에 맞추기 ──────────────────────────────────────────

/** 글자 상자 [글자, x0, y0, x1, y1] */
export type CharBox = [string, number, number, number, number];

/** 가로로 그은 형광펜을 그 밑 글줄에 맞춘다: 높이는 글자 높이, 좌우는 칠한 글자 끝까지.
 *  글줄을 못 찾거나(빈 곳·여러 줄) 가로 획이 아니면 null. */
export function fitHighlight(pts: number[], width: number, chars: CharBox[]): { pts: number[]; width: number } | null {
  const n = pts.length;
  if (n < 6) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i += 3) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  if (maxX - minX < 6 || maxY - minY > Math.max(width, (maxX - minX) * 0.3)) return null; // 가로 획만
  const cy = (minY + maxY) / 2;
  const half = width / 2;
  // 획 띠에 걸친 글자들
  const hit = chars.filter(([c, x0, y0, x1, y1]) => {
    if (!c.trim()) return false;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return mx >= minX - 2 && mx <= maxX + 2 && my >= cy - half - (y1 - y0) * 0.35 && my <= cy + half + (y1 - y0) * 0.35;
  });
  if (!hit.length) return null;
  // 획 가운데에 가장 가까운 글줄 하나만 (윗줄·아랫줄 글자가 걸려도)
  const lineOf = (c: CharBox) => (c[2] + c[4]) / 2;
  const best = hit.reduce((a, c) => (Math.abs(lineOf(c) - cy) < Math.abs(lineOf(a) - cy) ? c : a));
  const lineH = best[4] - best[2];
  const line = hit.filter((c) => Math.abs(lineOf(c) - lineOf(best)) <= lineH * 0.5);
  const y0 = Math.min(...line.map((c) => c[2])), y1 = Math.max(...line.map((c) => c[4]));
  const x0 = Math.min(...line.map((c) => c[1])), x1 = Math.max(...line.map((c) => c[3]));
  const y = Math.round(((y0 + y1) / 2) * 100) / 100;
  const pad = (y1 - y0) * 0.12;
  return { pts: [Math.round((x0 - 1) * 100) / 100, y, pts[2], Math.round((x1 + 1) * 100) / 100, y, pts[n - 1]], width: Math.round((y1 - y0 + pad * 2) * 100) / 100 };
}
