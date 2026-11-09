// 쪽 바탕 그림(PDF 쪽을 그린 JPEG)을 기기 임시 폴더에 두고 다시 쓴다.
import { File, Paths } from "expo-file-system";
import { renderPage } from "../../modules/pdf-pages";

const pending = new Map<string, Promise<string>>();

export function pageImage(nbId: string, pdfUri: string, index: number, widthPx: number): Promise<string> {
  const w = Math.min(4096, Math.max(256, Math.round(widthPx / 256) * 256)); // 비슷한 크기는 같은 그림으로
  const key = `${nbId}/${index}_${w}`;
  let p = pending.get(key);
  if (!p) {
    const out = new File(Paths.cache, "pages", nbId, `${index}_${w}.jpg`);
    p = out.exists ? Promise.resolve(out.uri) : renderPage(pdfUri, index, w, out.uri);
    p.catch(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}
