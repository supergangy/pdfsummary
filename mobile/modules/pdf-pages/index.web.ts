// 웹판: pdf.js(public/pdfjs)로 쪽 크기를 읽고 쪽을 그린다.
export type PageSize = { w: number; h: number };

export const available = true;

export type PdfChar = [string, number, number, number, number];

type TextItem = { str: string; transform: number[]; width: number; hasEOL?: boolean };

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: TextItem[] }>;
    getViewport(o: { scale: number }): { width: number; height: number; transform: number[]; scale: number };
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

function mul(m: number[], n: number[]): number[] {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** pdf.js 글자 조각 → 글자 상자 (조각 폭을 글자 수로 나눔). 가로쓰기만. */
export async function pageText(uri: string, index: number): Promise<PdfChar[] | null> {
  const page = await (await open(uri)).getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const out: PdfChar[] = [];
  for (const it of items) {
    if (!it.str) {
      if (it.hasEOL && out.length) out.push(["\n", out[out.length - 1][3], out[out.length - 1][2], out[out.length - 1][3], out[out.length - 1][4]]);
      continue;
    }
    const m = mul(vp.transform, it.transform);
    const fh = Math.hypot(m[2], m[3]);
    const x0 = m[4], top = m[5] - fh, w = it.width * vp.scale;
    const chars = [...it.str];
    const cw = w / chars.length;
    chars.forEach((c, i) => out.push([c, x0 + cw * i, top, x0 + cw * (i + 1), m[5] + fh * 0.2]));
    if (it.hasEOL) out.push(["\n", x0 + w, top, x0 + w, m[5]]);
  }
  return out;
}
