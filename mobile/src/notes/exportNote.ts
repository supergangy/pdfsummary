// 필기를 합친 PDF 내보내기 (기기): 원본 PDF를 파일째 복사하고, 그 끝에 필기만 덧붙인다 (pdfAppend.ts).
// 원본을 메모리에 통째로 올리지 않으므로 수백 MB PDF도 된다. 복사·쓰기는 비동기라 꼭 기다린다.
import { File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { Ink, Notebook } from "./model";
import { appendInk } from "./pdfAppend";

export async function shareNotePdf(srcUri: string, nb: Notebook, ink: Ink, font: Uint8Array | null): Promise<void> {
  const src = new File(srcUri);
  const h = src.open(FileMode.ReadOnly);
  let tail: Uint8Array;
  try {
    const size = h.size ?? 0;
    tail = (
      await appendInk(
        {
          size,
          read: async (off, len) => {
            h.offset = off;
            return h.readBytes(len);
          },
        },
        nb,
        ink,
        font,
      )
    ).tail;
  } finally {
    h.close();
  }
  const out = new File(Paths.cache, `${(nb.title || "노트").replace(/[\\/:*?"<>|]/g, "_").slice(0, 140)}.pdf`);
  if (out.exists) out.delete();
  await src.copy(out);
  const w = out.open(FileMode.ReadWrite);
  try {
    w.offset = w.size ?? 0;
    await w.writeBytes(tail);
  } finally {
    w.close();
  }
  await Sharing.shareAsync(out.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: nb.title });
}
