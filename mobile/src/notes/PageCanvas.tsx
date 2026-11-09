// 쪽 하나를 그리고 펜 입력을 받는 화면.
// - 펜(스타일러스)은 쓰고, 손가락은 '손가락으로 쓰기'가 꺼져 있으면 화면을 옮긴다 (손바닥이 닿아도 안 써짐)
// - 두 손가락: 확대·축소·이동
// - 지금 긋는 획은 UI 스레드에서 바로 그리고(지연 최소), 손을 떼면 JS 쪽에 넘겨 저장한다
import {
  BlendMode, Canvas, Circle, Group, Image, PaintStyle, Path, Picture, Rect, Skia, StrokeCap, StrokeJoin,
  createPicture, useImage, usePathValue, type SkPath,
} from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, PointerType, usePanGesture, usePinchGesture, useSimultaneousGestures } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { strokeSvg } from "./geometry";
import { HIGHLIGHT_OPACITY, type Page, type Stroke } from "./model";

export type ToolName = "pen" | "highlighter" | "eraser";
export type ZoomCmd = { kind: "in" | "out" | "fit"; n: number };

const MARGIN = 12;
const ERASER_PX = 12; // 화면에서 지우개 반지름

type Props = {
  page: Page;
  background: string | null; // 쪽 그림 주소 (PDF 쪽) — 빈 속지면 null
  strokes: Stroke[];
  hidden: Set<string>; // 지우는 중이라 잠깐 감춘 획
  tool: ToolName;
  color: string;
  width: number;
  fingerDraw: boolean;
  zoom: ZoomCmd;
  dark?: boolean;
  onStroke: (pts: number[], stylus: boolean) => void;
  onErase: (phase: 0 | 1 | 2, x: number, y: number, radius: number) => void;
  onViewWidth?: (pagePx: number) => void; // 쪽이 화면에서 몇 픽셀 폭인지 (바탕 그림 해상도용)
};

export function PageCanvas(props: Props) {
  const { page, background, strokes, hidden, tool, color, width, fingerDraw, zoom } = props;

  // ── 보기(확대·이동) ─────────────────────────────────────
  const scale = useSharedValue(1);
  const tx = useSharedValue(MARGIN);
  const ty = useSharedValue(MARGIN);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const pw = useSharedValue(page.w);
  const ph = useSharedValue(page.h);
  const minS = useSharedValue(0.2);
  const maxS = useSharedValue(8);
  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }]);

  const cb = useRef(props);
  cb.current = props;
  const emitStroke = useCallback((pts: number[], stylus: boolean) => cb.current.onStroke(pts, stylus), []);
  const emitErase = useCallback((phase: 0 | 1 | 2, x: number, y: number, r: number) => cb.current.onErase(phase, x, y, r), []);
  const emitScale = useCallback((s: number) => cb.current.onViewWidth?.(s * cb.current.page.w), []);

  const fit = useCallback(() => {
    const W = vw.value, H = vh.value;
    if (!W || !H) return;
    const s = Math.min((W - MARGIN * 2) / page.w, 6);
    minS.value = Math.min(s, (H - MARGIN * 2) / page.h) * 0.6;
    maxS.value = s * 6;
    scale.value = s;
    tx.value = MARGIN + Math.max(0, (W - MARGIN * 2 - page.w * s) / 2);
    ty.value = MARGIN;
    emitScale(s);
  }, [page.w, page.h, vw, vh, minS, maxS, scale, tx, ty, emitScale]);

  useEffect(() => {
    pw.value = page.w;
    ph.value = page.h;
    fit();
  }, [page.id, page.w, page.h, fit, pw, ph]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    const first = !vw.value;
    vw.value = w;
    vh.value = h;
    if (first || Math.abs(w - vw.value) > 1) fit();
    else fit();
  };

  // 도구 모음의 확대·축소·맞춤 단추
  useEffect(() => {
    if (!zoom.n) return;
    if (zoom.kind === "fit") return fit();
    const f = zoom.kind === "in" ? 1.25 : 0.8;
    const s = Math.max(minS.value, Math.min(maxS.value, scale.value * f));
    const cx = vw.value / 2, cy = vh.value / 2;
    const ax = (cx - tx.value) / scale.value, ay = (cy - ty.value) / scale.value;
    const [x, y] = clampXY(s, cx - ax * s, cy - ay * s, pw.value, ph.value, vw.value, vh.value);
    scale.value = s;
    tx.value = x;
    ty.value = y;
    emitScale(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom.n]);

  // ── 입력 ────────────────────────────────────────────────
  const toolSV = useSharedValue(0);
  const fingerSV = useSharedValue(fingerDraw);
  useEffect(() => {
    toolSV.value = tool === "pen" ? 0 : tool === "highlighter" ? 1 : 2;
  }, [tool, toolSV]);
  useEffect(() => {
    fingerSV.value = fingerDraw;
  }, [fingerDraw, fingerSV]);

  const mode = useSharedValue(0); // 0 없음, 1 쓰기, 2 손가락으로 옮기기, 3 지우기, 4 취소됨
  const started = useSharedValue(0);
  const stylus = useSharedValue(false);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const live = useSharedValue<number[]>([]);
  const eraser = useSharedValue({ x: -1000, y: -1000, r: 0 });

  const one = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      "worklet";
      const finger = e.pointerType === PointerType.TOUCH;
      if (finger && !fingerSV.value) {
        mode.value = 2;
        sx.value = tx.value;
        sy.value = ty.value;
        return;
      }
      const x = (e.x - tx.value) / scale.value;
      const y = (e.y - ty.value) / scale.value;
      if (toolSV.value === 2) {
        mode.value = 3;
        const r = ERASER_PX / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 0, x, y, r);
        return;
      }
      mode.value = 1;
      started.value = Date.now();
      stylus.value = e.pointerType === PointerType.STYLUS;
      const p = e.stylusData && e.stylusData.pressure > 0 ? e.stylusData.pressure : 0.5;
      live.value = [x, y, p];
    },
    onUpdate: (e) => {
      "worklet";
      if (mode.value === 2) {
        const [x, y] = clampXY(scale.value, sx.value + e.translationX, sy.value + e.translationY, pw.value, ph.value, vw.value, vh.value);
        tx.value = x;
        ty.value = y;
        return;
      }
      const x = (e.x - tx.value) / scale.value;
      const y = (e.y - ty.value) / scale.value;
      if (mode.value === 3) {
        const r = ERASER_PX / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 1, x, y, r);
        return;
      }
      if (mode.value === 1) {
        const p = e.stylusData && e.stylusData.pressure > 0 ? e.stylusData.pressure : 0.5;
        live.modify((a) => {
          "worklet";
          a.push(x, y, p);
          return a;
        }, true);
      }
    },
    onFinalize: (e) => {
      "worklet";
      if (mode.value === 1) {
        const pts = live.value.slice();
        if (e.canceled && pts.length <= 6) live.value = [];
        else scheduleOnRN(emitStroke, pts, stylus.value);
      } else if (mode.value === 3) {
        eraser.value = { x: -1000, y: -1000, r: 0 };
        scheduleOnRN(emitErase, 2, 0, 0, 0);
      } else if (mode.value === 4) {
        live.value = [];
      }
      mode.value = 0;
    },
  });

  const s0 = useSharedValue(1);
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const pinch = usePinchGesture({
    onActivate: (e) => {
      "worklet";
      // 두 번째 손가락이 바로 닿았으면 방금 시작한 획은 확대하려던 것
      if (mode.value === 1 && Date.now() - started.value < 350) {
        mode.value = 4;
        live.value = [];
      }
      s0.value = scale.value;
      ax.value = (e.focalX - tx.value) / scale.value;
      ay.value = (e.focalY - ty.value) / scale.value;
    },
    onUpdate: (e) => {
      "worklet";
      const s = Math.max(minS.value, Math.min(maxS.value, s0.value * e.scale));
      const [x, y] = clampXY(s, e.focalX - ax.value * s, e.focalY - ay.value * s, pw.value, ph.value, vw.value, vh.value);
      scale.value = s;
      tx.value = x;
      ty.value = y;
    },
    onFinalize: () => {
      "worklet";
      scheduleOnRN(emitScale, scale.value);
    },
  });
  const gesture = useSimultaneousGestures(one, pinch);

  // ── 그리기 ──────────────────────────────────────────────
  const livePath = usePathValue((b) => {
    "worklet";
    const a = live.value;
    if (a.length < 3) return;
    b.moveTo(a[0], a[1]);
    if (a.length === 3) b.lineTo(a[0] + 0.01, a[1]);
    for (let i = 3; i < a.length; i += 3) b.lineTo(a[i], a[i + 1]);
  });

  // 손을 떼면 부모가 획을 저장하고 새 strokes를 넘겨준다 → 그때 지금 획을 지운다 (깜빡임 없이)
  useEffect(() => {
    live.value = [];
  }, [strokes, live]);

  const paths = useRef(new Map<string, SkPath | null>());
  const picture = useMemo(() => {
    const cache = paths.current;
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
    }, { width: page.w, height: page.h });
  }, [strokes, hidden, page.w, page.h]);

  const paper = useMemo(() => paperPicture(page), [page]);
  const image = useImage(background ?? undefined);

  const hlLive = tool === "highlighter";
  const liveWidth = hlLive ? width : width * 1.25;

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1, overflow: "hidden" }} onLayout={onLayout} testID="page-canvas">
        <Canvas style={{ flex: 1, backgroundColor: props.dark ? "#2A2C30" : "#E7E4DE" }}>
          <Group transform={transform}>
            <Rect x={-0.5} y={-0.5} width={page.w + 1} height={page.h + 1} color="rgba(0,0,0,0.18)" />
            <Rect x={0} y={0} width={page.w} height={page.h} color="#FFFFFF" />
            {image ? <Image image={image} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
            {paper ? <Picture picture={paper} /> : null}
            <Picture picture={picture} />
            <Path
              path={livePath}
              style="stroke"
              strokeWidth={liveWidth}
              strokeCap={hlLive ? "butt" : "round"}
              strokeJoin="round"
              color={color}
              opacity={hlLive ? HIGHLIGHT_OPACITY : 1}
              blendMode={hlLive ? "multiply" : "srcOver"}
            />
            <EraserRing eraser={eraser} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

function EraserRing({ eraser }: { eraser: { value: { x: number; y: number; r: number } } }) {
  const cx = useDerivedValue(() => eraser.value.x);
  const cy = useDerivedValue(() => eraser.value.y);
  const r = useDerivedValue(() => eraser.value.r);
  const sw = useDerivedValue(() => Math.max(0.3, eraser.value.r / 10));
  return <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={sw} color="rgba(60,60,60,0.7)" />;
}

/** 빈 속지 무늬 (줄·모눈·점). PDF 쪽이면 없음. */
function paperPicture(page: Page) {
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

/** 쪽이 화면보다 작으면 가운데, 크면 가장자리(여백 포함)를 넘어 끌리지 않게. */
function clampXY(s: number, x: number, y: number, pw: number, ph: number, vw: number, vh: number): [number, number] {
  "worklet";
  const w = pw * s, h = ph * s;
  const cx = w + MARGIN * 2 <= vw ? (vw - w) / 2 : Math.min(MARGIN, Math.max(vw - w - MARGIN, x));
  const cy = h + MARGIN * 2 <= vh ? Math.min(Math.max(MARGIN, y), vh - h - MARGIN) : Math.min(MARGIN, Math.max(vh - h - MARGIN, y));
  return [cx, cy];
}
