// PDF 쪽 크기 읽기·쪽 그림 만들기 (기기: 네이티브 모듈)
import { requireOptionalNativeModule } from "expo";

export type PageSize = { w: number; h: number };

type Native = {
  infoAsync(uri: string): Promise<string>;
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
