// PDF 쪽 크기 읽기·쪽 그림 만들기 (기기: 네이티브 모듈)
import { requireOptionalNativeModule } from "expo";

export type PageSize = { w: number; h: number };

/** 글자 하나와 그 상자 (화면에 보이는 쪽 좌표, pt) */
export type PdfChar = [string, number, number, number, number];

type Native = {
  infoAsync(uri: string): Promise<string>;
  textAsync(uri: string, index: number): Promise<string | null>;
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

/** 쪽의 글자들. 이 기기에서 꺼낼 수 없으면 null (안드로이드 14 이하 등). */
export async function pageText(uri: string, index: number): Promise<PdfChar[] | null> {
  if (!N) return null;
  const s = await N.textAsync(uri, index);
  return s ? (JSON.parse(s) as PdfChar[]) : null;
}
