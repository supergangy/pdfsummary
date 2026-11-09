import { renderPage } from "../../modules/pdf-pages";

export function pageImage(_nbId: string, pdfUri: string, index: number, widthPx: number): Promise<string> {
  const w = Math.min(4096, Math.max(256, Math.round(widthPx / 256) * 256));
  return renderPage(pdfUri, index, w, "");
}
