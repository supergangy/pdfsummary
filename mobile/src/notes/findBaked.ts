// 다른 앱에서 칠해 쪽 그림에 굳은 형광펜 찾기 (앱): 쪽마다 그림으로 그려 색 덩어리를 찾고(bakedHighlights.ts),
// 고른 색의 형광펜 밑 글자를 읽어 요약 항목으로 만든다.
import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";

import { pageText } from "../../modules/pdf-pages";
import { charsIn, COLOR_INFO, findBakedHighlights, foundColors, type BakedMark, type ColorKey } from "./bakedHighlights";
import type { Notebook } from "./model";
import { rasterPage } from "./pageRaster";
import { highlightItemsFromChars, type QuickItem, type QuickSummary } from "./quick";

export type BakedScan = { pages: Map<number, BakedMark[]>; scanned: number; total: number };

/** 그릴 폭(픽셀): 파이썬(100dpi)과 비슷하게, 너무 크게는 안 (큰 쪽은 1600) */
const widthFor = (pageW: number) => Math.round(Math.max(800, Math.min(1600, pageW * 1.39)));

/** PDF 쪽을 하나씩 그려 형광펜 색 덩어리를 찾는다. shouldStop이 참이면 거기까지만 */
/** range: 찾을 쪽 범위 [처음, 끝] (노트 쪽 번호, 0부터). 없으면 전체 */
export async function scanBaked(nb: Notebook, pdfUri: string, onProgress: (done: number, total: number) => void, shouldStop: () => boolean, range?: [number, number]): Promise<BakedScan> {
  const pages = new Map<number, BakedMark[]>();
  const todo = nb.pages.map((p, i) => ({ p, i })).filter(({ p, i }) => p.pdf !== undefined && (!range || (i >= range[0] && i <= range[1])));
  let done = 0;
  for (const { p, i } of todo) {
    if (shouldStop()) break;
    try {
      const uri = await rasterPage(pdfUri, p.pdf!, widthFor(p.w));
      const data = await Skia.Data.fromURI(uri);
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (img) {
        const w = img.width(), h = img.height();
        const px = img.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
        if (px instanceof Uint8Array) {
          const marks = findBakedHighlights(px, w, h, p.w, p.h);
          if (marks.length) pages.set(i, marks);
        }
        img.dispose?.();
      }
    } catch {
      // 그리지 못한 쪽은 건너뛴다
    }
    onProgress(++done, todo.length);
  }
  return { pages, scanned: done, total: todo.length };
}

/** 찾은 색과 개수 (사람이 칠한 것 같은 색이 앞, 거의 모든 쪽에 있는 색은 뒤) */
export function bakedColors(scan: BakedScan) {
  return foundColors(scan.pages, scan.scanned);
}

/** 고른 색의 형광펜 밑 글자를 읽어 요약에 더한다 (글자를 못 읽은 형광펜은 뺀다) */
export async function addBakedToSummary(q: QuickSummary, nb: Notebook, pdfUri: string, scan: BakedScan, colors: Set<ColorKey>, onProgress: (done: number, total: number) => void, shouldStop: () => boolean): Promise<{ summary: QuickSummary; added: number }> {
  const pages = [...scan.pages].map(([i, ms]) => [i, ms.filter((m) => colors.has(m.color))] as const).filter(([, ms]) => ms.length);
  const byPage = new Map(q.pages.map((p) => [p.page, [...p.items]]));
  let added = 0, done = 0;
  for (const [i, ms] of pages) {
    if (shouldStop()) break;
    const pdf = nb.pages[i]?.pdf;
    let chars = null;
    try {
      chars = pdf === undefined ? null : await pageText(pdfUri, pdf);
    } catch {
      chars = null;
    }
    if (chars) {
      const items: QuickItem[] = [];
      for (const m of ms) {
        const idx = charsIn(chars, m.parts);
        if (idx.length) items.push(...highlightItemsFromChars(i, COLOR_INFO[m.color].hex, chars, idx));
      }
      if (items.length) {
        byPage.set(i, [...(byPage.get(i) ?? []), ...items].sort((a, b) => (Math.abs(a.box[1] - b.box[1]) < 6 ? a.box[0] - b.box[0] : a.box[1] - b.box[1])));
        added += items.length;
      }
    }
    onProgress(++done, pages.length);
  }
  const out = [...byPage].sort((a, b) => a[0] - b[0]).map(([page, items]) => ({ page, items }));
  return { summary: { ...q, pages: out }, added };
}
