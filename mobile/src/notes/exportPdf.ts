// 필기를 넣은 PDF 만들기 (기기 안에서, 인터넷 없이). 원본 PDF 쪽 위에 획을 벡터로 그린다.
// 쪽 좌표(화면에 보이는 대로, 왼쪽 위가 0)를 PDF 사용자 좌표(왼쪽 아래가 0, 자르기 상자·회전 반영)로 바꾼다.
import fontkit from "@pdf-lib/fontkit";
import { BlendMode, LineCapStyle, PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import { penOutline, strokeDraw } from "./geometry.ts";
import { type Ink, type Notebook, type Paper, type Stroke } from "./model.ts";

type Box = { x: number; y: number; width: number; height: number };

/** 화면 좌표(u, v) → PDF 사용자 좌표(X, Y). rotation은 /Rotate 값(0·90·180·270). */
export function toUser(u: number, v: number, crop: Box, rotation: number): [number, number] {
  const r = ((rotation % 360) + 360) % 360;
  const { x: cx, y: cy, width: cw, height: ch } = crop;
  if (r === 90) return [cx + v, cy + u];
  if (r === 180) return [cx + cw - u, cy + v];
  if (r === 270) return [cx + cw - v, cy + ch - u];
  return [cx + u, cy + ch - v];
}

function hex(c: string) {
  const n = parseInt(c.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** drawSvgPath는 SVG 좌표의 y를 뒤집어 그리므로, 사용자 좌표 (X, Y)를 (X, -Y)로 넘긴다. */
function svgUser(points: number[][], crop: Box, rot: number, close: boolean): string {
  let d = "";
  points.forEach(([u, v], i) => {
    const [X, Y] = toUser(u, v, crop, rot);
    d += `${i ? "L" : "M"}${f(X)},${f(-Y)}`;
  });
  return close ? d + "Z" : d;
}

function drawStroke(page: PDFPage, s: Stroke, crop: Box, rot: number) {
  const draw = strokeDraw(s);
  if (!draw) return;
  if (draw.kind === "fill") {
    const outline = penOutline(s);
    if (outline.length < 3) return;
    page.drawSvgPath(svgUser(outline, crop, rot, true), { x: 0, y: 0, color: hex(s.color), opacity: draw.alpha, borderWidth: 0 });
    return;
  }
  const pts: number[][] = [];
  for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i], s.pts[i + 1]]);
  if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]]);
  page.drawSvgPath(svgUser(pts, crop, rot, false), {
    x: 0,
    y: 0,
    borderColor: hex(s.color),
    borderWidth: draw.width,
    borderOpacity: draw.alpha,
    borderLineCap: draw.cap === "butt" ? LineCapStyle.Butt : LineCapStyle.Round,
    ...(draw.dash ? { borderDashArray: draw.dash, borderDashPhase: 0 } : {}),
    blendMode: draw.multiply ? BlendMode.Multiply : BlendMode.Normal,
  });
}

/** 글상자: 폭 안에서 줄을 나눠 위에서부터 쓴다 (한글 글꼴을 넣어서) */
function drawText(page: PDFPage, s: Stroke, crop: Box, rot: number, font: PDFFont) {
  const [x0, y0, x1] = [s.pts[0], s.pts[1], s.pts[3]];
  const size = s.width, w = x1 - x0, lh = size * 1.4;
  const lines: string[] = [];
  for (const para of (s.text ?? "").split("\n")) {
    let cur = "";
    for (const ch of para) {
      if (cur && font.widthOfTextAtSize(cur + ch, size) > w) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    lines.push(cur);
  }
  lines.forEach((line, i) => {
    if (!line) return;
    // 줄의 글자 바탕선 왼쪽 끝 (화면 좌표) → PDF 좌표
    const [X, Y] = toUser(x0, y0 + i * lh + size * 1.05, crop, rot);
    page.drawText(line, { x: X, y: Y, size, font, color: hex(s.color), rotate: degrees(((rot % 360) + 360) % 360) });
  });
}

/** data:image/...;base64,… → 바이트 (Node·기기 모두에서 되게 직접 푼다) */
export function dataUriBytes(uri: string): Uint8Array {
  const b64 = uri.slice(uri.indexOf(",") + 1).replace(/[^A-Za-z0-9+/]/g, "");
  const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let n = 0, bits = 0, acc = 0;
  for (const ch of b64) {
    acc = (acc << 6) | T.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, n);
}

/** 사진·그림 스티커: 상자 왼쪽 아래를 기준으로 쪽 회전만큼 돌려 그린다 */
function drawImageBox(page: PDFPage, img: PDFImage, s: Stroke, crop: Box, rot: number) {
  const [x0, y0, , x1, y1] = s.pts;
  const [X, Y] = toUser(x0, y1, crop, rot);
  page.drawImage(img, { x: X, y: Y, width: x1 - x0, height: y1 - y0, rotate: degrees(((rot % 360) + 360) % 360) });
}

/** 도장 스티커: 테두리 + 옅은 바탕 상자, 가운데에 굵게 글 */
function drawStamp(page: PDFPage, s: Stroke, crop: Box, rot: number, font: PDFFont) {
  const [x0, y0, , x1, y1] = s.pts;
  const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  page.drawSvgPath(svgUser(box, crop, rot, true), { x: 0, y: 0, color: hex(s.color), opacity: 0.12, borderColor: hex(s.color), borderWidth: Math.max(1, s.width * 0.1) });
  const text = s.text ?? "";
  const tw = font.widthOfTextAtSize(text, s.width);
  const [X, Y] = toUser(x0 + (x1 - x0 - tw) / 2, (y0 + y1) / 2 + s.width * 0.36, crop, rot);
  page.drawText(text, { x: X, y: Y, size: s.width, font, color: hex(s.color), rotate: degrees(((rot % 360) + 360) % 360) });
}

function drawPaper(page: PDFPage, paper: Paper | undefined, w: number, h: number) {
  if (!paper || paper === "plain") return;
  if (paper === "lined") {
    for (let y = 84; y < h - 30; y += 26) page.drawLine({ start: { x: 36, y: h - y }, end: { x: w - 36, y: h - y }, thickness: 0.6, color: rgb(0.73, 0.83, 0.93) });
    page.drawLine({ start: { x: 64, y: h - 40 }, end: { x: 64, y: 30 }, thickness: 0.6, color: rgb(0.95, 0.72, 0.72) });
  } else if (paper === "grid") {
    for (let x = 18; x < w; x += 18) page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.5, color: rgb(0.84, 0.87, 0.91) });
    for (let y = 18; y < h; y += 18) page.drawLine({ start: { x: 0, y: h - y }, end: { x: w, y: h - y }, thickness: 0.5, color: rgb(0.84, 0.87, 0.91) });
  } else {
    for (let x = 18; x < w; x += 18) for (let y = 18; y < h; y += 18) page.drawCircle({ x, y: h - y, size: 0.8, color: rgb(0.72, 0.75, 0.78) });
  }
}

/**
 * 노트를 PDF로. source: 원본 PDF 바이트(없으면 빈 속지만).
 * 원본의 쪽을 노트의 쪽 순서대로 복사하고(빈 쪽은 새로 만들고), 그 위에 획을 그린다.
 */
export async function buildPdf(nb: Notebook, ink: Ink, source: Uint8Array | null, fontBytes?: Uint8Array | null): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const hasText = Object.values(ink).some((ss) => ss.some((s) => s.tool === "text" && s.text));
  let font: PDFFont | null = null;
  if (hasText && fontBytes) {
    out.registerFontkit(fontkit);
    // 글꼴을 통째로 넣는다. '쓴 글자만 넣기'(subset)는 나눔고딕에서 글자 모양을 망가뜨려
    // 글상자 글이 대부분 안 보였다. 대신 글상자가 있는 PDF는 0.7MB쯤 커진다.
    font = await out.embedFont(fontBytes, { subset: false });
  }
  out.setTitle(nb.title);
  out.setProducer("필기 요약");
  const src = source ? await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false }) : null;
  const wanted = nb.pages.map((p) => (p.pdf !== undefined && src && p.pdf < src.getPageCount() ? p.pdf : -1));
  const copied = src ? await out.copyPages(src, wanted.filter((i) => i >= 0)) : [];
  // 사진은 같은 그림이면 한 번만 넣는다
  const embedded = new Map<string, PDFImage | null>();
  for (const ss of Object.values(ink)) {
    for (const s of ss) {
      if (s.tool !== "image" || !s.img || embedded.has(s.img)) continue;
      try {
        const bytes = dataUriBytes(s.img);
        embedded.set(s.img, s.img.startsWith("data:image/png") ? await out.embedPng(bytes) : await out.embedJpg(bytes));
      } catch {
        embedded.set(s.img, null); // 못 읽는 그림은 빼고 만든다
      }
    }
  }
  let k = 0;
  nb.pages.forEach((p, i) => {
    let page: PDFPage;
    if (wanted[i] >= 0) {
      page = copied[k++];
      out.addPage(page);
    } else {
      page = out.addPage([p.w, p.h]);
      drawPaper(page, p.paper, p.w, p.h);
    }
    const crop = page.getCropBox();
    const rot = page.getRotation().angle;
    const strokes = ink[p.id] ?? [];
    // 사진이 맨 밑, 그다음 형광펜(글씨 밑에), 글씨, 글상자·도장
    for (const s of strokes) {
      const img = s.tool === "image" && s.img ? embedded.get(s.img) : null;
      if (img) drawImageBox(page, img, s, crop, rot);
    }
    for (const s of strokes) if (s.tool === "highlighter") drawStroke(page, s, crop, rot);
    for (const s of strokes) if (s.tool === "pen") drawStroke(page, s, crop, rot);
    if (font) for (const s of strokes) if (s.tool === "text" && s.text) (s.stamp ? drawStamp : drawText)(page, s, crop, rot, font);
  });
  return out.save();
}
