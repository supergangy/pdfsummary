// 노트를 파일 하나(.pnote = zip)로 묶어 다른 기기로 옮기기
//   notebook.json  노트 정보(쪽 크기·순서·속지)
//   ink.json       쪽 id → 획들
//   source.pdf     원본 PDF (있으면)
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { newId, parseNotebook, parseStrokes, type Ink, type Notebook } from "./model.ts";

export const PACK_EXT = ".pnote";

export function packNotebook(nb: Notebook, ink: Ink, pdf: Uint8Array | null): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ app: "필기 요약", kind: "notebook", v: 1, made: new Date().toISOString() })),
    "notebook.json": strToU8(JSON.stringify(nb)),
    "ink.json": strToU8(JSON.stringify(ink)),
  };
  if (pdf) files["source.pdf"] = pdf;
  return zipSync(files, { level: 6 });
}

export type Unpacked = { nb: Notebook; ink: Ink; pdf: Uint8Array | null };

/** 노트 파일 풀기. 같은 노트를 여러 번 가져와도 겹치지 않게 새 id를 준다. */
export function unpackNotebook(bytes: Uint8Array): Unpacked {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("노트 파일이 아니거나 깨졌어요.");
  }
  const man = files["manifest.json"] ? JSON.parse(strFromU8(files["manifest.json"])) : null;
  if (!man || man.kind !== "notebook") throw new Error("필기 요약 노트 파일이 아니에요.");
  if (Number(man.v) > 1) throw new Error("더 새 앱에서 만든 노트 파일이에요. 앱을 업데이트해 주세요.");
  const nb = parseNotebook(JSON.parse(strFromU8(files["notebook.json"] ?? strToU8("null"))));
  if (!nb) throw new Error("노트 정보가 깨졌어요.");
  const raw = JSON.parse(strFromU8(files["ink.json"] ?? strToU8("{}"))) as Record<string, unknown>;
  const ink: Ink = {};
  for (const p of nb.pages) {
    const ss = parseStrokes(raw?.[p.id]);
    if (ss.length) ink[p.id] = ss;
  }
  const pdf = files["source.pdf"] ?? null;
  if (nb.hasPdf && !pdf) throw new Error("노트 파일에 원본 PDF가 없어요.");
  const now = Date.now();
  return { nb: { ...nb, id: newId(), updated: now }, ink, pdf };
}
