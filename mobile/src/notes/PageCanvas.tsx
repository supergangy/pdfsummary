// 쪽 하나를 그리고 펜 입력을 받는 화면.
// - 펜(스타일러스)은 쓰고, 손가락은 '손가락으로 쓰기'가 꺼져 있으면 화면을 옮긴다 (손바닥이 닿아도 안 써짐)
// - 두 손가락: 확대·축소·이동
// - 지금 긋는 획은 UI 스레드에서 바로 그리고(지연 최소), 손을 떼면 JS 쪽에 넘겨 저장한다
// - S펜 옆 단추를 누른 채 쓰면 지우개 (펜이 떠 있을 때부터 단추 상태를 알 수 있다)
// - 손가락으로 밀고 놓으면 조금 더 미끄러진다 (관성)
// - 필기가 많은 쪽은 화면이 움직이는 동안(끌기·확대·관성) 쪽 전체를 한 장의 사진으로 그리고, 멈추면 선명한 원본으로 돌아온다
//   (삼성 노트처럼: 획 수백 개를 장면마다 다시 그리지 않게)
import { Canvas, Circle, DashPathEffect, FilterMode, Group, Image, MipmapMode, Path, Picture, Rect, Skia, useImage, usePathValue, type SkImage, type SkPicture } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PixelRatio, Platform, Text, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, PointerType, usePanGesture, usePinchGesture, useSimultaneousGestures } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useDerivedValue, useSharedValue, withDecay, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { StylusView } from "../../modules/stylus";
import type { LineDash, Page, Stroke } from "./model";
import { inkPicture, paperPicture, type PathCache } from "./render";

export type ToolName = "pen" | "highlighter" | "eraser" | "lasso" | "text";
/** 움직이는 동안 쓸 쪽 사진에 담을 것 */
type SnapContent = { ver: number; bg: SkImage | null; paper: SkPicture | null; ink: SkPicture };
export type Selection = { ids: Set<string>; box: [number, number, number, number] } | null;
export type ZoomCmd = { kind: "in" | "out" | "fit"; n: number };

const MARGIN = 12;
/** 필기(글상자 빼고)가 이만큼 넘는 쪽은 움직이는 동안 쪽 사진으로 그린다. 적은 쪽은 원본도 충분히 빨라서 선명한 채로 둔다 */
export const HEAVY_STROKES = 80;
/** 쪽 사진의 가로 픽셀 한도 (웹은 사진을 CPU로 만들어 더 작게) */
const SNAP_MAX = Platform.OS === "web" ? 1200 : 2048;
/** 사진은 기기에서는 GPU로 만든다 (화면을 그리는 스레드와 같은 문맥이라 바로 쓸 수 있다). 웹은 화면 밖 그림판마다 따로 문맥이 생겨 CPU로 */
const SNAP_GPU = Platform.OS !== "web";

type Props = {
  page: Page;
  background: string | null; // 쪽 그림 주소 (PDF 쪽) — 빈 속지면 null
  strokes: Stroke[];
  hidden: Set<string>; // 지우는 중이라 잠깐 감춘 획
  tool: ToolName;
  color: string;
  width: number;
  opacity: number; // 형광펜 투명도
  dash: LineDash; // 펜 선 모양
  eraserPx: number; // 화면에서 지우개 반지름
  lassoRect: boolean; // 사각형 올가미
  fingerDraw: boolean;
  zoom: ZoomCmd;
  dark?: boolean;
  onStroke: (pts: number[], stylus: boolean) => void;
  onErase: (phase: 0 | 1 | 2, x: number, y: number, radius: number) => void;
  selection?: Selection;
  onLasso?: (pts: number[]) => void; // 올가미를 다 그렸을 때
  onMoveSelection?: (dx: number, dy: number) => void; // 고른 것을 끌어 옮겼을 때
  onTextTap?: (x: number, y: number) => void; // 글상자 도구로 쪽을 눌렀을 때
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
  const emitTextTap = useCallback((x: number, y: number) => cb.current.onTextTap?.(x, y), []);
  const emitLasso = useCallback((pts: number[]) => cb.current.onLasso?.(pts), []);
  const emitMove = useCallback((dx: number, dy: number) => cb.current.onMoveSelection?.(dx, dy), []);
  const emitScale = useCallback((s: number) => cb.current.onViewWidth?.(s * cb.current.page.w), []);

  // 움직이는 동안 쓸 쪽 사진의 pt당 픽셀 (맞춤 보기의 화면 픽셀만큼, 너무 크지 않게)
  const snapK = useSharedValue(1);
  const snapVer = useSharedValue(-1); // 사진을 만든 때의 내용 번호 (-1 = 사진 없음·낡음)
  const requestSnap = useRef(() => {}); // 잠시 뒤 쪽 사진을 만들어 두라고 부탁 (아래에서 채운다)

  const fit = useCallback((W: number = vw.value, H: number = vh.value) => {
    if (!W || !H) return;
    const s = Math.min((W - MARGIN * 2) / page.w, 6);
    minS.value = Math.min(s, (H - MARGIN * 2) / page.h) * 0.6;
    maxS.value = s * 6;
    scale.value = s;
    tx.value = MARGIN + Math.max(0, (W - MARGIN * 2 - page.w * s) / 2);
    ty.value = MARGIN;
    snapK.value = Math.max(0.5, Math.min(SNAP_MAX / page.w, 4096 / page.h, s * PixelRatio.get()));
    snapVer.value = -1;
    requestSnap.current();
    emitScale(s);
  }, [page.w, page.h, vw, vh, minS, maxS, scale, tx, ty, snapK, snapVer, emitScale]);

  useEffect(() => {
    pw.value = page.w;
    ph.value = page.h;
    fit();
  }, [page.id, page.w, page.h, fit, pw, ph]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    vw.value = w;
    vh.value = h;
    // 방금 쓴 공유 값은 JS 쪽에서 곧바로 읽으면 예전 값(처음엔 0)이 나온다 → 크기를 직접 넘긴다
    // (그래서 새 노트가 '맞춤' 크기가 아니라 작게 열리곤 했다)
    fit(w, h);
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
  const eraserPx = useSharedValue(props.eraserPx);
  const rectSV = useSharedValue(props.lassoRect);
  useEffect(() => {
    eraserPx.value = props.eraserPx;
    rectSV.value = props.lassoRect;
  }, [props.eraserPx, props.lassoRect, eraserPx, rectSV]);
  useEffect(() => {
    toolSV.value = tool === "pen" ? 0 : tool === "highlighter" ? 1 : tool === "eraser" ? 2 : tool === "lasso" ? 3 : 4;
  }, [tool, toolSV]);
  // 고른 것(올가미) 상자와 끄는 중 옮긴 거리
  const sel = props.selection ?? null;
  const selBox = useSharedValue<number[]>([0, 0, 0, 0]);
  const hasSel = useSharedValue(false);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  useEffect(() => {
    hasSel.value = !!sel && sel.ids.size > 0;
    if (sel) selBox.value = [...sel.box];
    dragX.value = 0;
    dragY.value = 0;
  }, [sel, hasSel, selBox, dragX, dragY]);
  useEffect(() => {
    fingerSV.value = fingerDraw;
  }, [fingerDraw, fingerSV]);

  const mode = useSharedValue(0); // 0 없음, 1 쓰기, 2 손가락으로 옮기기, 3 지우기, 4 취소됨, 5 고른 것 끌기, 6 올가미 그리기
  const started = useSharedValue(0);
  const stylus = useSharedValue(false);
  const touch = useSharedValue(false); // 지금 획을 손가락으로 쓰고 있는지
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const live = useSharedValue<number[]>([]);
  const eraser = useSharedValue({ x: -1000, y: -1000, r: 0 });
  const penBtn = useSharedValue(false); // S펜 옆 단추를 누르고 있는지
  const onPenButton = useCallback((pressed: boolean) => {
    penBtn.value = pressed;
  }, [penBtn]);

  // ── 움직이는 동안: 관성, 쪽 사진 ─────────────────────────
  const moving = useSharedValue(false); // 끌기·확대·관성으로 화면이 움직이는 중
  const pinching = useSharedValue(false);
  const flings = useSharedValue(0); // 아직 미끄러지는 중인 축 수 (가로·세로)
  const lastMove = useSharedValue({ at: 0, x: 0, y: 0 }); // 손가락으로 옮기다 마지막으로 움직인 때 (멈췄다 떼면 미끄러지지 않게)
  const heavy = useSharedValue(false); // 필기가 많은 쪽
  const content = useSharedValue<SnapContent | null>(null); // 사진에 담을 것 (바뀔 때마다 ver가 오른다)
  const snap = useSharedValue<SkImage | null>(null);
  const snapPrev = useSharedValue<SkImage | null>(null);
  const snapWanted = useSharedValue(false); // 움직이거나 쓰는 중이라 못 만든 사진이 있다

  /** 필기가 많은 쪽이면 쪽 사진(바탕 그림 + 속지 + 필기를 한 장으로)을 만든다. 내용이 그대로면 있던 사진을 쓴다.
   *  UI 스레드에서 GPU로 그리지만 획 300개 쪽에서 30ms쯤 걸린다 (갤럭시탭에서 잼) → 끌기를 시작할 때가 아니라
   *  손을 쉬고 있을 때 미리 만든다 (requestSnap). 움직이거나 쓰는 중이면 미뤘다가 끝나면 다시 만든다. */
  const makeSnap = () => {
    "worklet";
    const c = content.value;
    if (!c || !heavy.value || snapVer.value === c.ver) return;
    if (moving.value || mode.value !== 0) {
      snapWanted.value = true;
      return;
    }
    try {
      const k = snapK.value;
      const surface = SNAP_GPU
        ? Skia.Surface.MakeOffscreen(Math.max(1, Math.round(pw.value * k)), Math.max(1, Math.round(ph.value * k)))
        : Skia.Surface.Make(Math.max(1, Math.round(pw.value * k)), Math.max(1, Math.round(ph.value * k)));
      if (!surface) return;
      const cv = surface.getCanvas();
      cv.drawColor(Skia.Color("#FFFFFF"));
      cv.scale(k, k);
      if (c.bg) {
        const src = Skia.XYWHRect(0, 0, c.bg.width(), c.bg.height());
        cv.drawImageRectOptions(c.bg, src, Skia.XYWHRect(0, 0, pw.value, ph.value), FilterMode.Linear, MipmapMode.None, null);
      }
      if (c.paper) cv.drawPicture(c.paper);
      cv.drawPicture(c.ink);
      surface.flush();
      const img = surface.makeImageSnapshot();
      surface.dispose();
      // 두 번 전 사진은 이제 어디서도 그리지 않는다 → 바로 놓아준다 (큰 그림이라 GC를 기다리지 않게)
      const old = snapPrev.value;
      snapPrev.value = snap.value;
      snap.value = img;
      snapVer.value = c.ver;
      old?.dispose();
    } catch {
      // 사진 없이 원본으로
    }
  };

  const wantSnap = useCallback(() => requestSnap.current(), []);
  /** 화면이 멈췄다. 움직이는 동안 미룬 쪽 사진이 있으면 이제 만들라고 부탁한다 */
  const stopMoving = () => {
    "worklet";
    moving.value = false;
    if (snapWanted.value) {
      snapWanted.value = false;
      scheduleOnRN(wantSnap);
    }
  };

  /** 손가락을 놓을 때의 속도로 조금 더 미끄러진다 (쪽 가장자리에서 멈춤) */
  const startFling = (vx: number, vy: number) => {
    "worklet";
    const s = scale.value, w = pw.value * s, h = ph.value * s, W = vw.value, H = vh.value;
    const canX = w + MARGIN * 2 > W && Math.abs(vx) > 80;
    const fits = h + MARGIN * 2 <= H; // 쪽이 화면보다 작으면 위아래로만 조금 움직일 수 있다 (clampXY와 같은 범위)
    const yLo = fits ? MARGIN : H - h - MARGIN;
    const yHi = fits ? H - h - MARGIN : MARGIN;
    const canY = yHi > yLo && Math.abs(vy) > 80;
    flings.value = (canX ? 1 : 0) + (canY ? 1 : 0);
    if (!flings.value) {
      stopMoving();
      return;
    }
    const done = () => {
      "worklet";
      flings.value = Math.max(0, flings.value - 1);
      if (!flings.value && !pinching.value && mode.value !== 2) stopMoving();
    };
    // 아이폰 기본(0.998)보다 조금 덜 미끄럽게, 너무 세게 튀지 않게
    const v = (n: number) => Math.max(-6000, Math.min(6000, n));
    if (canX) tx.value = withDecay({ velocity: v(vx), deceleration: 0.997, clamp: [W - w - MARGIN, MARGIN] }, done);
    if (canY) ty.value = withDecay({ velocity: v(vy), deceleration: 0.997, clamp: [yLo, yHi] }, done);
  };

  /** 미끄러지던 화면은 다시 닿는 순간 멈춘다 */
  const stopFling = () => {
    "worklet";
    if (!flings.value) return;
    flings.value = 0;
    cancelAnimation(tx);
    cancelAnimation(ty);
  };

  const one = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      "worklet";
      stopFling();
      const finger = e.pointerType === PointerType.TOUCH;
      if (finger && !fingerSV.value) {
        mode.value = 2;
        sx.value = tx.value;
        sy.value = ty.value;
        lastMove.value = { at: Date.now(), x: 0, y: 0 };
        moving.value = true;
        return;
      }
      moving.value = pinching.value;
      const x = (e.x - tx.value) / scale.value;
      const y = (e.y - ty.value) / scale.value;
      if (toolSV.value === 4) {
        mode.value = 7;
        sx.value = x;
        sy.value = y;
        return;
      }
      if (toolSV.value === 3) {
        const b = selBox.value;
        const pad = 10 / scale.value;
        if (hasSel.value && x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad) {
          mode.value = 5;
          sx.value = x;
          sy.value = y;
          return;
        }
        mode.value = 6;
        sx.value = x;
        sy.value = y;
        live.value = [x, y, 0.5];
        return;
      }
      const penErase = e.pointerType === PointerType.STYLUS && penBtn.value;
      if (toolSV.value === 2 || penErase) {
        mode.value = 3;
        const r = eraserPx.value / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 0, x, y, r);
        return;
      }
      if (x < 0 || x > pw.value || y < 0 || y > ph.value) {
        // 쪽 바깥(회색 여백)에서는 쓰지 않는다: 손가락이면 화면을 옮기고, 펜이면 아무것도 안 한다
        if (finger) {
          mode.value = 2;
          sx.value = tx.value;
          sy.value = ty.value;
          lastMove.value = { at: Date.now(), x: 0, y: 0 };
          moving.value = true;
        } else {
          mode.value = 4;
        }
        return;
      }
      mode.value = 1;
      started.value = Date.now();
      stylus.value = e.pointerType === PointerType.STYLUS;
      touch.value = finger;
      const p = e.stylusData && e.stylusData.pressure > 0 ? e.stylusData.pressure : 0.5;
      live.value = [x, y, p];
    },
    onUpdate: (e) => {
      "worklet";
      if (mode.value === 2) {
        const [x, y] = clampXY(scale.value, sx.value + e.translationX, sy.value + e.translationY, pw.value, ph.value, vw.value, vh.value);
        tx.value = x;
        ty.value = y;
        const m = lastMove.value;
        if (Math.abs(e.translationX - m.x) + Math.abs(e.translationY - m.y) > 1) lastMove.value = { at: Date.now(), x: e.translationX, y: e.translationY };
        return;
      }
      const x = (e.x - tx.value) / scale.value;
      const y = (e.y - ty.value) / scale.value;
      if (mode.value === 3) {
        const r = eraserPx.value / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 1, x, y, r);
        return;
      }
      if (mode.value === 5) {
        dragX.value = x - sx.value;
        dragY.value = y - sy.value;
        return;
      }
      if (mode.value === 6) {
        if (rectSV.value) {
          // 사각형 올가미: 시작점과 지금 점을 마주 보는 모서리로
          const a = sx.value, b = sy.value;
          live.value = [a, b, 0.5, x, b, 0.5, x, y, 0.5, a, y, 0.5, a, b, 0.5];
          return;
        }
        live.modify((a) => {
          "worklet";
          a.push(x, y, 0.5);
          return a;
        }, true);
        return;
      }
      if (mode.value === 1 && stylus.value && penBtn.value) {
        // 쓰다가 S펜 단추를 누름(또는 단추 소식이 조금 늦게 옴) → 이 획은 지우개로
        mode.value = 3;
        live.value = [];
        const r = eraserPx.value / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 0, x, y, r);
        return;
      }
      if (mode.value === 1) {
        const p = e.stylusData && e.stylusData.pressure > 0 ? e.stylusData.pressure : 0.5;
        // 쓰다가 쪽 밖으로 나가면 쪽 가장자리에서 멈춘다
        const cx = Math.max(0, Math.min(pw.value, x));
        const cy = Math.max(0, Math.min(ph.value, y));
        live.modify((a) => {
          "worklet";
          a.push(cx, cy, p);
          return a;
        }, true);
      }
    },
    onDeactivate: (e) => {
      "worklet";
      // 손가락으로 밀다가 놓으면 그 속도로 조금 더 미끄러진다 (두 손가락 확대로 넘어간 때, 멈췄다가 뗀 때는 아님)
      if (mode.value === 2 && !e.canceled && !pinching.value && Date.now() - lastMove.value.at < 120) startFling(e.velocityX, e.velocityY);
    },
    onFinalize: (e) => {
      "worklet";
      if (mode.value === 1) {
        const pts = live.value.slice();
        // 손가락으로 쓰다가 둘째 손가락이 닿으면 이 획은 취소된다. 금방(0.35초 안) 취소됐거나 거의 안 움직였으면
        // (화면에서 16px 미만) 확대하려던 것이므로 버린다. 펜으로 쓴 획은 예전 그대로 살린다.
        let far = 0; // 첫 점에서 가장 멀리 간 거리의 제곱 (쪽 좌표)
        for (let i = 3; i < pts.length; i += 3) {
          const dx = pts[i] - pts[0], dy = pts[i + 1] - pts[1];
          if (dx * dx + dy * dy > far) far = dx * dx + dy * dy;
        }
        const near = 16 / scale.value;
        const pinching = touch.value && (Date.now() - started.value < 350 || far < near * near);
        if (e.canceled && (pts.length <= 6 || pinching)) live.value = [];
        else scheduleOnRN(emitStroke, pts, stylus.value);
      } else if (mode.value === 3) {
        eraser.value = { x: -1000, y: -1000, r: 0 };
        scheduleOnRN(emitErase, 2, 0, 0, 0);
      } else if (mode.value === 4) {
        live.value = [];
      } else if (mode.value === 7) {
        scheduleOnRN(emitTextTap, sx.value, sy.value);
      } else if (mode.value === 5) {
        scheduleOnRN(emitMove, dragX.value, dragY.value);
      } else if (mode.value === 6) {
        const pts = live.value.slice();
        live.value = [];
        scheduleOnRN(emitLasso, pts);
      } else if (mode.value === 2 && !flings.value && !pinching.value) {
        stopMoving(); // 미끄러지지 않고 그대로 멈췄다
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
      stopFling();
      pinching.value = true;
      moving.value = true;
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
      if (pinching.value) {
        pinching.value = false;
        if (!flings.value && mode.value !== 2) stopMoving();
      }
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

  const paths = useRef<PathCache>(new WeakMap());
  const hiddenAll = useMemo(() => (sel?.ids.size ? new Set([...hidden, ...sel.ids]) : hidden), [hidden, sel]);
  const picture = useMemo(() => inkPicture(strokes, hiddenAll, page.w, page.h, paths.current), [strokes, hiddenAll, page.w, page.h]);
  const selPicture = useMemo(() => {
    if (!sel?.ids.size) return null;
    return inkPicture(strokes.filter((s) => sel.ids.has(s.id)), new Set(), page.w, page.h, paths.current);
  }, [strokes, sel, page.w, page.h]);
  const dragT = useDerivedValue(() => [{ translateX: dragX.value }, { translateY: dragY.value }]);
  const selRect = useDerivedValue(() => {
    const b = selBox.value;
    return { x: b[0] - 4, y: b[1] - 4, width: b[2] - b[0] + 8, height: b[3] - b[1] + 8 };
  });

  const paper = useMemo(() => paperPicture(page), [page]);
  const image = useImage(background ?? undefined);

  // 쪽 사진에 담을 내용: 바뀌면 번호를 올려 낡은 사진을 쓰지 않게 (한 번에 바꿔야 번호와 내용이 어긋나지 않는다)
  const ver = useRef(0);
  useEffect(() => {
    ver.current += 1;
    content.value = { ver: ver.current, bg: image ?? null, paper: paper ?? null, ink: picture };
    requestSnap.current();
  }, [image, paper, picture, content]);
  // 내용이 바뀌고 0.7초 손을 쉬면 쪽 사진을 미리 만들어 둔다 (그 사이 끌면 사진 없이 원본으로 그린다)
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  requestSnap.current = () => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => scheduleOnUI(makeSnap), 700);
  };
  useEffect(() => () => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
  }, []);
  const inkCount = useMemo(() => strokes.reduce((n, s) => n + (s.tool === "text" ? 0 : 1), 0), [strokes]);
  useEffect(() => {
    heavy.value = inkCount >= HEAVY_STROKES;
  }, [inkCount, heavy]);
  // 움직이는 동안 사진이 맞으면: 원본(바탕 그림·속지·필기)은 빈 영역으로 잘라 아예 그리지 않고 사진 한 장만 그린다
  const useSnap = useDerivedValue(() => moving.value && heavy.value && snap.value !== null && snapVer.value === content.value?.ver);
  const sharpClip = useDerivedValue(() =>
    useSnap.value ? { x: 0, y: 0, width: 0, height: 0 } : { x: -100, y: -100, width: pw.value + 200, height: ph.value + 200 },
  );
  const snapShown = useDerivedValue(() => (useSnap.value ? snap.value : null));

  const hlLive = tool === "highlighter";
  const lassoLive = tool === "lasso";
  const liveWidth = lassoLive ? 1.2 : hlLive ? width : width * 1.25;
  const dashLive: [number, number] | null = lassoLive ? [6, 5] : !hlLive && props.dash === "dash" ? [liveWidth * 3, liveWidth * 2.6] : !hlLive && props.dash === "dot" ? [0.01, liveWidth * 2.2] : null;

  return (
    <StylusView style={{ flex: 1 }} onButton={onPenButton}>
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1, overflow: "hidden" }} onLayout={onLayout} testID="page-canvas">
        <Canvas style={{ flex: 1, backgroundColor: props.dark ? "#2A2C30" : "#E7E4DE" }}>
          <Group transform={transform}>
            <Rect x={-0.5} y={-0.5} width={page.w + 1} height={page.h + 1} color="rgba(0,0,0,0.18)" />
            <Rect x={0} y={0} width={page.w} height={page.h} color="#FFFFFF" />
            <Group clip={sharpClip}>
              {image ? <Image image={image} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
              {paper ? <Picture picture={paper} /> : null}
              <Picture picture={picture} />
            </Group>
            <Image image={snapShown} x={0} y={0} width={page.w} height={page.h} fit="fill" />
            {selPicture ? (
              <Group transform={dragT}>
                <Picture picture={selPicture} />
                <Rect rect={selRect} style="stroke" strokeWidth={1} color="#2F6FDE">
                  <DashPathEffect intervals={[5, 4]} />
                </Rect>
              </Group>
            ) : null}
            <Path
              path={livePath}
              style="stroke"
              strokeWidth={liveWidth}
              strokeCap={hlLive ? "butt" : "round"}
              strokeJoin="round"
              color={lassoLive ? "#2F6FDE" : color}
              opacity={hlLive ? props.opacity : 1}
              blendMode={hlLive ? "multiply" : "srcOver"}
            >
              {dashLive ? <DashPathEffect intervals={dashLive} /> : null}
            </Path>
            <EraserRing eraser={eraser} />
          </Group>
        </Canvas>
        <TextLayer strokes={strokes} hidden={hiddenAll} page={page} tx={tx} ty={ty} scale={scale} />
        <TextLayer strokes={sel?.ids.size ? strokes.filter((s) => sel.ids.has(s.id)) : []} hidden={hidden} page={page} tx={tx} ty={ty} scale={scale} dx={dragX} dy={dragY} />
      </View>
    </GestureDetector>
    </StylusView>
  );
}

/** 글상자: 화면 확대·이동을 그대로 따라가는 글자 층 (손가락·펜 입력은 아래 그림판으로 통과) */
function TextLayer({ strokes, hidden, page, tx, ty, scale, dx, dy }: {
  strokes: Stroke[]; hidden: Set<string>; page: Page;
  tx: SharedValue<number>; ty: SharedValue<number>; scale: SharedValue<number>; dx?: SharedValue<number>; dy?: SharedValue<number>;
}) {
  const texts = strokes.filter((s) => s.tool === "text" && !hidden.has(s.id));
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value + (dx ? dx.value * scale.value : 0) },
      { translateY: ty.value + (dy ? dy.value * scale.value : 0) },
      { scale: scale.value },
    ],
  }));
  if (!texts.length) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: page.w, height: page.h, transformOrigin: "0 0" }, style]}>
      {texts.map((s) => (
        <Text
          key={s.id}
          allowFontScaling={false} // 기기의 '글자 크기' 설정에 따라 커지면 저장된 글상자(글에 맞춘 폭)보다 넓어진다
          style={{ position: "absolute", left: s.pts[0], top: s.pts[1], width: s.pts[3] - s.pts[0], fontSize: s.width, lineHeight: s.width * 1.4, color: s.color }}
        >
          {s.text}
        </Text>
      ))}
    </Animated.View>
  );
}

function EraserRing({ eraser }: { eraser: { value: { x: number; y: number; r: number } } }) {
  const cx = useDerivedValue(() => eraser.value.x);
  const cy = useDerivedValue(() => eraser.value.y);
  const r = useDerivedValue(() => eraser.value.r);
  const sw = useDerivedValue(() => Math.max(0.3, eraser.value.r / 10));
  return <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={sw} color="rgba(60,60,60,0.7)" />;
}

/** 쪽이 화면보다 작으면 가운데, 크면 가장자리(여백 포함)를 넘어 끌리지 않게. */
function clampXY(s: number, x: number, y: number, pw: number, ph: number, vw: number, vh: number): [number, number] {
  "worklet";
  const w = pw * s, h = ph * s;
  const cx = w + MARGIN * 2 <= vw ? (vw - w) / 2 : Math.min(MARGIN, Math.max(vw - w - MARGIN, x));
  const cy = h + MARGIN * 2 <= vh ? Math.min(Math.max(MARGIN, y), vh - h - MARGIN) : Math.min(MARGIN, Math.max(vh - h - MARGIN, y));
  return [cx, cy];
}
