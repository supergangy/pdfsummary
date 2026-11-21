// 쪽 모아보기의 줄 계산 (화면 없이 시험할 수 있게 따로 둔다).
// 여러 칸짜리 목록(FlatList numColumns)은 '몇 번째 쪽'이 아니라 '몇 번째 줄'로 센다.

/** 쪽 번호 글 한 줄의 높이 (위 간격 4 포함). 줄 높이를 미리 알 수 있게 고정해 둔다. */
export const GRID_LABEL_H = 26;
/** 목록 가장자리 여백, 줄 사이 간격 */
export const GRID_PAD = 12;
export const GRID_ROW_GAP = 14;

/** index번째 쪽(0부터)이 한 줄에 cols칸일 때 몇 번째 줄(0부터)에 있는지 */
export function gridRow(index: number, cols: number): number {
  return Math.max(0, Math.floor(index / Math.max(1, cols)));
}

/**
 * 줄마다 높이(length)와 시작 자리(offset). 쪽 크기가 섞여 있으면 그 줄에서 가장 긴 쪽에 맞춘다.
 * 목록이 '지금 보던 쪽이 있는 줄'로 바로 가려면 이 값을 미리 알아야 한다.
 */
export function gridRows(pages: { w: number; h: number }[], cols: number, cellW: number): { length: number; offset: number }[] {
  const out: { length: number; offset: number }[] = [];
  let offset = GRID_PAD;
  for (let i = 0; i < pages.length; i += Math.max(1, cols)) {
    let h = 0;
    for (const p of pages.slice(i, i + cols)) h = Math.max(h, (cellW * p.h) / p.w);
    out.push({ length: h + GRID_LABEL_H, offset });
    offset += h + GRID_LABEL_H + GRID_ROW_GAP;
  }
  return out;
}
