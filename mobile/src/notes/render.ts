// 획·속지를 Skia 그림(Picture)으로. 필기 화면과 쪽 모아보기가 함께 쓴다.
import { BlendMode, PaintStyle, Skia, StrokeCap, StrokeJoin, createPicture, type SkPath } from "@shopify/react-native-skia";

import { strokeSvg } from "./geometry";
import { HIGHLIGHT_OPACITY, type Page, type Stroke } from "./model";

export function inkPicture(strokes: Stroke[], hidden: Set<string>, w: number, h: number, cache: Map<string, SkPath | null>) {
  const get = (s: Stroke) => {
    if (!cache.has(s.id)) cache.set(s.id, Skia.Path.MakeFromSVGString(strokeSvg(s)));
    return cache.get(s.id) ?? null;
  };
  return createPicture((c) => {
    const hl = Skia.Paint();
    hl.setStyle(PaintStyle.Stroke);
    hl.setStrokeCap(StrokeCap.Butt);
    hl.setStrokeJoin(StrokeJoin.Round);
    hl.setBlendMode(BlendMode.Multiply);
    hl.setAntiAlias(true);
    const pen = Skia.Paint();
    pen.setStyle(PaintStyle.Fill);
    pen.setAntiAlias(true);
    // 형광펜은 글씨 밑에 깔리게 먼저
    for (const s of strokes) {
      if (s.tool !== "highlighter" || hidden.has(s.id)) continue;
      const p = get(s);
      if (!p) continue;
      hl.setColor(Skia.Color(s.color));
      hl.setAlphaf(HIGHLIGHT_OPACITY);
      hl.setStrokeWidth(s.width);
      c.drawPath(p, hl);
    }
    for (const s of strokes) {
      if (s.tool !== "pen" || hidden.has(s.id)) continue;
      const p = get(s);
      if (!p) continue;
      pen.setColor(Skia.Color(s.color));
      c.drawPath(p, pen);
    }
  }, { width: w, height: h });
}

/** 빈 속지 무늬 (줄·모눈·점). PDF 쪽이면 없음. */
export function paperPicture(page: Page) {
  if (page.pdf !== undefined || !page.paper || page.paper === "plain") return null;
  const kind = page.paper;
  return createPicture((c) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    if (kind === "lined") {
      p.setColor(Skia.Color("#B9D3EE"));
      p.setStrokeWidth(0.6);
      for (let y = 84; y < page.h - 30; y += 26) c.drawLine(36, y, page.w - 36, y, p);
      p.setColor(Skia.Color("#F2B8B8"));
      c.drawLine(64, 40, 64, page.h - 30, p);
    } else if (kind === "grid") {
      p.setColor(Skia.Color("#D5DEE8"));
      p.setStrokeWidth(0.5);
      for (let x = 18; x < page.w; x += 18) c.drawLine(x, 0, x, page.h, p);
      for (let y = 18; y < page.h; y += 18) c.drawLine(0, y, page.w, y, p);
    } else {
      p.setColor(Skia.Color("#B8BEC6"));
      for (let x = 18; x < page.w; x += 18) for (let y = 18; y < page.h; y += 18) c.drawCircle(x, y, 0.8, p);
    }
  }, { width: page.w, height: page.h });
}
