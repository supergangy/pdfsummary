// 획 계산: 매끄러운 윤곽(필압), 경계 상자, 지우개 맞히기, 점 줄이기. 화면과 분리해 Node로 시험한다.
import { getStroke } from "perfect-freehand";
import type { Stroke } from "./model.ts";

export type Box = [number, number, number, number]; // x0, y0, x1, y1

/** 펜 획의 윤곽(채워 그릴 다각형). 필압이 있으면 굵기가 변한다. */
export function penOutline(s: Stroke, last = true): number[][] {
  const pts: number[][] = [];
  let hasPressure = false;
  for (let i = 0; i < s.pts.length; i += 3) {
    const p = s.pts[i + 2];
    if (p > 0 && p !== 0.5) hasPressure = true;
    pts.push([s.pts[i], s.pts[i + 1], p > 0 ? p : 0.5]);
  }
  return getStroke(pts, {
    size: s.width * 1.6,
    thinning: hasPressure ? 0.55 : 0.2,
    smoothing: 0.5,
    streamline: 0.2, // 크면 글씨가 뭉개진다 (한글 획은 짧고 꺾임이 많음)
    simulatePressure: !hasPressure,
    last,
  });
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
  if (s.tool === "text") return ""; // 글상자는 글자로 따로 그린다
  return s.tool === "pen" ? outlineToSvg(penOutline(s)) : polylineSvg(s);
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

/** 형광펜을 '곧게'(삼성노트·굿노트의 직선 형광펜처럼): 거의 가로로 그었으면 시작~끝을 수평선으로. */
export function straighten(pts: number[]): number[] {
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
