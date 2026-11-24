// 웹: pdf.js로 그린 쪽 그림 (data URI)
import { renderPage } from "../../modules/pdf-pages";

export function rasterPage(pdfUri: string, index: number, widthPx: number): Promise<string> {
  return renderPage(pdfUri, index, widthPx, "");
}
