// 필기를 합친 PDF 내보내기 (웹): 원본 Blob은 그대로 두고 필기만 덧붙인 Blob을 내려받는다 (pdfAppend.ts)
import type { Ink, Notebook } from "./model";
import { appendInk } from "./pdfAppend";

export async function shareNotePdf(srcUri: string, nb: Notebook, ink: Ink, font: Uint8Array | null): Promise<void> {
  const blob = await (await fetch(srcUri)).blob();
  const { tail } = await appendInk({ size: blob.size, read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()) }, nb, ink, font);
  const url = URL.createObjectURL(new Blob([blob, tail as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(nb.title || "노트").replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 30000);
}
