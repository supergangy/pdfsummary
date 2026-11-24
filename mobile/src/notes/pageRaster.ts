// 쪽 하나를 그림으로 (형광펜 색 찾기용). 수백 쪽을 차례로 그리므로 한 파일에 덮어써서 임시 폴더가 커지지 않게
import { Directory, File, Paths } from "expo-file-system";
import { renderPage } from "../../modules/pdf-pages";

export async function rasterPage(pdfUri: string, index: number, widthPx: number): Promise<string> {
  const dir = new Directory(Paths.cache, "scan");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const out = new File(dir, "page.jpg");
  return renderPage(pdfUri, index, widthPx, out.uri);
}
