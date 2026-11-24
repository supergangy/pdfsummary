// 획·속지를 Skia 그림(Picture)으로. 필기 화면과 쪽 모아보기가 함께 쓴다.
import { BlendMode, FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, StrokeJoin, createPicture, type SkImage, type SkPath } from "@shopify/react-native-skia";

import { strokeDraw, type StrokeDraw } from "./geometry";
import type { Page, Stroke } from "./model";

/** 획 객체마다 그리는 방법과 경로를 기억한다 (옮기거나 바꾼 획은 새 객체라 다시 만든다) */
export type PathCache = WeakMap<Stroke, { draw: StrokeDraw; path: SkPath } | null>;

/** 쪽에 붙인 사진·그림 스티커를 푼 그림 (획 객체마다 한 번만 푼다) */
const images = new WeakMap<Stroke, SkImage | null>();
export function strokeImage(s: Stroke): SkImage | null {
  if (!images.has(s)) {
    let img: SkImage | null = null;
    try {
      const b64 = s.img?.slice(s.img.indexOf(",") + 1);
      if (b64) img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64));
    } catch {
      img = null;
    }
    images.set(s, img);
  }
  return images.get(s) ?? null;
}

/** fade: 강의 녹음을 재생하는 중 — 그 녹음의 ms 뒤에 쓴 획은 흐리게 (아직 '안 쓴' 것처럼) */
export type Fade = { rec: string; ms: number } | null;

export function inkPicture(strokes: Stroke[], hidden: Set<string>, w: number, h: number, cache: PathCache, fade: Fade = null) {
  const get = (s: Stroke) => {
    if (!cache.has(s)) {
      const draw = strokeDraw(s);
      const path = draw?.d ? Skia.Path.MakeFromSVGString(draw.d) : null;
      cache.set(s, draw && path ? { draw, path } : null);
    }
    return cache.get(s) ?? null;
  };
  return createPicture((c) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    const paintOne = (s: Stroke) => {
      const g = get(s);
      if (!g) return;
      const { draw, path } = g;
      paint.setColor(Skia.Color(s.color));
      paint.setAlphaf(draw.alpha * (fade && s.rec === fade.rec && (s.rt ?? 0) > fade.ms ? 0.18 : 1));
      paint.setPathEffect(null);
      if (draw.kind === "fill") {
        paint.setStyle(PaintStyle.Fill);
        paint.setBlendMode(BlendMode.SrcOver);
      } else {
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(draw.width);
        paint.setStrokeCap(draw.cap === "butt" ? StrokeCap.Butt : StrokeCap.Round);
        paint.setStrokeJoin(StrokeJoin.Round);
        paint.setBlendMode(draw.multiply ? BlendMode.Multiply : BlendMode.SrcOver);
        if (draw.dash) paint.setPathEffect(Skia.PathEffect.MakeDash(draw.dash, 0));
      }
      c.drawPath(path, paint);
    };
    // 사진·그림 스티커가 맨 밑 (그 위에 칠하고 쓸 수 있게), 그다음 형광펜, 맨 위에 글씨
    const ip = Skia.Paint();
    ip.setAntiAlias(true);
    for (const s of strokes) {
      if (s.tool !== "image" || hidden.has(s.id)) continue;
      const img = strokeImage(s);
      if (!img) continue;
      const [x0, y0, , x1, y1] = s.pts;
      c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(x0, y0, x1 - x0, y1 - y0), FilterMode.Linear, MipmapMode.Linear, ip);
    }
    // 형광펜은 글씨 밑에 깔리게 먼저
    for (const s of strokes) if (s.tool === "highlighter" && !hidden.has(s.id)) paintOne(s);
    for (const s of strokes) if (s.tool === "pen" && !hidden.has(s.id)) paintOne(s);
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
