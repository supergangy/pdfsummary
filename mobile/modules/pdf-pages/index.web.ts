// 웹판: pdf.js(public/pdfjs)로 쪽 크기를 읽고 쪽을 그린다.
export type PageSize = { w: number; h: number };

export const available = true;

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number };
    render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void> };
  }>;
};

type Src = { url: string; cMapUrl: string; cMapPacked: boolean; standardFontDataUrl: string };
let lib: Promise<{ getDocument(src: Src): { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string } }> | null = null;
const docs = new Map<string, Promise<PdfDoc>>();
const images = new Map<string, Promise<string>>();

function pdfjs() {
  // 번들러가 건드리지 않게 import를 실행 시점에 만든다
  const load = new Function("u", "return import(u)") as (u: string) => Promise<never>;
  lib ??= load(new URL("/pdfjs/pdf.min.mjs", location.href).href).then((m: { GlobalWorkerOptions: { workerSrc: string } }) => {
    m.GlobalWorkerOptions.workerSrc = new URL("/pdfjs/pdf.worker.min.mjs", location.href).href;
    return m as never;
  });
  return lib;
}

function open(uri: string): Promise<PdfDoc> {
  let d = docs.get(uri);
  if (!d) {
    const base = new URL("/pdfjs/", location.href).href;
    d = pdfjs().then((m) => m.getDocument({ url: uri, cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/" }).promise);
    docs.set(uri, d);
  }
  return d;
}

export async function pdfInfo(uri: string): Promise<PageSize[]> {
  const doc = await open(uri);
  const out: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const v = (await doc.getPage(i)).getViewport({ scale: 1 });
    out.push({ w: v.width, h: v.height });
  }
  return out;
}

export function renderPage(uri: string, index: number, widthPx: number, _outPath: string): Promise<string> {
  const key = `${uri}#${index}@${Math.round(widthPx)}`;
  let p = images.get(key);
  if (!p) {
    p = (async () => {
      const page = await (await open(uri)).getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: widthPx / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.88));
      return URL.createObjectURL(blob);
    })();
    images.set(key, p);
  }
  return p;
}
