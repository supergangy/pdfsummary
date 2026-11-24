// 획·속지를 Skia 그림(Picture)으로. 필기 화면과 쪽 모아보기가 함께 쓴다.
import { BlendMode, FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, StrokeJoin, createPicture, type SkImage, type SkPath, type SkTypeface } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";

import { koreanFont } from "./fontBytes";

import { strokeDraw, type StrokeDraw } from "./geometry";
import type { Page, Stroke } from "./model";
import { paperHasText, paperMarks } from "./paperTemplates";

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
      // 돌린 사진·스티커: 상자 가운데를 축으로 돌려 그린다
      if (s.rot) {
        c.save();
        c.rotate(s.rot, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(x0, y0, x1 - x0, y1 - y0), FilterMode.Linear, MipmapMode.Linear, ip);
      if (s.rot) c.restore();
    }
    // 형광펜은 글씨 밑에 깔리게 먼저
    for (const s of strokes) if (s.tool === "highlighter" && !hidden.has(s.id)) paintOne(s);
    for (const s of strokes) if (s.tool === "pen" && !hidden.has(s.id)) paintOne(s);
  }, { width: w, height: h });
}

// 서식의 칸 이름(코넬 노트 '요약', 달력 요일 등)을 쓰는 한글 글꼴 — 앱에 든 나눔고딕을 한 번만 읽는다
let paperTf: SkTypeface | null = null;
let paperTfLoad: Promise<SkTypeface | null> | null = null;
function loadPaperTypeface(): Promise<SkTypeface | null> {
  paperTfLoad ??= koreanFont()
    .then((bytes) => (paperTf = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(bytes))))
    .catch(() => null);
  return paperTfLoad;
}
/** 이 속지에 글이 있으면 글꼴을 읽어 오고, 다 읽으면 다시 그리게 한다 */
export function usePaperFont(papers: (Page["paper"] | undefined)[]): SkTypeface | null {
  const need = papers.some((p) => paperHasText(p));
  const [tf, setTf] = useState<SkTypeface | null>(paperTf);
  useEffect(() => {
    if (need && !tf) {
      let live = true;
      void loadPaperTypeface().then((t) => live && t && setTf(t));
      return () => { live = false; };
    }
  }, [need, tf]);
  return tf;
}

/** 빈 속지 무늬 (줄·모눈·점·서식). PDF 쪽이면 없음. tf: 칸 이름 글꼴 (아직 없으면 글만 빼고 그린다) */
export function paperPicture(page: Page, tf?: SkTypeface | null) {
  if (page.pdf !== undefined || !page.paper || page.paper === "plain") return null;
  const marks = paperMarks(page.paper, page.w, page.h);
  if (!marks.length) return null;
  return createPicture((c) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    for (const m of marks) {
      if (m.k === "line") {
        p.setStyle(PaintStyle.Stroke);
        p.setColor(Skia.Color(m.color));
        p.setStrokeWidth(m.w);
        c.drawLine(m.x1, m.y1, m.x2, m.y2, p);
      } else if (m.k === "dot") {
        p.setStyle(PaintStyle.Fill);
        p.setColor(Skia.Color(m.color));
        c.drawCircle(m.x, m.y, m.r, p);
      } else if (m.k === "rect") {
        const r = Skia.XYWHRect(m.x, m.y, m.w, m.h);
        if (m.fill) {
          p.setStyle(PaintStyle.Fill);
          p.setColor(Skia.Color(m.fill));
          c.drawRect(r, p);
        }
        if (m.stroke) {
          p.setStyle(PaintStyle.Stroke);
          p.setColor(Skia.Color(m.stroke));
          p.setStrokeWidth(m.sw ?? 1);
          c.drawRect(r, p);
        }
      } else if (tf) {
        const font = Skia.Font(tf, m.size);
        p.setStyle(PaintStyle.Fill);
        p.setColor(Skia.Color(m.color));
        const x = m.center ? m.x - font.measureText(m.text).width / 2 : m.x;
        c.drawText(m.text, x, m.y, p, font);
      }
    }
  }, { width: page.w, height: page.h });
}
