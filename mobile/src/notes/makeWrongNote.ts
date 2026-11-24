// 오답 노트 만들기 (앱): 고른 노트들의 쪽을 돌며 빨간 사선을 찾고, 그 문제 칸을 쪽 그림에서 잘라 새 노트로 (계산은 wrongNote.ts)
import { ImageFormat, Skia, type SkCanvas } from "@shopify/react-native-skia";

import { pageText } from "../../modules/pdf-pages";
import { type Box } from "./geometry";
import type { Notebook, Stroke } from "./model";
import { pageImage } from "./pageImage";
import { inkPicture, paperPicture } from "./render";
import type { NoteStore } from "./store";
import { isWrongSlash, layoutWrongNote, wrongQuestions, type WrongItem } from "./wrongNote";

const MAX_PX = 1200; // 잘라 낸 그림 폭 (노트 크기·동기화를 생각해 이보다 크게는 안 한다)

function encode(draw: (c: SkCanvas) => void, w: number, h: number): string {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error("그림을 만들 수 없어요");
  const c = surface.getCanvas();
  c.drawColor(Skia.Color("#FFFFFF"));
  draw(c);
  surface.flush();
  return `data:image/jpeg;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 85)}`;
}

/** PDF 쪽에서 box(쪽 좌표)만 잘라 낸 그림 (필기는 빼고 깨끗한 문제만) */
async function cropPdf(nbId: string, pdfUri: string, pdfIndex: number, pageW: number, box: Box): Promise<{ img: string; w: number; h: number }> {
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const k = Math.min(2.4, MAX_PX / bw);
  const uri = await pageImage(nbId, pdfUri, pdfIndex, Math.round(pageW * k));
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error("쪽 그림을 읽지 못했어요");
  const s = image.width() / pageW; // 실제 그림의 pt당 픽셀
  const w = Math.max(1, Math.round(bw * s)), h = Math.max(1, Math.round(bh * s));
  const img = encode((c) => {
    c.drawImageRect(image, Skia.XYWHRect(box[0] * s, box[1] * s, bw * s, bh * s), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
  }, w, h);
  return { img, w: bw, h: bh };
}

/** PDF가 아닌 쪽(손으로 쓴 문제): 속지와 필기(빨간 사선은 빼고)를 그려 box만 */
function cropInk(page: Notebook["pages"][number], strokes: Stroke[], box: Box): { img: string; w: number; h: number } {
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const k = Math.min(2.4, MAX_PX / bw);
  const paper = paperPicture(page);
  const ink = inkPicture(strokes.filter((s) => !isWrongSlash(s)), new Set(), page.w, page.h, new WeakMap());
  const img = encode((c) => {
    c.scale(k, k);
    c.translate(-box[0], -box[1]);
    if (paper) c.drawPicture(paper);
    c.drawPicture(ink);
  }, Math.round(bw * k), Math.round(bh * k));
  return { img, w: bw, h: bh };
}

/** 고른 노트들에서 틀린 문제를 모아 새 '오답 노트'를 만든다. 찾은 문제가 없으면 null */
export async function makeWrongNote(store: NoteStore, picked: Notebook[], onProgress: (done: number, total: number) => void): Promise<{ id: string; count: number } | null> {
  const items: WrongItem[] = [];
  const notes: { nb: Notebook; ink: Record<string, Stroke[]>; uri: string | null }[] = [];
  for (const p of picked) {
    const nb = await store.load(p.id);
    if (!nb) continue;
    notes.push({ nb, ink: await store.loadInk(nb), uri: nb.hasPdf ? await store.pdfUri(nb.id) : null });
  }
  const todo = notes.flatMap(({ nb, ink, uri }) => nb.pages.map((page, i) => ({ nb, page, i, strokes: ink[page.id] ?? [], uri })).filter((x) => x.strokes.some(isWrongSlash)));
  let done = 0;
  onProgress(0, todo.length);
  for (const { nb, page, i, strokes, uri } of todo) {
    let chars = null;
    if (uri && page.pdf !== undefined) {
      try {
        chars = await pageText(uri, page.pdf);
      } catch {
        chars = null; // 글을 못 읽으면 사선 둘레를 자른다
      }
    }
    for (const q of wrongQuestions(strokes, chars, page.w, page.h)) {
      try {
        const pic = uri && page.pdf !== undefined ? await cropPdf(nb.id, uri, page.pdf, page.w, q.box) : cropInk(page, strokes, q.box);
        items.push({ source: nb.title, page: i + 1, num: q.num, ...pic });
      } catch {
        // 이 문제는 빼고 계속
      }
    }
    onProgress(++done, todo.length);
  }
  if (!items.length) return null;
  const d = new Date();
  const { nb, ink } = layoutWrongNote(`오답 노트 ${d.getMonth() + 1}월 ${d.getDate()}일`, items, d.getTime());
  await store.importUnpacked({ nb, ink, pdf: null });
  return { id: nb.id, count: items.length };
}
