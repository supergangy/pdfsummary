// PDF를 노트로 가져오기: 저장소에 복사 → 쪽 크기 읽기 → 노트 만들기
import { pdfInfo } from "../../modules/pdf-pages";
import type { Picked } from "../platform/types";
import { newId, type Notebook } from "./model";
import type { NoteStore } from "./store";

export async function importPdf(store: NoteStore, p: Picked): Promise<Notebook> {
  const id = newId();
  await store.attachPdf(id, { uri: p.uri, blob: p.webFile });
  try {
    const uri = await store.pdfUri(id);
    const sizes = await pdfInfo(uri);
    if (!sizes.length) throw new Error("쪽이 없는 PDF예요.");
    const now = Date.now();
    const nb: Notebook = {
      v: 1,
      id,
      title: p.name.replace(/\.pdf$/i, "") || "가져온 PDF",
      created: now,
      updated: now,
      hasPdf: true,
      pages: sizes.map((s, i) => ({ id: newId(), w: s.w, h: s.h, pdf: i })),
    };
    await store.save(nb);
    return nb;
  } catch (e) {
    await store.remove(id);
    const msg = (e as Error).message || "";
    throw new Error(/암호|password|encrypt/i.test(msg) ? "암호가 걸린 PDF는 가져올 수 없어요." : `PDF를 열 수 없어요. ${msg}`);
  }
}
