// 필기 화면(Editor)의 작은 계산들. 화면 없이 Node로 시험할 수 있게 따로 둔다.
import { PENS, type LineDash, type PenBrush } from "./model.ts";

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

/** 아래쪽 쪽 이동 막대: 막대 위 x(막대 폭 w 안)가 가리키는 쪽 번호 (0부터). 양 끝은 첫 쪽·마지막 쪽 */
export function scrubIndex(x: number, w: number, count: number): number {
  if (count <= 1 || !(w > 0)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round((x / w) * (count - 1))));
}

/** 노트마다 마지막에 보던 쪽: 이 노트를 맨 뒤(가장 최근)로 넣고, 너무 많으면 오래된 것부터 뺀다 */
export function rememberPage(map: Readonly<Record<string, string>>, note: string, page: string, max = 300): Record<string, string> {
  const keys = Object.keys(map).filter((k) => k !== note);
  const out: Record<string, string> = {};
  for (const k of keys.slice(Math.max(0, keys.length - (max - 1)))) out[k] = map[k];
  out[note] = page;
  return out;
}

/** 처음 열 쪽: 요약에서 돌아오면 그 쪽, 아니면 마지막에 보던 쪽(그 쪽이 아직 있으면), 없으면 첫 쪽 */
export function openingPage(pages: readonly { id: string }[], startPage: number | undefined, lastId: string | null): number {
  if (startPage !== undefined) return clampPage(startPage, pages.length);
  const i = lastId ? pages.findIndex((p) => p.id === lastId) : -1;
  return i >= 0 ? i : 0;
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

// ── S펜 옆 단추 두 번: 등록한 도구로 바꾸기 ─────────────────

/** S펜 옆 단추를 펜을 띄운 채 짧게 두 번 눌렀는지 알아낸다. 단추를 누른 채 쓰기(지우개)는 세지 않는다.
 *  돌려준 함수에 단추 소식(눌림/뗌, 떠 있었는지, 시각)을 차례로 넣으면, 두 번째로 누른 순간 true. */
export function penDoubleClick(gap = 450, short = 300) {
  let first: number | null = null; // 첫 번째 짧은 누름이 시작된 때
  let down: number | null = null; // 지금 누름이 시작된 때
  let downHover = false;
  return (pressed: boolean, hover: boolean, now: number): boolean => {
    if (pressed) {
      if (hover && first !== null && now - first < gap) {
        first = null;
        down = null;
        return true;
      }
      down = now;
      downHover = hover;
      return false;
    }
    // 뗌: 떠 있는 채로 짧게 눌렀다 뗐을 때만 '첫 번째 누름' (닿은 채 뗐으면 단추 지우개를 쓴 것)
    first = down !== null && downHover && hover && now - down < short ? down : null;
    down = null;
    return false;
  };
}

/** 두 번 누르면 바꿀 도구. favorite = 등록해 둔 펜 (종류·색·굵기·선 모양) */
export type SwapTarget = "highlighter" | "eraser" | "lasso" | "favorite" | "off";
export type PenLook = { penBrush: PenBrush; penColor: string; penWidth: number; penDash: LineDash };
type SwapTool = "pen" | "highlighter" | "eraser" | "lasso" | "text";
/** 바꾸기 전 모습 (돌아올 때 쓴다)과 바꾼 도구 */
export type SwapSaved = { from: { tool: SwapTool } & PenLook; to: SwapTool };

/** 두 번 눌렀을 때: 등록한 도구로 바꾸거나, 바꿔 둔 채(그 도구 그대로)면 원래대로 돌아온다.
 *  바꿀 설정과 다음 상태, 알림 글을 돌려준다. 바꿀 것이 없으면 null. */
export function penSwap(
  p: { tool: SwapTool; swapTool: SwapTarget; favorite: PenLook | null } & PenLook,
  saved: SwapSaved | null,
): { patch: Partial<{ tool: SwapTool } & PenLook>; saved: SwapSaved | null; say: string } | null {
  if (p.swapTool === "off") return null;
  if (saved && p.tool === saved.to) return { patch: { ...saved.from }, saved: null, say: `${ro(toolLabel(saved.from.tool, saved.from.penBrush))} 돌아왔어요` };
  const from = { tool: p.tool, penBrush: p.penBrush, penColor: p.penColor, penWidth: p.penWidth, penDash: p.penDash };
  if (p.swapTool === "favorite") {
    if (!p.favorite) return { patch: {}, saved, say: "즐겨찾는 펜을 먼저 등록해 주세요 (펜 설정)" };
    return { patch: { tool: "pen", ...p.favorite }, saved: { from, to: "pen" }, say: "즐겨찾는 펜으로 바꿨어요" };
  }
  // 이미 그 도구를 쓰고 있으면 펜으로
  const to: SwapTool = p.tool === p.swapTool ? "pen" : p.swapTool;
  return { patch: { tool: to }, saved: { from, to }, say: `${ro(toolLabel(to, p.penBrush))} 바꿨어요` };
}

function toolLabel(tool: SwapTool, brush: PenBrush): string {
  if (tool === "pen") return PENS.find((x) => x.id === brush)?.label ?? "펜";
  return tool === "highlighter" ? "형광펜" : tool === "eraser" ? "지우개" : tool === "lasso" ? "올가미" : "글상자";
}

/** 낱말 뒤에 '로/으로' (받침 없거나 ㄹ이면 '로') */
export function ro(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return `${word}(으)로`;
  const jong = c % 28;
  return word + (jong === 0 || jong === 8 ? "로" : "으로");
}

/** 색 단추 이름표에 보일 색 이름 (펜·형광펜 색). 모르는 색은 색 값 그대로 */
const COLOR_NAMES: Record<string, string> = {
  "#1F2328": "검정", "#1E4FD8": "파랑", "#D7263D": "빨강", "#0F8A5F": "초록", "#7A3EC8": "보라", "#E67E22": "주황",
  "#6B7280": "회색", "#0EA5E9": "하늘색", "#EC4899": "분홍", "#8B5A2B": "갈색", "#C9A100": "겨자색", "#FFFFFF": "흰색",
  "#FFE14D": "노랑", "#FF9EC7": "분홍", "#8FE38F": "연두", "#7FD3FF": "하늘색", "#FFB86B": "주황", "#C9A7FF": "연보라",
  "#FF7B7B": "빨강", "#BDBDBD": "회색",
};
export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toUpperCase()] ?? hex;
}

/** 굵기 단추 이름표 (도구 모음의 빠른 굵기 세 개) */
export function widthName(i: number): string {
  return `굵기: ${["가늘게", "보통", "굵게"][i] ?? i + 1}`;
}
