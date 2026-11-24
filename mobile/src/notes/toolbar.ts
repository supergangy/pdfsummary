// 필기 화면 도구 모음: 무엇을 어떤 순서로 보일지, 어디에 붙일지 (사용자가 '도구 모음 편집'에서 바꾼다).
// 화면 그리기는 Editor.tsx. 여기는 계산만 (시험: toolbar.test.ts)

export type ToolbarItem = "pen" | "highlighter" | "eraser" | "lasso" | "text" | "insert" | "colors" | "widths" | "finger" | "zoom" | "undo";
/** 도구 모음 자리: 위(쪽 번호 줄 안) · 왼쪽 · 오른쪽 · 떠 있게(끌어서 아무 데나) */
export type ToolbarDock = "top" | "left" | "right" | "float";

export const TOOLBAR_ITEMS: { id: ToolbarItem; label: string }[] = [
  { id: "pen", label: "펜" },
  { id: "highlighter", label: "형광펜" },
  { id: "eraser", label: "지우개" },
  { id: "lasso", label: "올가미" },
  { id: "text", label: "글상자" },
  { id: "insert", label: "사진·스티커 넣기" },
  { id: "colors", label: "색" },
  { id: "widths", label: "굵기·직선·도형 펴기" },
  { id: "finger", label: "손가락 쓰기/이동" },
  { id: "zoom", label: "축소·맞춤·확대" },
  { id: "undo", label: "되돌리기·다시 하기" },
];
export const DEFAULT_TOOLBAR: ToolbarItem[] = TOOLBAR_ITEMS.map((i) => i.id);
export const DOCKS: { id: ToolbarDock; label: string }[] = [
  { id: "top", label: "위" },
  { id: "left", label: "왼쪽" },
  { id: "right", label: "오른쪽" },
  { id: "float", label: "떠 있게" },
];

export function itemLabel(id: ToolbarItem): string {
  return TOOLBAR_ITEMS.find((i) => i.id === id)?.label ?? id;
}

/** 저장된 순서를 믿을 수 있게: 모르는 것은 버리고, 겹친 것은 한 번만, 빠진 것(새로 생긴 항목)은 기본 순서에서 앞 항목 바로 뒤에 */
export function toolbarOrder(saved?: readonly string[] | null): ToolbarItem[] {
  const known = new Set<string>(DEFAULT_TOOLBAR);
  const out: ToolbarItem[] = [];
  for (const id of saved ?? []) if (known.has(id) && !out.includes(id as ToolbarItem)) out.push(id as ToolbarItem);
  DEFAULT_TOOLBAR.forEach((id, k) => {
    if (out.includes(id)) return;
    const before = DEFAULT_TOOLBAR.slice(0, k).reverse().find((p) => out.includes(p));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out;
}

/** 한 칸 앞으로(-1)·뒤로(+1). 끝에서는 그대로 */
export function moveItem(order: readonly ToolbarItem[], id: ToolbarItem, delta: -1 | 1): ToolbarItem[] {
  const out = [...order];
  const i = out.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 나눔 줄 묶음: 도구(펜~글상자)는 한 무리, 나머지는 저마다 한 무리.
 *  (따로 있던 '도구 설정' 단추는 뺐다: 고른 도구를 한 번 더 누르면 같은 창이 뜬다) */
export function groupOf(id: ToolbarItem): string {
  return id === "pen" || id === "highlighter" || id === "eraser" || id === "lasso" || id === "text" || id === "insert" ? "tools" : id;
}

/** 손잡이를 끌어 놓은 자리(화면 기준)로 붙일 곳: 맨 위 줄 근처 → 위, 왼쪽·오른쪽 끝 → 그쪽, 그 밖 → 떠 있게 */
export function dockAt(x: number, y: number, width: number, topBarBottom: number, edge = 80): ToolbarDock {
  if (y < topBarBottom + 40) return "top";
  if (x < edge) return "left";
  if (x > width - edge) return "right";
  return "float";
}

/** 떠 있는 도구 모음 자리를 화면 안으로 (w·h: 도구 모음 크기) */
export function clampFloat(x: number, y: number, w: number, h: number, width: number, height: number, top: number): { x: number; y: number } {
  return {
    x: Math.max(4, Math.min(width - w - 4, x)),
    y: Math.max(top + 4, Math.min(height - h - 4, y)),
  };
}
