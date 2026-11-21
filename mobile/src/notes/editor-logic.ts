// 필기 화면(Editor)의 작은 계산들. 화면 없이 Node로 시험할 수 있게 따로 둔다.

/** 쪽 바탕 그림 기억: 쪽 id → 그림 (쪽 번호로 기억하면 쪽을 끼우거나 지울 때 한 쪽씩 밀린다) */
export type BgCache = Record<string, { uri: string; w: number }>;

/** 이 쪽의 바탕 그림 주소. 빈 속지(PDF 쪽이 아님)는 그림이 없다. */
export function pageBg(bg: BgCache, page: { id: string; pdf?: number }): string | null {
  return page.pdf === undefined ? null : bg[page.id]?.uri ?? null;
}

/** 처음 열 쪽 번호(0부터): 없는 쪽이면 마지막 쪽으로, 이상한 값이면 첫 쪽으로 */
export function clampPage(i: number | undefined, count: number): number {
  if (i === undefined || !Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(i)));
}

/** 되돌리기·다시 하기가 바꾼 쪽이 지금 보는 쪽과 다르면 그 쪽 번호(0부터). 같은 쪽이거나 없는 쪽이면 -1 */
export function otherPage(pages: { id: string }[], current: string | undefined, changed: string | undefined): number {
  if (!changed || changed === current) return -1;
  return pages.findIndex((p) => p.id === changed);
}

/** 획이 시작점에서 가장 멀리 간 거리 (쪽 좌표). pts = [x, y, 필압, x, y, 필압, …] */
export function reach(pts: number[]): number {
  let far = 0;
  for (let i = 3; i + 1 < pts.length; i += 3) far = Math.max(far, Math.hypot(pts[i] - pts[0], pts[i + 1] - pts[1]));
  return far;
}

/** 형광펜으로 톡 누르기만 한 획인가. 형광펜은 끝이 납작한 선이라 이런 획은 안 보이거나 실금으로만 보인다 → 저장하지 않는다 */
export function isHighlighterTap(pts: number[]): boolean {
  return reach(pts) < 2;
}

/** 어떤 일(at)이 있은 바로 뒤인가. 단추를 빠르게 두 번 눌렀을 때 둘째 누름을 거르는 데 쓴다 */
export function justAfter(now: number, at: number, ms = 400): boolean {
  return now - at < ms;
}

/** 색 단추 테두리 색: 어두운 바탕에서는 밝은 테두리 (검정 단추가 바탕에 묻히지 않게). card = 바탕 색 #rrggbb */
export function swatchEdge(card: string, light = "rgba(0,0,0,0.15)"): string {
  const m = /^#([0-9a-f]{6})$/i.exec(card);
  if (!m) return light;
  const n = parseInt(m[1], 16);
  const bright = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return bright < 110 ? "rgba(255,255,255,0.45)" : light;
}

/** 펜 견본 물결의 점들. 견본을 쪽이 화면에 보이는 배율(scale)로 키워 그리므로 좌표는 그만큼 줄여 둔다 */
export function previewPts(scale: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = 14 + i * 7.6;
    const y = 32 + Math.sin(i / 6) * 14;
    pts.push(x / scale, y / scale, 0.25 + 0.6 * Math.sin((i / 40) * Math.PI));
  }
  return pts;
}

/** 견본을 그릴 배율: 쪽이 화면에 보이는 배율 그대로, 견본 칸을 넘지 않게 1~3 사이로 */
export function previewScale(viewScale: number | undefined): number {
  if (viewScale === undefined || !Number.isFinite(viewScale)) return 1;
  return Math.max(1, Math.min(3, viewScale));
}
