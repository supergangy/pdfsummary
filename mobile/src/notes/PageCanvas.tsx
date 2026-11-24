// 쪽들을 그리고 펜 입력을 받는 화면.
// - 쪽 보기: 좌우로 넘기기(손을 떼면 한 쪽씩 딱 맞춰) · 위아래로 이어 보기 · 두 쪽씩 (pageLayout.ts)
//   화면 근처의 쪽만 그린다 (수백 쪽 노트도 가볍게)
// - 펜(스타일러스)은 쓰고, 손가락은 '손가락으로 쓰기'가 꺼져 있으면 화면을 옮긴다 (손바닥이 닿아도 안 써짐)
// - 두 손가락: 확대·축소·이동
// - 지금 긋는 획은 UI 스레드에서 바로 그리고(지연 최소), 손을 떼면 그 쪽 id와 함께 JS 쪽에 넘겨 저장한다
// - 형광펜 '직선'이 켜져 있으면 긋는 동안에도 곧은 선으로 보여 준다 (손을 뗐을 때와 같은 규칙)
// - S펜 옆 단추를 누른 채 쓰면 지우개 (펜이 떠 있을 때부터 단추 상태를 알 수 있다)
// - 손가락으로 밀고 놓으면 조금 더 미끄러진다 (관성)
// - 필기가 많은 쪽은 화면이 움직이는 동안(끌기·확대·관성) 쪽 전체를 한 장의 사진으로 그리고, 멈추면 선명한 원본으로 돌아온다
//   (삼성 노트처럼: 획 수백 개를 장면마다 다시 그리지 않게)
import { Canvas, Circle, DashPathEffect, Fill, FilterMode, Group, Image, MipmapMode, Path, Picture, Rect, Skia, useImage, usePathValue, type SkImage, type SkPicture } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, Text, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, PointerType, usePanGesture, usePinchGesture, useSimultaneousGestures } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDecay, withDelay, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { StylusView } from "../../modules/stylus";
import { useTheme } from "../ui";
import { penDoubleClick } from "./editor-logic";
import { straighten } from "./geometry";
import type { Ink, LineDash, Page, Stroke } from "./model";
import { docLayout, nearestSpread, pageAt, pagesIn, pageTurnTarget, spotLabel, type DocLayout, type PageFlow } from "./pageLayout";
import { inkPicture, paperPicture, usePaperFont, type Fade, type PathCache } from "./render";

export type ToolName = "pen" | "highlighter" | "eraser" | "lasso" | "text";
/** 움직이는 동안 쓸 쪽 사진에 담을 것 */
type SnapContent = { ver: number; bg: SkImage | null; paper: SkPicture | null; ink: SkPicture };
/** 올가미로 고른 것 (page: 고른 쪽 id) */
export type Selection = { page: string; ids: Set<string>; box: [number, number, number, number] } | null;
export type ZoomCmd = { kind: "in" | "out" | "fit"; n: number };
/** 이 쪽이 보이게 화면을 옮기라는 부탁 (n이 바뀔 때마다) */
export type JumpCmd = { id: string; n: number };

const MARGIN = 12;
/** 필기(글상자 빼고)가 이만큼 넘는 쪽은 움직이는 동안 쪽 사진으로 그린다. 적은 쪽은 원본도 충분히 빨라서 선명한 채로 둔다 */
export const HEAVY_STROKES = 80;
/** 쪽 사진의 가로 픽셀 한도 (웹은 사진을 CPU로 만들어 더 작게) */
const SNAP_MAX = Platform.OS === "web" ? 1200 : 2048;
/** 사진은 기기에서는 GPU로 만든다 (화면을 그리는 스레드와 같은 문맥이라 바로 쓸 수 있다). 웹은 화면 밖 그림판마다 따로 문맥이 생겨 CPU로 */
const SNAP_GPU = Platform.OS !== "web";
const RATIO = PixelRatio.get();
const NO_STROKES: Stroke[] = [];
const NO_IDS = new Set<string>();
/** 좌우 넘기기: 손을 떼면 이만큼 걸려 다음 쪽에 딱 맞춰 선다 */
const TURN = { duration: 280, easing: Easing.out(Easing.cubic) };

type Props = {
  pages: Page[];
  ink: Ink; // 쪽 id → 획
  bgOf: (page: Page) => string | null; // 쪽 그림 주소 (PDF 쪽) — 빈 속지거나 아직 없으면 null
  active: string; // 지금 쪽 id (도구 모음의 쪽 번호)
  jump: JumpCmd;
  flow: PageFlow; // 좌우로 넘기기 / 위아래로 이어 보기
  two: boolean; // 두 쪽씩 보기
  hidden: Set<string>; // 지우는 중이라 잠깐 감춘 획
  tool: ToolName;
  color: string;
  width: number;
  opacity: number; // 형광펜 투명도
  dash: LineDash; // 펜 선 모양
  eraserPx: number; // 화면에서 지우개 반지름
  lassoRect: boolean; // 사각형 올가미
  fingerDraw: boolean;
  straight: boolean; // 형광펜 직선 보정 (긋는 동안에도 곧게 보여 준다)
  zoom: ZoomCmd;
  onStroke: (pts: number[], stylus: boolean, pageId: string) => void;
  onErase: (phase: 0 | 1 | 2, x: number, y: number, radius: number, pageId: string) => void;
  selection?: Selection;
  onLasso?: (pts: number[], pageId: string) => void; // 올가미를 다 그렸을 때
  onMoveSelection?: (dx: number, dy: number) => void; // 고른 것을 끌어 옮겼을 때
  /** 고른 것의 손잡이로 크기·각도를 바꿨을 때: 고른 상자 가운데를 축으로 k배, deg도(시계 방향) */
  onTransformSelection?: (dx: number, dy: number, k: number, deg: number) => void;
  /** 손가락으로 화면을 옮기는 중에 톡 눌렀을 때 (사진·스티커를 누르면 고르게) */
  onObjectTap?: (x: number, y: number, pageId: string) => void;
  /** 움직일 때 나오는 '3 / 12'를 눌렀을 때 (쪽 번호를 넣어 가기) */
  onAskPage?: () => void;
  onTextTap?: (x: number, y: number, pageId: string) => void; // 글상자 도구로 쪽을 눌렀을 때
  onViewWidth?: (pagePx: number) => void; // 쪽이 화면에서 몇 픽셀 폭인지 (바탕 그림 해상도용)
  onPenDouble?: () => void; // S펜 옆 단추를 펜을 띄운 채 두 번 눌렀을 때
  onShown?: (pageId: string) => void; // 화면을 옮겨 가운데 쪽(묶음)이 바뀌었을 때
  onVisible?: (first: number, last: number) => void; // 화면 근처에 있는 쪽 번호 범위 (바탕 그림 미리 불러오기)
  /** 지금 보이는 곳을 묻는 함수를 채워 준다: 지금 쪽 기준 화면 가운데(쪽 좌표)와 보이는 폭·높이 — 사진·스티커를 그 자리에 넣으려고 */
  viewRef?: { current: (() => ViewSpot | null) | null };
  /** 필기 눌러 듣기: 펜(손가락으로 쓰기면 손가락도)은 쓰지 않고 누른 자리를 onTextTap으로 알린다 */
  tapOnly?: boolean;
  /** 강의 녹음 재생 중: 그 녹음의 이 시각 뒤에 쓴 획은 흐리게 */
  fade?: Fade;
};

/** 지금 쪽에서 화면 가운데 자리(쪽 좌표, 쪽 안으로 당김)와 화면에 보이는 폭·높이(쪽 좌표) */
export type ViewSpot = { page: string; x: number; y: number; w: number; h: number };

export function PageCanvas(props: Props) {
  const { pages, ink, active, jump, flow, two, hidden, tool, color, width, fingerDraw, zoom } = props;
  const theme = useTheme();
  const L = useMemo(() => docLayout(pages, flow, two), [pages, flow, two]);
  const LRef = useRef<DocLayout>(L);
  LRef.current = L;
  const activeIdx = Math.max(0, pages.findIndex((p) => p.id === active));

  // ── 보기(확대·이동) ─────────────────────────────────────
  // 화면 좌표 = 문서 좌표 × scale + (tx, ty). 쪽 좌표 = 문서 좌표 − 그 쪽의 자리
  const scale = useSharedValue(1);
  const tx = useSharedValue(MARGIN);
  const ty = useSharedValue(MARGIN);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const minS = useSharedValue(0.2);
  const maxS = useSharedValue(8);
  const fitS = useSharedValue(1); // '맞춤' 배율 (쪽 사진 해상도용)
  const rects = useSharedValue(L.rects);
  const spreads = useSharedValue(L.spreads);
  const docW = useSharedValue(L.w);
  const docH = useSharedValue(L.h);
  const flowV = useSharedValue(flow === "v");
  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }]);

  const cb = useRef(props);
  cb.current = props;
  const idOf = (i: number) => cb.current.pages[i]?.id ?? "";
  const emitStroke = useCallback((pts: number[], stylus: boolean, i: number) => cb.current.onStroke(pts, stylus, idOf(i)), []);
  const emitErase = useCallback((phase: 0 | 1 | 2, x: number, y: number, r: number, i: number) => cb.current.onErase(phase, x, y, r, idOf(i)), []);
  const emitTextTap = useCallback((x: number, y: number, i: number) => cb.current.onTextTap?.(x, y, idOf(i)), []);
  const emitLasso = useCallback((pts: number[], i: number) => cb.current.onLasso?.(pts, idOf(i)), []);
  const emitMove = useCallback((dx: number, dy: number) => cb.current.onMoveSelection?.(dx, dy), []);
  const emitTransform = useCallback((dx: number, dy: number, k: number, deg: number) => cb.current.onTransformSelection?.(dx, dy, k, deg), []);
  const emitObjTap = useCallback((x: number, y: number, i: number) => cb.current.onObjectTap?.(x, y, idOf(i)), []);
  const emitScale = useCallback((s: number) => {
    const p = cb.current.pages.find((x) => x.id === cb.current.active) ?? cb.current.pages[0];
    if (p) cb.current.onViewWidth?.(s * p.w);
  }, []);

  if (props.viewRef) {
    props.viewRef.current = () => {
      const s = scale.value, W = vw.value, H = vh.value;
      const ps = cb.current.pages;
      const ai = Math.max(0, ps.findIndex((p) => p.id === cb.current.active));
      const R = LRef.current.rects;
      if (!W || !ps[ai]) return null;
      const ox = R[ai * 4], oy = R[ai * 4 + 1], pwid = R[ai * 4 + 2], phei = R[ai * 4 + 3];
      const cx = (W / 2 - tx.value) / s - ox, cy = (H / 2 - ty.value) / s - oy;
      return { page: ps[ai].id, x: Math.max(0, Math.min(pwid, cx)), y: Math.max(0, Math.min(phei, cy)), w: W / s, h: H / s };
    };
  }

  /** 이 묶음이 화면 위쪽에 오게 (가로로 화면보다 좁으면 가운데, 넓으면 왼쪽 끝) */
  const place = useCallback((si: number, s: number, W: number, H: number) => {
    const sp = LRef.current.spreads;
    const sx = sp[si * 4] ?? 0, sy = sp[si * 4 + 1] ?? 0, sw = sp[si * 4 + 2] ?? 0;
    const x = sw * s + MARGIN * 2 <= W ? (W - sw * s) / 2 - sx * s : MARGIN - sx * s;
    const [cx, cy] = clampXY(s, x, MARGIN - sy * s, LRef.current.w, LRef.current.h, W, H);
    tx.value = cx;
    ty.value = cy;
  }, [tx, ty]);

  const fit = useCallback((W: number = vw.value, H: number = vh.value) => {
    if (!W || !H) return;
    const Lc = LRef.current;
    const i = Math.max(0, cb.current.pages.findIndex((p) => p.id === cb.current.active));
    const si = Lc.spreadOf[i] ?? 0;
    const sw = Lc.spreads[si * 4 + 2] || 1, sh = Lc.spreads[si * 4 + 3] || 1;
    const s = Math.min((W - MARGIN * 2) / sw, 6);
    // 위아래로 이어 볼 때는 여러 쪽이 한눈에 보이게 더 작게까지
    minS.value = Math.min(s, (H - MARGIN * 2) / sh) * (flowV.value ? 0.3 : 0.6);
    maxS.value = s * 6;
    scale.value = s;
    fitS.value = s;
    place(si, s, W, H);
    emitScale(s);
  }, [vw, vh, minS, maxS, scale, fitS, flowV, place, emitScale]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    vw.value = w;
    vh.value = h;
    // 방금 쓴 공유 값은 JS 쪽에서 곧바로 읽으면 예전 값(처음엔 0)이 나온다 → 크기를 직접 넘긴다
    // (그래서 새 노트가 '맞춤' 크기가 아니라 작게 열리곤 했다)
    fit(w, h);
  };

  // 쪽이 늘거나 줄거나 보기 방식이 바뀌면: 배치를 새로. 보기 방식이 바뀌면 지금 쪽을 맞춤으로,
  // 쪽만 바뀌었으면(다른 기기에서 앞에 쪽이 끼는 등) 지금 쪽이 화면에서 그 자리에 머물게
  const prevL = useRef<{ L: DocLayout; ids: string[]; flow: PageFlow; two: boolean } | null>(null);
  useEffect(() => {
    rects.value = L.rects;
    spreads.value = L.spreads;
    docW.value = L.w;
    docH.value = L.h;
    flowV.value = flow === "v";
    const prev = prevL.current;
    prevL.current = { L, ids: pages.map((p) => p.id), flow, two };
    if (!prev) return;
    if (prev.flow !== flow || prev.two !== two) return fit();
    const id = cb.current.active;
    const a = prev.ids.indexOf(id), b = pages.findIndex((p) => p.id === id);
    if (a < 0 || b < 0) return;
    const dx = L.rects[b * 4] - prev.L.rects[a * 4], dy = L.rects[b * 4 + 1] - prev.L.rects[a * 4 + 1];
    if (dx || dy) {
      tx.value -= dx * scale.value;
      ty.value -= dy * scale.value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L]);

  // 쪽 번호 단추·쪽 모아보기·되돌리기 등으로 다른 쪽에 갈 때 (확대 배율은 그대로)
  useEffect(() => {
    if (!jump.n) return;
    const i = pages.findIndex((p) => p.id === jump.id);
    if (i < 0 || !vw.value) return;
    cancelAnimation(tx);
    cancelAnimation(ty);
    place(L.spreadOf[i] ?? 0, scale.value, vw.value, vh.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump.n]);

  // 도구 모음의 확대·축소·맞춤 단추
  useEffect(() => {
    if (!zoom.n) return;
    if (zoom.kind === "fit") return fit();
    const f = zoom.kind === "in" ? 1.25 : 0.8;
    const s = Math.max(minS.value, Math.min(maxS.value, scale.value * f));
    const cx = vw.value / 2, cy = vh.value / 2;
    const ax = (cx - tx.value) / scale.value, ay = (cy - ty.value) / scale.value;
    const [x, y] = clampXY(s, cx - ax * s, cy - ay * s, docW.value, docH.value, vw.value, vh.value);
    scale.value = s;
    tx.value = x;
    ty.value = y;
    emitScale(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom.n]);

  // ── 화면 근처의 쪽만 그린다 / 가운데 쪽을 도구 모음에 알린다 ─────────
  const [range, setRange] = useState<[number, number]>([activeIdx - 1, activeIdx + 1]);
  const onRange = useCallback((packed: number) => {
    const first = Math.floor(packed / 100000), last = packed % 100000;
    setRange([first, last]);
    cb.current.onVisible?.(first, last);
  }, []);
  useAnimatedReaction(() => {
    const s = scale.value, W = vw.value, H = vh.value;
    if (!W || !H) return -1;
    const x0 = -tx.value / s, y0 = -ty.value / s, w = W / s, h = H / s;
    // 화면 둘레로 반 화면씩 더: 밀어서 들어오기 전에 미리 그려 둔다
    const r = pagesIn(rects.value, x0 - w * 0.5, y0 - h * 0.5, x0 + w * 1.5, y0 + h * 1.5);
    return r[0] < 0 ? -1 : r[0] * 100000 + r[1];
  }, (cur, prev) => {
    if (cur >= 0 && cur !== prev) scheduleOnRN(onRange, cur);
  });
  const onCenter = useCallback((si: number) => {
    const Lc = LRef.current, ps = cb.current.pages;
    const a = Lc.spreadPages[si * 2], b = Lc.spreadPages[si * 2 + 1];
    if (a === undefined || !ps[a]) return;
    const ai = ps.findIndex((p) => p.id === cb.current.active);
    if (ai >= a && ai <= b) return; // 두 쪽 중 다른 쪽에 쓰던 중이면 그 쪽 그대로
    cb.current.onShown?.(ps[a].id);
  }, []);
  useAnimatedReaction(() => {
    const s = scale.value, W = vw.value, H = vh.value;
    if (!W || !H) return -1;
    return nearestSpread(spreads.value, (W / 2 - tx.value) / s, (H / 2 - ty.value) / s);
  }, (cur, prev) => {
    if (cur >= 0 && prev !== null && cur !== prev) scheduleOnRN(onCenter, cur);
  });

  // ── 지금 어디쯤인지: 움직이는 동안 오른쪽(가로 넘김이면 아래)에 막대와 '3 / 12' ──
  // 화면 가운데에서 가장 가까운 묶음(한 쪽 또는 나란한 두 쪽)으로 센다.
  // (가운데 점이 든 쪽으로 세면 두 쪽 보기에서는 가운데가 두 쪽 사이 틈이라 번호가 1에 멈춰 있었다)
  const [spotSpread, setSpotSpread] = useState(-1);
  useAnimatedReaction(() => {
    const s = scale.value, W = vw.value, H = vh.value;
    if (!W || !H) return -1;
    return nearestSpread(spreads.value, (W / 2 - tx.value) / s, (H / 2 - ty.value) / s);
  }, (cur, prev) => {
    if (cur >= 0 && cur !== prev) scheduleOnRN(setSpotSpread, cur);
  });

  // ── 입력 ────────────────────────────────────────────────
  const toolSV = useSharedValue(0);
  const fingerSV = useSharedValue(fingerDraw);
  const eraserPx = useSharedValue(props.eraserPx);
  const rectSV = useSharedValue(props.lassoRect);
  const straightSV = useSharedValue(false);
  const tapOnlySV = useSharedValue(false);
  useEffect(() => {
    tapOnlySV.value = !!props.tapOnly;
  }, [props.tapOnly, tapOnlySV]);
  useEffect(() => {
    eraserPx.value = props.eraserPx;
    rectSV.value = props.lassoRect;
  }, [props.eraserPx, props.lassoRect, eraserPx, rectSV]);
  useEffect(() => {
    toolSV.value = tool === "pen" ? 0 : tool === "highlighter" ? 1 : tool === "eraser" ? 2 : tool === "lasso" ? 3 : 4;
    straightSV.value = tool === "highlighter" && props.straight;
  }, [tool, props.straight, toolSV, straightSV]);
  // 고른 것(올가미) 상자와 끄는 중 옮긴 거리
  const sel = props.selection ?? null;
  const selIdx = sel ? pages.findIndex((p) => p.id === sel.page) : -1;
  const selBox = useSharedValue<number[]>([0, 0, 0, 0]);
  const hasSel = useSharedValue(false);
  const selPage = useSharedValue(-1);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const selK = useSharedValue(1); // 크기 손잡이로 바꾸는 중인 배율
  const selR = useSharedValue(0); // 돌리기 손잡이로 돌리는 중인 각도 (도, 시계 방향)
  useEffect(() => {
    hasSel.value = !!sel && sel.ids.size > 0 && selIdx >= 0;
    selPage.value = selIdx;
    if (sel) selBox.value = [...sel.box];
    dragX.value = 0;
    dragY.value = 0;
    selK.value = 1;
    selR.value = 0;
  }, [sel, selIdx, hasSel, selPage, selBox, dragX, dragY, selK, selR]);
  useEffect(() => {
    fingerSV.value = fingerDraw;
  }, [fingerDraw, fingerSV]);

  const mode = useSharedValue(0); // 0 없음, 1 쓰기, 2 손가락으로 옮기기, 3 지우기, 4 취소됨, 5 고른 것 끌기, 6 올가미 그리기, 7 글상자 누름, 8 크기 손잡이, 9 돌리기 손잡이
  const tapAt = useSharedValue({ x: 0, y: 0, i: -1, at: 0 }); // 손가락으로 옮기기 시작한 자리 (톡 누르기였는지 보려고)
  const panFar = useSharedValue(0); // 손가락으로 옮기며 가장 멀리 간 거리 (화면 px)
  const started = useSharedValue(0);
  const stylus = useSharedValue(false);
  const touch = useSharedValue(false); // 지금 획을 손가락으로 쓰고 있는지
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const cur = useSharedValue(0); // 지금 쓰는 쪽 번호
  const offX = useSharedValue(0); // 그 쪽의 자리 (문서 좌표)
  const offY = useSharedValue(0);
  const pw = useSharedValue(0); // 그 쪽의 크기 (쓰다가 쪽 밖으로 나가면 가장자리에서 멈춘다)
  const ph = useSharedValue(0);
  const live = useSharedValue<number[]>([]);
  const eraser = useSharedValue({ x: -1000, y: -1000, r: 0 });
  const penBtn = useSharedValue(false); // S펜 옆 단추를 누르고 있는지
  const double = useRef(penDoubleClick());
  const onPenButton = useCallback((pressed: boolean, hover: boolean) => {
    penBtn.value = pressed;
    if (double.current(pressed, hover, Date.now())) cb.current.onPenDouble?.();
  }, [penBtn]);

  // ── 움직이는 동안: 관성, 쪽 넘기기 ────────────────────────
  const moving = useSharedValue(false); // 끌기·확대·관성으로 화면이 움직이는 중
  const pinching = useSharedValue(false);
  const flings = useSharedValue(0); // 아직 움직이는 중인 애니메이션 수 (가로·세로)
  const lastMove = useSharedValue({ at: 0, x: 0, y: 0 }); // 손가락으로 옮기다 마지막으로 움직인 때 (멈췄다 떼면 미끄러지지 않게)
  const paging = useSharedValue(false); // 좌우 넘기기를 맞춤 배율로 미는 중 → 손을 떼면 한 쪽씩 딱 맞춘다
  const axis = useSharedValue(0); // 좌우 넘기기에서 민 방향: 0 아직 모름, 1 가로(쪽 넘기기), 2 세로(쪽 안에서 위아래)
  const startSpread = useSharedValue(0);

  const stopMoving = () => {
    "worklet";
    moving.value = false;
  };
  const animDone = () => {
    "worklet";
    flings.value = Math.max(0, flings.value - 1);
    if (!flings.value && !pinching.value && mode.value !== 2) stopMoving();
  };

  /** 화면 가운데에 가장 가까운 묶음 */
  const centerSpread = () => {
    "worklet";
    const s = scale.value;
    return nearestSpread(spreads.value, (vw.value / 2 - tx.value) / s, (vh.value / 2 - ty.value) / s);
  };

  /** 손을 놓을 때의 속도로 조금 더 미끄러진다. 좌우 넘기기에서는 지금 쪽(묶음) 안에서만 가로로 움직이고,
   *  확대한 채 두 쪽 사이에 걸쳐 있으면 가까운 쪽 안으로 들어간다 */
  const release = (vx: number, vy: number) => {
    "worklet";
    const s = scale.value, W = vw.value, H = vh.value;
    let xLo: number, xHi: number;
    if (!flowV.value) {
      const si = centerSpread();
      const ax = spreads.value[si * 4], aw = spreads.value[si * 4 + 2] * s;
      if (aw + MARGIN * 2 <= W) xLo = xHi = (W - aw) / 2 - ax * s;
      else {
        xLo = W - aw - ax * s - MARGIN;
        xHi = MARGIN - ax * s;
      }
    } else {
      const w = docW.value * s;
      if (w + MARGIN * 2 <= W) xLo = xHi = (W - w) / 2;
      else {
        xLo = W - w - MARGIN;
        xHi = MARGIN;
      }
    }
    const h = docH.value * s;
    const fits = h + MARGIN * 2 <= H; // 문서가 화면보다 작으면 위아래로만 조금 움직일 수 있다 (clampXY와 같은 범위)
    const yLo = fits ? MARGIN : H - h - MARGIN;
    const yHi = fits ? H - h - MARGIN : MARGIN;
    const x = tx.value;
    const outX = x < xLo - 0.5 || x > xHi + 0.5;
    const slideX = !outX && xHi > xLo && Math.abs(vx) > 80;
    const slideY = yHi > yLo && Math.abs(vy) > 80;
    flings.value = (outX || slideX ? 1 : 0) + (slideY ? 1 : 0);
    if (!flings.value) return stopMoving();
    // 아이폰 기본(0.998)보다 조금 덜 미끄럽게, 너무 세게 튀지 않게
    const v = (n: number) => Math.max(-6000, Math.min(6000, n));
    if (outX) tx.value = withTiming(Math.min(xHi, Math.max(xLo, x)), TURN, animDone);
    else if (slideX) tx.value = withDecay({ velocity: v(vx), deceleration: 0.997, clamp: [xLo, xHi] }, animDone);
    if (slideY) ty.value = withDecay({ velocity: v(vy), deceleration: 0.997, clamp: [yLo, yHi] }, animDone);
  };

  /** 좌우 넘기기: 손을 떼면 다음·이전 쪽(또는 제자리)에 딱 맞춰 선다. 다른 쪽으로 가면 그 쪽 맨 위부터 */
  const turnPage = (vx: number) => {
    "worklet";
    const s = scale.value, W = vw.value, H = vh.value;
    const t = pageTurnTarget(startSpread.value, centerSpread(), vx, spreads.value.length / 4, W ? (tx.value - sx.value) / W : 0);
    const ax = spreads.value[t * 4], ay = spreads.value[t * 4 + 1], aw = spreads.value[t * 4 + 2];
    const moved = t !== startSpread.value;
    flings.value = moved ? 2 : 1;
    tx.value = withTiming((W - aw * s) / 2 - ax * s, TURN, animDone);
    if (moved) ty.value = withTiming(clampXY(s, 0, MARGIN - ay * s, docW.value, docH.value, W, H)[1], TURN, animDone);
  };

  /** 오른쪽(가로 넘김이면 아래) 위치 막대를 끌다가 놓았을 때: 좌우 넘기기 맞춤 배율이면 가까운 쪽에 딱 맞춘다 */
  const scrubEnd = () => {
    "worklet";
    if (!flowV.value) {
      const s = scale.value, W = vw.value;
      const si = centerSpread();
      const ax = spreads.value[si * 4], aw = spreads.value[si * 4 + 2] * s;
      if (aw + MARGIN * 2 <= W + 1) {
        flings.value = 1;
        tx.value = withTiming((W - aw) / 2 - ax * s, TURN, animDone);
        return;
      }
    }
    stopMoving();
  };

  /** 미끄러지던 화면은 다시 닿는 순간 멈춘다 */
  const stopFling = () => {
    "worklet";
    if (!flings.value) return;
    flings.value = 0;
    cancelAnimation(tx);
    cancelAnimation(ty);
  };

  /** 고른 것의 손잡이: 0 없음, 1 크기(오른쪽 아래 모서리), 2 돌리기(위 가운데 위). 쪽 좌표 x·y, 화면 배율 s */
  const handleAt = (x: number, y: number, s: number) => {
    "worklet";
    const b = selBox.value;
    const r = HANDLE_HIT / s;
    if ((x - (b[2] + 4)) ** 2 + (y - (b[3] + 4)) ** 2 <= r * r) return 1;
    if ((x - (b[0] + b[2]) / 2) ** 2 + (y - (b[1] - 4 - ROT_GAP / s)) ** 2 <= r * r) return 2;
    return 0;
  };
  /** 고른 것을 집기: 손잡이면 크기·돌리기, 상자 안이면 끌기. 집었으면 true */
  const grabSelection = (x: number, y: number, i: number, s: number) => {
    "worklet";
    if (!hasSel.value || i !== selPage.value) return false;
    const h = handleAt(x, y, s);
    const b = selBox.value;
    const pad = 10 / s;
    if (!h && !(x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad)) return false;
    mode.value = h === 1 ? 8 : h === 2 ? 9 : 5;
    sx.value = x;
    sy.value = y;
    return true;
  };

  /** 손가락으로 화면 옮기기 시작 */
  const startPan = () => {
    "worklet";
    mode.value = 2;
    sx.value = tx.value;
    sy.value = ty.value;
    lastMove.value = { at: Date.now(), x: 0, y: 0 };
    moving.value = true;
    axis.value = 0;
    const si = centerSpread();
    startSpread.value = si;
    paging.value = !flowV.value && spreads.value[si * 4 + 2] * scale.value + MARGIN * 2 <= vw.value + 1;
  };

  const one = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      "worklet";
      stopFling();
      const finger = e.pointerType === PointerType.TOUCH;
      if (finger && !fingerSV.value) {
        // 손가락은 화면 옮기기지만, 고른 것(사진·스티커 등)을 잡으면 그것을 옮기고·키우고·돌린다
        const s0 = scale.value;
        const qx = (e.x - tx.value) / s0, qy = (e.y - ty.value) / s0;
        const qi = pageAt(rects.value, qx, qy);
        if (qi >= 0) {
          const R0 = rects.value;
          const px = qx - R0[qi * 4], py = qy - R0[qi * 4 + 1];
          if (grabSelection(px, py, qi, s0)) {
            cur.value = qi;
            offX.value = R0[qi * 4];
            offY.value = R0[qi * 4 + 1];
            return;
          }
          tapAt.value = { x: px, y: py, i: qi, at: Date.now() };
        } else tapAt.value = { x: 0, y: 0, i: -1, at: 0 };
        panFar.value = 0;
        return startPan();
      }
      moving.value = pinching.value;
      const s = scale.value;
      const dx = (e.x - tx.value) / s, dy = (e.y - ty.value) / s;
      const i = pageAt(rects.value, dx, dy);
      if (i < 0) {
        // 쪽 바깥(틈·회색 여백)에서는 쓰지 않는다: 손가락이면 화면을 옮기고, 펜이면 아무것도 안 한다
        if (finger) startPan();
        else mode.value = 4;
        return;
      }
      const R = rects.value;
      cur.value = i;
      offX.value = R[i * 4];
      offY.value = R[i * 4 + 1];
      pw.value = R[i * 4 + 2];
      ph.value = R[i * 4 + 3];
      const x = dx - offX.value;
      const y = dy - offY.value;
      if (toolSV.value === 4 || tapOnlySV.value) {
        mode.value = 7;
        sx.value = x;
        sy.value = y;
        return;
      }
      if (toolSV.value === 3) {
        if (grabSelection(x, y, i, s)) return;
        mode.value = 6;
        sx.value = x;
        sy.value = y;
        live.value = [x, y, 0.5];
        return;
      }
      const penErase = e.pointerType === PointerType.STYLUS && penBtn.value;
      if (toolSV.value === 2 || penErase) {
        mode.value = 3;
        const r = eraserPx.value / s;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 0, x, y, r, i);
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
        const far = Math.abs(e.translationX) + Math.abs(e.translationY);
        if (far > panFar.value) panFar.value = far;
        let nx = sx.value + e.translationX;
        let ny = sy.value + e.translationY;
        if (paging.value) {
          // 좌우 넘기기: 처음 민 방향으로 묶는다 (가로면 쪽 넘기기, 세로면 그 쪽 안에서 위아래)
          if (axis.value === 0 && Math.abs(e.translationX) + Math.abs(e.translationY) > 10) {
            axis.value = Math.abs(e.translationX) > Math.abs(e.translationY) ? 1 : 2;
          }
          if (axis.value === 1) ny = sy.value;
          else if (axis.value === 2) nx = sx.value;
        }
        const [x, y] = clampXY(scale.value, nx, ny, docW.value, docH.value, vw.value, vh.value);
        tx.value = x;
        ty.value = y;
        const m = lastMove.value;
        if (Math.abs(e.translationX - m.x) + Math.abs(e.translationY - m.y) > 1) lastMove.value = { at: Date.now(), x: e.translationX, y: e.translationY };
        return;
      }
      const x = (e.x - tx.value) / scale.value - offX.value;
      const y = (e.y - ty.value) / scale.value - offY.value;
      if (mode.value === 3) {
        const r = eraserPx.value / scale.value;
        eraser.value = { x, y, r };
        scheduleOnRN(emitErase, 1, x, y, r, cur.value);
        return;
      }
      if (mode.value === 5) {
        dragX.value = x - sx.value;
        dragY.value = y - sy.value;
        return;
      }
      if (mode.value === 8 || mode.value === 9) {
        const b = selBox.value;
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (mode.value === 8) {
          // 크기: 가운데에서 손가락까지 거리의 비율 (너무 작게·크게는 막는다)
          const d0 = Math.hypot(sx.value - cx, sy.value - cy), d1 = Math.hypot(x - cx, y - cy);
          selK.value = d0 > 0.5 ? Math.max(0.15, Math.min(8, d1 / d0)) : 1;
        } else {
          // 돌리기: 가운데를 축으로 손가락이 돈 각도. 0·90·180·270도 근처(5도 안)는 딱 맞춘다
          let deg = ((Math.atan2(y - cy, x - cx) - Math.atan2(sy.value - cy, sx.value - cx)) * 180) / Math.PI;
          deg = ((deg % 360) + 540) % 360 - 180;
          const snap = Math.round(deg / 90) * 90;
          selR.value = Math.abs(deg - snap) < 5 ? snap : deg;
        }
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
        scheduleOnRN(emitErase, 0, x, y, r, cur.value);
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
      // 손가락으로 밀다가 놓으면: 좌우 넘기기면 쪽에 딱 맞추고, 아니면 그 속도로 조금 더 미끄러진다
      // (두 손가락 확대로 넘어간 때, 멈췄다가 뗀 때는 미끄러지지 않는다)
      if (mode.value !== 2 || e.canceled || pinching.value) return;
      const recent = Date.now() - lastMove.value.at < 120;
      if (paging.value && axis.value === 1) turnPage(recent ? e.velocityX : 0);
      else release(recent && !(paging.value && axis.value === 2) ? e.velocityX : 0, recent ? e.velocityY : 0);
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
        const zooming = touch.value && (Date.now() - started.value < 350 || far < near * near);
        if (e.canceled && (pts.length <= 6 || zooming)) live.value = [];
        else scheduleOnRN(emitStroke, pts, stylus.value, cur.value);
      } else if (mode.value === 3) {
        eraser.value = { x: -1000, y: -1000, r: 0 };
        scheduleOnRN(emitErase, 2, 0, 0, 0, cur.value);
      } else if (mode.value === 4) {
        live.value = [];
      } else if (mode.value === 7) {
        scheduleOnRN(emitTextTap, sx.value, sy.value, cur.value);
      } else if (mode.value === 5) {
        scheduleOnRN(emitMove, dragX.value, dragY.value);
      } else if (mode.value === 8 || mode.value === 9) {
        if (Math.abs(selK.value - 1) < 0.01 && Math.abs(selR.value) < 0.5) {
          selK.value = 1;
          selR.value = 0;
        } else scheduleOnRN(emitTransform, 0, 0, selK.value, selR.value);
      } else if (mode.value === 6) {
        const pts = live.value.slice();
        live.value = [];
        scheduleOnRN(emitLasso, pts, cur.value);
      } else if (mode.value === 2 && !flings.value && !pinching.value) {
        stopMoving(); // 미끄러지지 않고 그대로 멈췄다
      }
      // 손가락으로 톡 눌렀다(거의 안 움직이고 금방 뗌) → 그 자리의 사진·스티커를 고르게 알린다
      if (mode.value === 2 && !pinching.value && tapAt.value.i >= 0 && panFar.value < 10 && Date.now() - tapAt.value.at < 400) {
        scheduleOnRN(emitObjTap, tapAt.value.x, tapAt.value.y, tapAt.value.i);
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
      const [x, y] = clampXY(s, e.focalX - ax.value * s, e.focalY - ay.value * s, docW.value, docH.value, vw.value, vh.value);
      scale.value = s;
      tx.value = x;
      ty.value = y;
    },
    onFinalize: () => {
      "worklet";
      if (pinching.value) {
        pinching.value = false;
        // 좌우 넘기기에서 두 쪽 사이에 걸쳐 멈췄으면 가까운 쪽 안으로
        if (!flings.value && mode.value !== 2) release(0, 0);
      }
      scheduleOnRN(emitScale, scale.value);
    },
  });
  const gesture = useSimultaneousGestures(one, pinch);

  // ── 그리기 ──────────────────────────────────────────────
  const livePath = usePathValue((b) => {
    "worklet";
    let a = live.value;
    if (a.length < 3) return;
    // 형광펜 직선: 손을 뗐을 때 곧게 펴질 모양을 긋는 동안에도 그대로 보여 준다
    if (straightSV.value && mode.value === 1 && a.length >= 6) a = straighten(a);
    b.moveTo(a[0], a[1]);
    if (a.length === 3) b.lineTo(a[0] + 0.01, a[1]);
    for (let i = 3; i < a.length; i += 3) b.lineTo(a[i], a[i + 1]);
  });
  const liveT = useDerivedValue(() => [{ translateX: offX.value }, { translateY: offY.value }]);

  // 손을 떼면 부모가 획을 저장하고 새 ink를 넘겨준다 → 그때 지금 획을 지운다 (깜빡임 없이)
  useEffect(() => {
    live.value = [];
  }, [ink, live]);

  const paths = useRef<PathCache>(new WeakMap());
  const hiddenAll = useMemo(() => (sel?.ids.size ? new Set([...hidden, ...sel.ids]) : hidden), [hidden, sel]);
  const selStrokes = selIdx >= 0 && sel ? ink[sel.page] ?? NO_STROKES : NO_STROKES;
  const selPicture = useMemo(() => {
    if (!sel?.ids.size || selIdx < 0) return null;
    const p = pages[selIdx];
    return inkPicture(selStrokes.filter((s) => sel.ids.has(s.id)), new Set(), p.w, p.h, paths.current);
  }, [selStrokes, sel, selIdx, pages]);
  // 고른 상자 가운데를 축으로 크기·각도를 바꾸고 끈 만큼 옮긴 모습
  const dragT = useDerivedValue(() => {
    const b = selBox.value;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return [
      { translateX: dragX.value + cx }, { translateY: dragY.value + cy },
      { rotate: (selR.value * Math.PI) / 180 }, { scale: selK.value },
      { translateX: -cx }, { translateY: -cy },
    ];
  });
  // 손잡이: 화면에서 늘 같은 크기로 (크기 미리 보기 배율도 되돌려서)
  const hR = useDerivedValue(() => HANDLE_R / scale.value / selK.value);
  const hW = useDerivedValue(() => 1.5 / scale.value / selK.value);
  const sizeX = useDerivedValue(() => selBox.value[2] + 4);
  const sizeY = useDerivedValue(() => selBox.value[3] + 4);
  const rotX = useDerivedValue(() => (selBox.value[0] + selBox.value[2]) / 2);
  const rotY = useDerivedValue(() => selBox.value[1] - 4 - ROT_GAP / scale.value / selK.value);
  const rotStem = usePathValue((p) => {
    "worklet";
    p.moveTo(rotX.value, selBox.value[1] - 4);
    p.lineTo(rotX.value, rotY.value);
  });
  const selRect = useDerivedValue(() => {
    const b = selBox.value;
    return { x: b[0] - 4, y: b[1] - 4, width: b[2] - b[0] + 8, height: b[3] - b[1] + 8 };
  });

  // 그릴 쪽: 화면 근처 + 지금 쪽(묶음) + 고른 것이 있는 쪽
  const shown = useMemo(() => {
    const set = new Set<number>();
    const n = pages.length;
    for (let i = Math.max(0, range[0]); i <= Math.min(n - 1, range[1]); i++) set.add(i);
    const si = L.spreadOf[activeIdx] ?? 0;
    for (let i = L.spreadPages[si * 2] ?? activeIdx; i <= (L.spreadPages[si * 2 + 1] ?? activeIdx); i++) set.add(i);
    if (selIdx >= 0) set.add(selIdx);
    return [...set].sort((a, b) => a - b);
  }, [range, pages.length, L, activeIdx, selIdx]);

  const hlLive = tool === "highlighter";
  const lassoLive = tool === "lasso";
  const liveWidth = lassoLive ? 1.2 : hlLive ? width : width * 1.25;
  const dashLive: [number, number] | null = lassoLive ? [6, 5] : !hlLive && props.dash === "dash" ? [liveWidth * 3, liveWidth * 2.6] : !hlLive && props.dash === "dot" ? [0.01, liveWidth * 2.2] : null;
  const selX = selIdx >= 0 ? L.rects[selIdx * 4] : 0, selY = selIdx >= 0 ? L.rects[selIdx * 4 + 1] : 0;

  return (
    <StylusView style={{ flex: 1 }} onButton={onPenButton}>
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1, overflow: "hidden" }} onLayout={onLayout} testID="page-canvas">
        {/* opaque: 안드로이드에서 SurfaceView로 그린다. 기본(TextureView)은 Skia가 120Hz로 그려도 창 합성이 60Hz라
            스크롤이 삼성노트보다 끊겨 보였다 (atrace: Skia 8.3ms마다 vs 창 DrawFrames 16.6ms마다). 대신 바탕색은 Skia가 직접 칠한다 */}
        <Canvas style={{ flex: 1, backgroundColor: theme.canvas }} opaque>
          <Fill color={theme.canvas} />
          <Group transform={transform}>
            {shown.map((i) => (
              <PageLayer
                key={pages[i].id}
                page={pages[i]}
                x={L.rects[i * 4]}
                y={L.rects[i * 4 + 1]}
                strokes={ink[pages[i].id] ?? NO_STROKES}
                hidden={hiddenAll}
                bg={props.bgOf(pages[i])}
                paths={paths.current}
                fade={props.fade ?? null}
                dark={theme.dark}
                moving={moving}
                busy={mode}
                fitS={fitS}
              />
            ))}
            {selPicture ? (
              <Group transform={[{ translateX: selX }, { translateY: selY }]}>
                <Group transform={dragT}>
                  <Picture picture={selPicture} />
                  <Rect rect={selRect} style="stroke" strokeWidth={1} color="#2F6FDE">
                    <DashPathEffect intervals={[5, 4]} />
                  </Rect>
                  {/* 손잡이: 오른쪽 아래 = 크기, 위 가운데 = 돌리기 */}
                  <Path path={rotStem} style="stroke" strokeWidth={hW} color="#2F6FDE" />
                  <Circle cx={rotX} cy={rotY} r={hR} color="#FFFFFF" />
                  <Circle cx={rotX} cy={rotY} r={hR} style="stroke" strokeWidth={hW} color="#2F6FDE" />
                  <Circle cx={sizeX} cy={sizeY} r={hR} color="#2F6FDE" />
                  <Circle cx={sizeX} cy={sizeY} r={hR} style="stroke" strokeWidth={hW} color="#FFFFFF" />
                </Group>
              </Group>
            ) : null}
            <Group transform={liveT}>
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
          </Group>
        </Canvas>
        {shown.map((i) => (
          <TextLayer key={pages[i].id} strokes={ink[pages[i].id] ?? NO_STROKES} hidden={hiddenAll} page={pages[i]} ox={L.rects[i * 4]} oy={L.rects[i * 4 + 1]} tx={tx} ty={ty} scale={scale} />
        ))}
        {selIdx >= 0 && sel ? (
          <TextLayer strokes={selStrokes.filter((s) => sel.ids.has(s.id))} hidden={hidden} page={pages[selIdx]} ox={selX} oy={selY} tx={tx} ty={ty} scale={scale} dx={dragX} dy={dragY} k={selK} r={selR} box={selBox} />
        ) : null}
      </View>
    </GestureDetector>
    {/* key: 넘기는 방향이 바뀌면 새로 그린다 (위아래 때 붙은 top·height가 남아 막대가 큰 네모로, 쪽 번호가 엉뚱한 곳에 보였다) */}
    <ScrollSpot
      key={flow}
      tx={tx} ty={ty} scale={scale} vw={vw} vh={vh} docW={docW} docH={docH}
      vertical={flow === "v"} moving={moving} label={spotLabel(L, spotSpread, activeIdx, pages.length)}
      pulse={jump.n} onEnd={scrubEnd} onAskPage={props.onAskPage}
    />
    </StylusView>
  );
}

/** 지금 보는 자리: 움직이는 동안(그리고 쪽 단추로 건너뛴 뒤 잠깐) 막대(문서 전체에서 화면이 있는 곳)와 쪽 번호를 보이고, 멈추면 1초 뒤 사라진다.
 *  보이는 동안에는 막대를 손가락으로 잡고 끌어 빨리 넘기고, '3 / 12'를 누르면 쪽 번호를 넣어 간다 (삼성 노트·내 파일의 빠른 스크롤처럼).
 *  안 보일 때는 손을 받지 않아 가장자리에 쓰는 것을 막지 않는다 */
function ScrollSpot({ tx, ty, scale, vw, vh, docW, docH, vertical, moving, label, pulse, onEnd, onAskPage }: {
  tx: SharedValue<number>; ty: SharedValue<number>; scale: SharedValue<number>; vw: SharedValue<number>; vh: SharedValue<number>;
  docW: SharedValue<number>; docH: SharedValue<number>; vertical: boolean; moving: SharedValue<boolean>; label: string;
  pulse: number; onEnd: () => void; onAskPage?: () => void;
}) {
  const show = useSharedValue(0);
  useAnimatedReaction(() => moving.value, (m, prev) => {
    if (m === prev) return;
    show.value = m ? withTiming(1, { duration: 120 }) : withDelay(1000, withTiming(0, { duration: 400 }));
  });
  // 쪽 단추·쪽 번호로 건너뛰었을 때도 잠깐 보인다 (어디쯤인지 알게, 이어서 막대를 잡을 수 있게)
  useEffect(() => {
    if (!pulse || moving.value) return;
    show.value = withSequence(withTiming(1, { duration: 120 }), withDelay(1500, withTiming(0, { duration: 400 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);
  const [live, setLive] = useState(false); // 보이는 동안만 손을 받는다
  useAnimatedReaction(() => show.value > 0.05, (v, prev) => {
    if (v !== prev) scheduleOnRN(setLive, v);
  });
  /** [막대 시작, 막대 길이, 보이는 칸 길이] (화면 픽셀) */
  const bar = useDerivedValue(() => {
    const s = scale.value;
    const view = vertical ? vh.value : vw.value;
    const doc = (vertical ? docH.value : docW.value) * s;
    const track = Math.max(0, view - 24);
    if (!view || doc <= view + 1) return [0, 0, track];
    const len = Math.max(40, (track * view) / doc);
    const p = Math.min(1, Math.max(0, -(vertical ? ty.value : tx.value) / (doc - view)));
    return [12 + p * (track - len), len, track];
  });
  const thumb = useAnimatedStyle(() => {
    const [at, len] = bar.value;
    return {
      opacity: len > 0 ? show.value : 0,
      ...(vertical ? { top: at, height: len } : { left: at, width: len }),
    };
  });
  const pill = useAnimatedStyle(() => {
    const [at, len] = bar.value;
    const mid = len > 0 ? at + len / 2 : (vertical ? vh.value : vw.value) / 2;
    return { opacity: show.value, ...(vertical ? { top: mid - 15 } : { left: mid - 36 }) };
  });

  // ── 막대 끌기 ──
  const grab = useSharedValue(0); // 잡은 자리 - 막대 가운데 (막대를 잡았으면 그만큼 어긋난 채 따라온다)
  const startAt = useSharedValue({ pos: 0, t: 0, onThumb: false });
  const far = useSharedValue(0);
  /** 손가락 자리(막대 방향, 화면 px) → 화면 옮기기 */
  const scrollTo = (pos: number) => {
    "worklet";
    const [, len, track] = bar.value;
    if (len <= 0) return;
    const s = scale.value;
    const view = vertical ? vh.value : vw.value;
    const doc = (vertical ? docH.value : docW.value) * s;
    const p = Math.min(1, Math.max(0, (pos - grab.value - 12 - len / 2) / Math.max(1, track - len)));
    if (vertical) ty.value = -p * (doc - view);
    else tx.value = -p * (doc - view);
  };
  const ask = useCallback(() => onAskPage?.(), [onAskPage]);
  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      "worklet";
      cancelAnimation(tx);
      cancelAnimation(ty);
      const pos = vertical ? e.y : e.x;
      const [at, len] = bar.value;
      const mid = at + len / 2;
      const onThumb = len > 0 && Math.abs(pos - mid) <= Math.max(26, len / 2 + 10);
      grab.value = onThumb ? pos - mid : 0;
      startAt.value = { pos, t: Date.now(), onThumb };
      far.value = 0;
      moving.value = true;
      if (!onThumb) scrollTo(pos); // 막대 밖(길)을 누르면 그 자리로
    },
    onUpdate: (e) => {
      "worklet";
      const pos = vertical ? e.y : e.x;
      far.value = Math.max(far.value, Math.abs(pos - startAt.value.pos));
      if (far.value > 3) scrollTo(pos);
    },
    onFinalize: () => {
      "worklet";
      const st = startAt.value;
      // 막대(쪽 번호)를 톡 누름 → 쪽 번호 넣기
      if (st.onThumb && far.value < 8 && Date.now() - st.t < 450) scheduleOnRN(ask);
      onEnd();
    },
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={[vertical ? sx.thumbV : sx.thumbH, thumb]} />
      <Animated.View pointerEvents="none" style={[vertical ? sx.pillV : sx.pillH, pill]}>
        <Text style={sx.pillText} accessibilityLabel={`지금 ${label.replace(" / ", "쪽, 전체 ")}쪽`}>{label}</Text>
      </Animated.View>
      {live && (
        <GestureDetector gesture={pan}>
          <View
            collapsable={false}
            style={vertical ? sx.hitV : sx.hitH}
            accessibilityRole="adjustable"
            accessibilityLabel={`쪽 이동 막대: 지금 ${label.replace(" / ", "쪽, 전체 ")}쪽 (끌어서 넘기기, 눌러서 쪽 번호로 가기)`}
          />
        </GestureDetector>
      )}
    </>
  );
}

const sx = {
  thumbV: { position: "absolute" as const, right: 3, width: 5, borderRadius: 3, backgroundColor: "rgba(60,64,72,0.55)" },
  thumbH: { position: "absolute" as const, bottom: 3, height: 5, borderRadius: 3, backgroundColor: "rgba(60,64,72,0.55)" },
  pillV: { position: "absolute" as const, right: 14, height: 30, minWidth: 64, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "rgba(32,33,36,0.82)", alignItems: "center" as const, justifyContent: "center" as const },
  pillH: { position: "absolute" as const, bottom: 14, height: 30, minWidth: 72, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "rgba(32,33,36,0.82)", alignItems: "center" as const, justifyContent: "center" as const },
  pillText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" as const, fontVariant: ["tabular-nums" as const] },
  // 막대를 잡는 자리: 막대와 쪽 번호를 덮는 가장자리 띠 (보이는 동안만 있다)
  hitV: { position: "absolute" as const, right: 0, top: 0, bottom: 0, width: 100 },
  hitH: { position: "absolute" as const, left: 0, right: 0, bottom: 0, height: 64 },
};

/** 쪽 하나: 테두리·흰 종이·바탕 그림(PDF)·속지·필기. 필기가 많으면 움직이는 동안 쪽 사진으로 */
function PageLayer({ page, x, y, strokes, hidden, bg, paths, fade, dark, moving, busy, fitS }: {
  page: Page; x: number; y: number; strokes: Stroke[]; hidden: Set<string>; bg: string | null; paths: PathCache; fade: Fade; dark: boolean;
  moving: SharedValue<boolean>; busy: SharedValue<number>; fitS: SharedValue<number>;
}) {
  const image = useImage(bg ?? undefined);
  const tf = usePaperFont([page.paper]);
  const paper = useMemo(() => paperPicture(page, tf), [page, tf]);
  // 이 쪽 획 중에 감춘 것이 없으면 늘 같은 빈 묶음 → 다른 쪽을 지우는 동안 이 쪽 그림을 다시 만들지 않는다
  const own = useMemo(() => (hidden.size && strokes.some((s) => hidden.has(s.id)) ? hidden : NO_IDS), [strokes, hidden]);
  // 재생 중 흐리게: 이 쪽에 그 녹음으로 쓴 획이 있을 때만 (없는 쪽은 그림을 다시 만들지 않게)
  const myFade = useMemo(() => (fade && strokes.some((s) => s.rec === fade.rec) ? fade : null), [fade, strokes]);
  const fadeKey = myFade ? `${myFade.rec}@${myFade.ms}` : "";
  const picture = useMemo(() => inkPicture(strokes, own, page.w, page.h, paths, myFade),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, own, page.w, page.h, paths, fadeKey]);

  // ── 움직이는 동안 쓸 쪽 사진 ────────────────────────────
  const heavy = useSharedValue(false); // 필기가 많은 쪽
  const content = useSharedValue<SnapContent | null>(null); // 사진에 담을 것 (바뀔 때마다 ver가 오른다)
  const snap = useSharedValue<SkImage | null>(null);
  const snapPrev = useSharedValue<SkImage | null>(null);
  const snapVer = useSharedValue(-1); // 사진을 만든 때의 내용 번호 (-1 = 사진 없음·낡음)
  const snapWanted = useSharedValue(false); // 움직이거나 쓰는 중이라 못 만든 사진이 있다
  // 쪽 사진의 pt당 픽셀 (맞춤 보기의 화면 픽셀만큼, 너무 크지 않게)
  const snapK = useDerivedValue(() => Math.max(0.5, Math.min(SNAP_MAX / page.w, 4096 / page.h, fitS.value * RATIO)));

  /** 필기가 많은 쪽이면 쪽 사진(바탕 그림 + 속지 + 필기를 한 장으로)을 만든다. 내용이 그대로면 있던 사진을 쓴다.
   *  UI 스레드에서 GPU로 그리지만 획 300개 쪽에서 30ms쯤 걸린다 (갤럭시탭에서 잼) → 끌기를 시작할 때가 아니라
   *  손을 쉬고 있을 때 미리 만든다 (requestSnap). 움직이거나 쓰는 중이면 미뤘다가 끝나면 다시 만든다. */
  const makeSnap = () => {
    "worklet";
    const c = content.value;
    if (!c || !heavy.value || snapVer.value === c.ver) return;
    if (moving.value || busy.value !== 0) {
      snapWanted.value = true;
      return;
    }
    try {
      const k = snapK.value;
      const surface = SNAP_GPU
        ? Skia.Surface.MakeOffscreen(Math.max(1, Math.round(page.w * k)), Math.max(1, Math.round(page.h * k)))
        : Skia.Surface.Make(Math.max(1, Math.round(page.w * k)), Math.max(1, Math.round(page.h * k)));
      if (!surface) return;
      const cv = surface.getCanvas();
      cv.drawColor(Skia.Color("#FFFFFF"));
      cv.scale(k, k);
      if (c.bg) {
        const src = Skia.XYWHRect(0, 0, c.bg.width(), c.bg.height());
        cv.drawImageRectOptions(c.bg, src, Skia.XYWHRect(0, 0, page.w, page.h), FilterMode.Linear, MipmapMode.None, null);
      }
      if (c.paper) cv.drawPicture(c.paper);
      cv.drawPicture(c.ink);
      const img = surface.makeImageSnapshot();
      // 화면 밖 그림판(남이 만든 텍스처를 감싼 것)의 사진은 Skia가 GPU 복사로 만드는데, 그 복사는 다음 flush로 미뤄진다.
      // 사진을 찍은 뒤에 flush해야 그 복사도 지금(쉬는 동안) 끝난다 (전에는 첫 끌기 때 30ms 멈칫했다)
      surface.flush();
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

  // 내용이 바뀌고 0.7초 손을 쉬면 쪽 사진을 미리 만들어 둔다 (그 사이 끌면 사진 없이 원본으로 그린다)
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSnap = useCallback(() => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => scheduleOnUI(makeSnap), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    // 화면에서 멀어져 내려간 쪽: 큰 사진을 놓아준다 (마지막 장면이 다 그려진 뒤에)
    setTimeout(() => scheduleOnUI(() => {
      "worklet";
      const a = snap.value, b = snapPrev.value;
      snap.value = null;
      snapPrev.value = null;
      a?.dispose();
      b?.dispose();
    }), 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 쪽 사진에 담을 내용: 바뀌면 번호를 올려 낡은 사진을 쓰지 않게 (한 번에 바꿔야 번호와 내용이 어긋나지 않는다)
  const ver = useRef(0);
  useEffect(() => {
    ver.current += 1;
    content.value = { ver: ver.current, bg: image ?? null, paper: paper ?? null, ink: picture };
    requestSnap();
  }, [image, paper, picture, content, requestSnap]);
  const inkCount = useMemo(() => strokes.reduce((n, s) => n + (s.tool === "text" ? 0 : 1), 0), [strokes]);
  useEffect(() => {
    heavy.value = inkCount >= HEAVY_STROKES;
    if (inkCount >= HEAVY_STROKES) requestSnap();
  }, [inkCount, heavy, requestSnap]);
  // 맞춤 배율이 바뀌면(화면 크기·보기 방식) 사진 해상도도 다시
  useAnimatedReaction(() => snapK.value, (k, prev) => {
    if (prev !== null && k !== prev) {
      snapVer.value = -1;
      scheduleOnRN(requestSnap);
    }
  });
  // 움직이거나 쓰던 것이 끝났다. 그동안 미룬 쪽 사진이 있으면 이제 만들라고 부탁한다
  useAnimatedReaction(() => moving.value || busy.value !== 0, (b, prev) => {
    if (prev && !b && snapWanted.value) {
      snapWanted.value = false;
      scheduleOnRN(requestSnap);
    }
  });

  // 움직이는 동안 사진이 맞으면: 원본(바탕 그림·속지·필기)은 빈 영역으로 잘라 아예 그리지 않고 사진 한 장만 그린다
  const useSnap = useDerivedValue(() => moving.value && heavy.value && snap.value !== null && snapVer.value === content.value?.ver);
  const sharpClip = useDerivedValue(() =>
    useSnap.value ? { x: 0, y: 0, width: 0, height: 0 } : { x: -100, y: -100, width: page.w + 200, height: page.h + 200 },
  );
  const snapShown = useDerivedValue(() => (useSnap.value ? snap.value : null));

  return (
    <Group transform={[{ translateX: x }, { translateY: y }]}>
      {/* 쪽 사이가 또렷하게: 아래·오른쪽으로 옅은 그림자 + 테두리 */}
      <Rect x={1.5} y={2.5} width={page.w} height={page.h} color={dark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.07)"} />
      <Rect x={-0.75} y={-0.75} width={page.w + 1.5} height={page.h + 1.5} color={dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.20)"} />
      <Rect x={0} y={0} width={page.w} height={page.h} color="#FFFFFF" />
      <Group clip={sharpClip}>
        {image ? <Image image={image} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
        {paper ? <Picture picture={paper} /> : null}
        <Picture picture={picture} />
      </Group>
      <Image image={snapShown} x={0} y={0} width={page.w} height={page.h} fit="fill" />
    </Group>
  );
}

// 고른 것 손잡이: 화면에서 반지름(px), 누르는 자리 반지름(px), 돌리기 손잡이가 상자 위로 떨어진 거리(px)
const HANDLE_R = 9;
const HANDLE_HIT = 22;
const ROT_GAP = 30;

/** 글상자: 화면 확대·이동을 그대로 따라가는 글자 층 (손가락·펜 입력은 아래 그림판으로 통과). ox·oy: 쪽의 자리(문서 좌표) */
function TextLayer({ strokes, hidden, page, ox, oy, tx, ty, scale, dx, dy, k, r, box }: {
  strokes: Stroke[]; hidden: Set<string>; page: Page; ox: number; oy: number;
  tx: SharedValue<number>; ty: SharedValue<number>; scale: SharedValue<number>; dx?: SharedValue<number>; dy?: SharedValue<number>;
  /** 고른 것: 상자(box) 가운데를 축으로 k배·r도 미리 보기 */
  k?: SharedValue<number>; r?: SharedValue<number>; box?: SharedValue<number[]>;
}) {
  const texts = strokes.filter((s) => s.tool === "text" && !hidden.has(s.id));
  const style = useAnimatedStyle(() => {
    const b = box ? box.value : [0, 0, 0, 0];
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return {
      transform: [
        { translateX: tx.value + (ox + (dx ? dx.value : 0) + cx) * scale.value },
        { translateY: ty.value + (oy + (dy ? dy.value : 0) + cy) * scale.value },
        { rotate: `${r ? r.value : 0}deg` },
        { scale: scale.value * (k ? k.value : 1) },
        { translateX: -cx },
        { translateY: -cy },
      ],
    };
  });
  if (!texts.length) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: page.w, height: page.h, transformOrigin: "0 0" }, style]}>
      {texts.map((s) => s.stamp ? (
        // 도장 스티커: 둥근 테두리 + 옅은 바탕 + 굵은 글
        <View
          key={s.id}
          style={{
            position: "absolute", left: s.pts[0], top: s.pts[1], width: s.pts[3] - s.pts[0], height: s.pts[4] - s.pts[1],
            ...(s.rot ? { transform: [{ rotate: `${s.rot}deg` }] } : null), // 돌린 도장 (상자 가운데 축)
            borderRadius: s.width * 0.45, borderWidth: Math.max(1.5, s.width * 0.1), borderColor: s.color, backgroundColor: s.color + "1F",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: s.width, fontWeight: "700", color: s.color }}>{s.text}</Text>
        </View>
      ) : (
        <Text
          key={s.id}
          allowFontScaling={false} // 기기의 '글자 크기' 설정에 따라 커지면 저장된 글상자(글에 맞춘 폭)보다 넓어진다
          style={{ position: "absolute", left: s.pts[0], top: s.pts[1], width: s.pts[3] - s.pts[0], height: s.pts[4] - s.pts[1], fontSize: s.width, lineHeight: s.width * 1.4, color: s.color, ...(s.rot ? { transform: [{ rotate: `${s.rot}deg` }] } : null) }}
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

/** 문서(쪽들)가 화면보다 작으면 가운데, 크면 가장자리(여백 포함)를 넘어 끌리지 않게. */
function clampXY(s: number, x: number, y: number, dw: number, dh: number, vw: number, vh: number): [number, number] {
  "worklet";
  const w = dw * s, h = dh * s;
  const cx = w + MARGIN * 2 <= vw ? (vw - w) / 2 : Math.min(MARGIN, Math.max(vw - w - MARGIN, x));
  const cy = h + MARGIN * 2 <= vh ? Math.min(Math.max(MARGIN, y), vh - h - MARGIN) : Math.min(MARGIN, Math.max(vh - h - MARGIN, y));
  return [cx, cy];
}
