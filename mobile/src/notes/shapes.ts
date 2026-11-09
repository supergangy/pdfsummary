// 올가미 선택과 도형 펴기
import type { Stroke } from "./model.ts";

/** 점이 다각형(x, y, x, y, …) 안에 있는지 */
export function inside(x: number, y: number, poly: number[]): boolean {
  let hit = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
  }
  return hit;
}

/** 올가미(닫힌 선) 안에 점의 절반 이상이 든 획들 */
export function lassoSelect(strokes: Stroke[], lasso: number[]): Set<string> {
  const poly: number[] = [];
  for (let i = 0; i < lasso.length; i += 3) poly.push(lasso[i], lasso[i + 1]);
  const out = new Set<string>();
  if (poly.length < 6) return out;
  for (const s of strokes) {
    let n = 0, k = 0;
    for (let i = 0; i < s.pts.length; i += 3) {
      k++;
      if (inside(s.pts[i], s.pts[i + 1], poly)) n++;
    }
    if (k && n / k >= 0.5) out.add(s.id);
  }
  return out;
}

export function moved(s: Stroke, dx: number, dy: number): Stroke {
  const pts = s.pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = Math.round((pts[i] + dx) * 100) / 100;
    pts[i + 1] = Math.round((pts[i + 1] + dy) * 100) / 100;
  }
  return { ...s, pts };
}

// ── 도형 펴기 ──────────────────────────────────────────────────────────

type P = [number, number];

function pts2(s: number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < s.length; i += 3) out.push([s[i], s[i + 1]]);
  return out;
}

function segDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** 더글러스-퓨커: 모서리 점만 남긴다 */
function simplify(p: P[], tol: number): P[] {
  if (p.length < 3) return p;
  let best = 0, at = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = segDist(p[i], p[0], p[p.length - 1]);
    if (d > best) {
      best = d;
      at = i;
    }
  }
  if (best <= tol) return [p[0], p[p.length - 1]];
  const a = simplify(p.slice(0, at + 1), tol);
  const b = simplify(p.slice(at), tol);
  return [...a.slice(0, -1), ...b];
}

/** 꼭짓점 사이를 촘촘히 채운다 (펜 윤곽을 매끄럽게 만드는 계산이 모서리를 둥글리지 않게) */
const flat = (ps: P[], step = 3): number[] => {
  const out: number[] = [];
  const push = (x: number, y: number) => out.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, 0.5);
  for (let i = 0; i < ps.length; i++) {
    if (i === 0) {
      push(ps[0][0], ps[0][1]);
      continue;
    }
    const [ax, ay] = ps[i - 1], [bx, by] = ps[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  return out;
};

export type Shape = "line" | "rectangle" | "triangle" | "ellipse";

/** 손으로 그린 획이 선·사각형·삼각형·타원 같으면 반듯한 도형 점들을 돌려준다. 아니면 null. */
export function snapShape(raw: number[]): { shape: Shape; pts: number[] } | null {
  const p = pts2(raw);
  if (p.length < 4) return null;
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0);
  if (size < 12) return null;
  const a = p[0], b = p[p.length - 1];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);

  // 직선: 처음과 끝을 잇는 선에서 거의 벗어나지 않음
  if (chord > size * 0.8 && p.every((q) => segDist(q, a, b) <= Math.max(2, chord * 0.04))) {
    return { shape: "line", pts: flat([a, b]) };
  }
  // 닫힌 도형: 끝이 처음 근처로 돌아옴
  if (chord > Math.max(14, len * 0.15)) return null;
  const ring = [...p.slice(0, -1), p[0]];
  const corners = simplify(ring, size * 0.08);
  const n = corners.length - 1; // 닫혀 있어 처음 = 끝
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  if (rx > 4 && ry > 4) {
    // 타원 판정: 모든 점이 (x-cx)²/rx² + (y-cy)²/ry² ≈ 1
    const errs = p.map(([x, y]) => Math.abs(Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) - 1));
    const meanErr = errs.reduce((m, e) => m + e, 0) / errs.length;
    if (meanErr < 0.09 && n >= 5) {
      const out: P[] = [];
      for (let k = 0; k <= 72; k++) {
        const t = (k / 72) * Math.PI * 2;
        out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      return { shape: "ellipse", pts: flat(out, 1000) };
    }
  }
  if (n === 3) return { shape: "triangle", pts: flat([...corners.slice(0, 3), corners[0]]) };
  if (n === 4) {
    // 거의 직각이면 반듯한(가로세로) 사각형
    return { shape: "rectangle", pts: flat([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]) };
  }
  return null;
}
