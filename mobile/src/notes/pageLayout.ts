// 쪽 보기 방식에 따라 여러 쪽을 한 '문서' 위에 늘어놓는다.
// - 좌우로 넘기기(h): 쪽(또는 두 쪽 묶음)을 옆으로 나란히. 손을 떼면 한 묶음씩 딱 맞춰 넘어간다
// - 위아래로 넘기기(v): 쪽을 위아래로 이어 붙여 죽 내려 본다
// - 두 쪽씩 보기: 1·2쪽, 3·4쪽 … 을 한 묶음(펼친 면)으로 나란히
// 자리는 쪽 좌표(pt) 그대로라 확대 배율과 상관없다. 화면 그리기·손 입력(UI 스레드)에서 쓰도록 평평한 숫자 배열로 둔다.

export type PageFlow = "h" | "v";

/** 쪽 사이 틈 (쪽 좌표 pt) */
export const PAGE_GAP = 24;

export type DocLayout = {
  /** 쪽마다 [x, y, w, h] 를 이어 붙인 것 (i번째 쪽 = rects[i*4 .. i*4+3]) */
  rects: number[];
  /** 묶음(펼친 면)마다 [x, y, w, h] */
  spreads: number[];
  /** 묶음마다 [첫 쪽 번호, 끝 쪽 번호] */
  spreadPages: number[];
  /** 쪽 번호 → 묶음 번호 */
  spreadOf: number[];
  /** 문서 전체 크기 */
  w: number;
  h: number;
};

export function docLayout(pages: { w: number; h: number }[], flow: PageFlow, two: boolean, gap = PAGE_GAP): DocLayout {
  const per = two ? 2 : 1;
  const groups: number[][] = [];
  for (let i = 0; i < pages.length; i += per) groups.push(pages.slice(i, i + per).map((_, k) => i + k));
  const size = groups.map((g) => {
    const w = g.reduce((s, i) => s + pages[i].w, 0) + gap * (g.length - 1);
    const h = Math.max(...g.map((i) => pages[i].h));
    return [w, h];
  });
  const maxW = Math.max(0, ...size.map((s) => s[0]));
  const maxH = Math.max(0, ...size.map((s) => s[1]));
  const rects: number[] = new Array(pages.length * 4).fill(0);
  const spreads: number[] = [];
  const spreadPages: number[] = [];
  const spreadOf: number[] = new Array(pages.length).fill(0);
  let at = 0;
  groups.forEach((g, gi) => {
    const [sw, sh] = size[gi];
    // 위아래: 묶음을 가운데 맞춤으로 쌓는다. 좌우: 묶음을 위쪽 맞춤으로 옆에 붙인다
    const sx = flow === "v" ? (maxW - sw) / 2 : at;
    const sy = flow === "v" ? at : 0;
    spreads.push(sx, sy, sw, sh);
    spreadPages.push(g[0], g[g.length - 1]);
    let x = sx;
    for (const i of g) {
      const p = pages[i];
      rects[i * 4] = x;
      rects[i * 4 + 1] = sy + (sh - p.h) / 2; // 묶음 안에서 키가 다르면 가운데로
      rects[i * 4 + 2] = p.w;
      rects[i * 4 + 3] = p.h;
      spreadOf[i] = gi;
      x += p.w + gap;
    }
    at += (flow === "v" ? sh : sw) + gap;
  });
  const total = Math.max(0, at - gap);
  return { rects, spreads, spreadPages, spreadOf, w: flow === "v" ? maxW : total, h: flow === "v" ? total : maxH };
}

/** 이 점(문서 좌표)이 든 쪽 번호. 쪽 바깥(틈·여백)이면 -1 */
export function pageAt(rects: number[], x: number, y: number): number {
  "worklet";
  for (let i = 0; i * 4 < rects.length; i++) {
    const rx = rects[i * 4], ry = rects[i * 4 + 1];
    if (x >= rx && x <= rx + rects[i * 4 + 2] && y >= ry && y <= ry + rects[i * 4 + 3]) return i;
  }
  return -1;
}

/** 이 점(문서 좌표)에서 가장 가까운 묶음 번호 (안에 들면 거리 0) */
export function nearestSpread(spreads: number[], x: number, y: number): number {
  "worklet";
  let best = 0, bestD = Infinity;
  for (let i = 0; i * 4 < spreads.length; i++) {
    const sx = spreads[i * 4], sy = spreads[i * 4 + 1], sw = spreads[i * 4 + 2], sh = spreads[i * 4 + 3];
    const dx = x < sx ? sx - x : x > sx + sw ? x - sx - sw : 0;
    const dy = y < sy ? sy - y : y > sy + sh ? y - sy - sh : 0;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 이 네모(문서 좌표)에 걸치는 쪽 번호 범위 [처음, 끝]. 하나도 없으면 [-1, -1] */
export function pagesIn(rects: number[], x0: number, y0: number, x1: number, y1: number): [number, number] {
  "worklet";
  let first = -1, last = -1;
  for (let i = 0; i * 4 < rects.length; i++) {
    const rx = rects[i * 4], ry = rects[i * 4 + 1];
    if (rx + rects[i * 4 + 2] >= x0 && rx <= x1 && ry + rects[i * 4 + 3] >= y0 && ry <= y1) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return [first, last];
}

/** 좌우 넘기기에서 손을 뗐을 때 갈 묶음: 빠르게 밀었으면 그 쪽으로 하나, 아니면 화면 가운데에 가까운 묶음 */
export function pageTurnTarget(start: number, nearest: number, velocityX: number, count: number, fast = 300): number {
  "worklet";
  let t = nearest;
  if (velocityX < -fast) t = Math.max(nearest, start + 1);
  else if (velocityX > fast) t = Math.min(nearest, start - 1);
  return Math.max(0, Math.min(count - 1, t));
}
