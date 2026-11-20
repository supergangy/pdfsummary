// PDF 쪽 크기 읽기·쪽 그림 만들기 (기기: 네이티브 모듈)
import { requireOptionalNativeModule } from "expo";

export type PageSize = { w: number; h: number };

/** 글자 하나와 그 상자 (화면에 보이는 쪽 좌표, pt) */
export type PdfChar = [string, number, number, number, number];

type Native = {
  infoAsync(uri: string): Promise<string>;
  textAsync(uri: string, index: number): Promise<string | null>;
  ocrAsync?(uri: string, index: number, widthPx: number): Promise<string>;
  renderAsync(uri: string, index: number, widthPx: number, outPath: string): Promise<string>;
};

const N = requireOptionalNativeModule<Native>("PdfPages");

export const available = !!N;

export async function pdfInfo(uri: string): Promise<PageSize[]> {
  if (!N) throw new Error("이 앱에서는 PDF를 열 수 없어요 (개발용 빌드가 필요해요).");
  return JSON.parse(await N.infoAsync(uri)) as PageSize[];
}

/** index 쪽을 폭 widthPx로 그려 outPath에 저장하고 그 주소(file://)를 돌려준다. */
export async function renderPage(uri: string, index: number, widthPx: number, outPath: string): Promise<string> {
  if (!N) throw new Error("이 앱에서는 PDF를 그릴 수 없어요.");
  return N.renderAsync(uri, index, Math.round(widthPx), outPath);
}

const hasText = (cs: PdfChar[] | null) => !!cs && cs.some((c) => c[0].trim());
const cache = new Map<string, Promise<PdfChar[] | null>>();

/** 쪽의 글자들. PDF 글자 층을 먼저 쓰고, 없으면(스캔본·안드로이드 14 이하) 글자 인식(OCR)으로 읽는다.
 *  둘 다 안 되면 null. 같은 쪽은 한 번만 읽는다 (글자 인식은 쪽마다 1초쯤 걸림). */
export function pageText(uri: string, index: number): Promise<PdfChar[] | null> {
  if (!N) return Promise.resolve(null);
  const key = `${uri}#${index}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      let cs: PdfChar[] | null = null;
      try {
        const s = await N.textAsync(uri, index);
        cs = s ? (JSON.parse(s) as PdfChar[]) : null;
      } catch {
        cs = null;
      }
      if (hasText(cs) || !N.ocrAsync) return cs;
      try {
        const o = JSON.parse(await N.ocrAsync(uri, index, 2200)) as PdfChar[];
        return hasText(o) ? o : cs;
      } catch {
        return cs;
      }
    })();
    cache.set(key, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}
