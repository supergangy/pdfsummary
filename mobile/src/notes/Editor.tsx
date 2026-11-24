// 필기 화면: 도구 모음 + 쪽 그리기 + 자동 저장
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { ActivityIndicator, Alert, AppState, BackHandler, Image, Modal, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View, type HostInstance } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { pageText } from "../../modules/pdf-pages";
import { StylusView } from "../../modules/stylus";
import { Button, floating, radius, styles as ui, type, useTheme, type Theme } from "../ui";
import { clampPage, colorName, isHighlighterTap, justAfter, otherPage, pageBg, penSwap, swatchEdge, widthName, type BgCache, type SwapSaved } from "./editor-logic";
import { bounds, eraseFrom, fitHighlight, hitAlong, straighten, thin, type CharBox } from "./geometry";
import { History, removal, type Op } from "./history";
import {
  HIGHLIGHT_COLORS, HIGHLIGHT_OPACITY, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTHS, PENS, TEXT_SIZES, insertPage, makeImage, makeStamp, makeTextBox, newId, removePage,
  type Ink, type Notebook, type Paper, type Stroke,
} from "./model";
import { pageImage } from "./pageImage";
import { PageCanvas, type JumpCmd, type Selection, type ToolName, type ViewSpot, type ZoomCmd } from "./PageCanvas";
import { PageGrid } from "./PageGrid";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { clock, fadeStep, pageAt, seekFor, timedStrokeAt } from "./audioSync";
import { PlayerBar, useLectureAudio } from "./LectureAudio";
import { clipboardPicture, fileToDataUri, pickPhoto, shrinkDataUri, stickerPicture, type Picture } from "./insertImage";
import { lassoSelect, moved, scaled, snapShape } from "./shapes";
import { STAMPS, STICKERS, type Sticker } from "./stickers";
import { ToolIcon, type IconName } from "./ToolIcon";
import { ToolPanel } from "./ToolPanel";
import { clampFloat, dockAt, DOCKS, groupOf, itemLabel, moveItem, toolbarOrder, type ToolbarDock, type ToolbarItem } from "./toolbar";
import type { SyncedStore } from "./sync/syncedStore";
import { applyToInk, applyToNotebook } from "./sync/writes";

// 요약을 보고 돌아왔을 때 되돌리기 기록을 이어 쓰려고 잠깐 맡겨 두는 곳 (필기 화면이 다시 열리면 가져간다)
let keptHistory: { id: string; hist: History } | null = null;

type Props = {
  store: SyncedStore;
  id: string;
  onClose: () => void;
  onExport: (nb: Notebook, ink: Ink) => Promise<void>;
  onSummarize: (nb: Notebook, ink: Ink, page: number) => void; // 서버로 자세히 (page: 보던 쪽 번호, 돌아올 때 쓴다)
  onQuick: (nb: Notebook, ink: Ink, page: number) => void; // 기기에서 바로
  startPage?: number; // 처음 열 쪽 번호 (0부터). 요약을 보고 돌아올 때 보던 쪽
};

export function Editor({ store, id, onClose, onExport, onSummarize, onQuick, startPage }: Props) {
  const t = useTheme();
  const win = useWindowDimensions();
  const [nb, setNb] = useState<Notebook | null>(null);
  const [ink, setInk] = useState<Ink>({});
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pi, setPi] = useState(startPage ?? 0);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<ZoomCmd>({ kind: "fit", n: 0 });
  const [bg, setBg] = useState<BgCache>({}); // 쪽 id → 바탕 그림
  const [menu, setMenu] = useState(false);
  const menuClosedAt = useRef(0); // ⋯ 메뉴가 닫힌 때
  const [panel, setPanel] = useState(false); // 도구 설정 창
  const [panelAt, setPanelAt] = useState<{ top: number; left: number } | null>(null); // 설정 창 자리 (도구 모음 바로 밑)
  const barRef = useRef<HostInstance>(null); // 도구 모음
  const rootRef = useRef<HostInstance>(null); // 화면 전체 (이름표 자리 계산용)
  const toolRefs = useRef<Partial<Record<ToolName, HostInstance | null>>>({}); // 도구 단추들
  const [grid, setGrid] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [textEdit, setTextEdit] = useState<{ page: string; x: number; y: number; stroke?: Stroke } | null>(null);
  const [jump, setJump] = useState<JumpCmd>({ id: "", n: 0 }); // 이 쪽이 보이게 화면을 옮기라는 부탁
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const [histStart] = useState(() => {
    const h = keptHistory?.id === id ? keptHistory.hist : new History();
    keptHistory = null;
    return h;
  });
  const hist = useRef(histStart);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const nbRef = useRef(nb);
  nbRef.current = nb;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const dirty = useRef(new Set<string>());
  const metaDirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bump] = useState(0); // 되돌리기 단추 상태 갱신용

  // ── 도구 모음 단추 이름표 ─────────────────────────────────
  // 단추 위에 S펜(웹은 마우스)을 띄우면 잠시 뒤 이름이 뜬다. 손가락으로 길게 눌러도 뜬다.
  // (안드로이드 기본 툴팁은 갤럭시탭에서 뜨지 않아서, 도구 모음을 감싼 S펜 뷰가 펜 자리(창 기준)를 알려 주면 여기서 단추를 찾는다)
  // 위·떠 있는 도구 모음은 단추 밑에, 왼쪽에 붙였으면 단추 오른쪽에, 오른쪽에 붙였으면 단추 왼쪽에 뜬다
  const [tip, setTip] = useState<{ label: string; r: number[]; side: "below" | "right" | "left" } | null>(null);
  const tipSide = useRef<"below" | "right" | "left">("below");
  const tipBtns = useRef(new Map<number, { label: string; ref: RefObject<HostInstance | null> }>());
  const tipGeo = useRef<{ at: number; root: number[] | null; items: { label: string; r: number[] }[] }>({ at: 0, root: null, items: [] });
  const tipMeasure = useRef<Promise<void> | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipOver = useRef<string | null>(null); // 펜이 떠 있는 단추
  const tipShown = useRef(false);
  const tipCtx = useMemo(() => {
    let next = 0;
    return {
      add: (label: string, ref: RefObject<HostInstance | null>) => {
        const k = next++;
        tipBtns.current.set(k, { label, ref });
        tipGeo.current.at = 0; // 단추가 바뀌었으니 다음에 다시 잰다
        return () => {
          tipBtns.current.delete(k);
          tipGeo.current.at = 0;
        };
      },
      press: (label: string, ref: RefObject<HostInstance | null>) => {
        void Promise.all([winOf(rootRef.current), winOf(ref.current)]).then(([root, r]) => {
          if (!root || !r) return;
          placeTip(label, r, root);
          if (tipTimer.current) clearTimeout(tipTimer.current);
          tipTimer.current = setTimeout(hideTip, 1500);
        });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 단추 자리(창 기준)를 화면 전체 기준으로 바꿔 이름표를 놓는다 */
  const placeTip = (label: string, r: number[], root: number[]) => {
    tipShown.current = true;
    setTip({ label, r: [r[0] - root[0], r[1] - root[1], r[2], r[3]], side: tipSide.current });
  };
  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    tipShown.current = false;
    setTip(null);
  };
  const measureTips = () => {
    tipMeasure.current ??= (async () => {
      const root = await winOf(rootRef.current);
      const items = await Promise.all([...tipBtns.current.values()].map(async (b) => ({ label: b.label, r: await winOf(b.ref.current) })));
      tipGeo.current = { at: Date.now(), root, items: items.filter((i): i is { label: string; r: number[] } => !!i.r) };
    })().finally(() => {
      tipMeasure.current = null;
    });
    return tipMeasure.current;
  };
  /** 펜이 떠 있는 자리 (창 기준 dp) */
  const onBarHover = useCallback(async (x: number, y: number, exit: boolean) => {
    if (exit) {
      tipOver.current = null;
      return hideTip();
    }
    if (Date.now() - tipGeo.current.at > 1000) await measureTips(); // 밀었거나 도구가 바뀌었을 수 있다
    const g = tipGeo.current;
    if (!g.root) return;
    const hit = g.items.find((i) => x >= i.r[0] - 2 && x <= i.r[0] + i.r[2] + 2 && y >= i.r[1] - 2 && y <= i.r[1] + i.r[3] + 2);
    const label = hit?.label ?? null;
    if (label === tipOver.current) return;
    tipOver.current = label;
    if (tipTimer.current) clearTimeout(tipTimer.current);
    if (!hit) {
      // 단추 사이를 지나는 중: 이미 떠 있던 이름표는 잠깐 두었다가 닫는다 (다음 단추로 옮겨 가면 바로 바뀌게)
      tipTimer.current = setTimeout(hideTip, 250);
      return;
    }
    const root = g.root;
    if (tipShown.current) placeTip(hit.label, hit.r, root);
    else tipTimer.current = setTimeout(() => placeTip(hit.label, hit.r, root), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
  }, []);

  // ── 도구 모음 옮기기: 손잡이를 끌거나 꾹 눌러 집으면 도구 모음이 손가락을 따라오고, 놓은 자리에 붙인다 ──
  // 끄는 동안 도구 모음은 원래 자리에 그대로 두고 화면에서만 밀어 옮긴다 (빼고 다시 그리면 끄는 손잡이가 사라져 끌기가 끊긴다).
  // 가장자리 가까이 가면 그쪽에 '붙이기' 띠를 보인다
  const [ghost, setGhost] = useState<{ x: number; y: number; dock: ToolbarDock } | null>(null);
  const [lifted, setLifted] = useState(false);
  const tbDX = useSharedValue(0);
  const tbDY = useSharedValue(0);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tbDX.value }, { translateY: tbDY.value }] }));
  const dragGeo = useRef<{ root: number[]; barBottom: number; grab: [number, number] } | null>(null);
  const stripRef = useRef<HostInstance>(null); // 왼쪽·오른쪽·떠 있는 도구 모음
  const [floatSize, setFloatSize] = useState({ w: 400, h: 52 });
  const floatSizeRef = useRef(floatSize);
  floatSizeRef.current = floatSize;
  const [tbEdit, setTbEdit] = useState(false); // 도구 모음 편집 창
  /** 도구 모음 집어 옮기기: 시작·움직임·놓기 (손잡이 끌기와 도구 모음 꾹 누르기가 함께 쓴다) */
  const tbDrag = useMemo(() => {
    const last = { x: 0, y: 0, x0: 0, y0: 0, dock: "" };
    const where = (x: number, y: number) => {
      const g = dragGeo.current;
      if (!g) return null;
      return { x: x - g.root[0], y: y - g.root[1], dock: dockAt(x - g.root[0], y - g.root[1], g.root[2], g.barBottom - g.root[1]) };
    };
    /** 붙일 자리가 바뀔 때만 화면을 다시 그린다 (움직일 때마다 편집 화면 전체를 다시 그리지 않게) */
    const showWhere = (x: number, y: number) => {
      const w = where(x, y);
      if ((w?.dock ?? "") === last.dock) return;
      last.dock = w?.dock ?? "";
      setGhost(w);
    };
    const reset = () => {
      setGhost(null);
      setLifted(false);
      tbDX.value = 0;
      tbDY.value = 0;
      dragGeo.current = null;
      last.dock = "";
    };
    return {
      begin: (x: number, y: number) => {
        hideTip();
        Object.assign(last, { x, y, x0: x, y0: y, dock: "" });
        setLifted(true);
        void Promise.all([winOf(rootRef.current), winOf(barRef.current), winOf(stripRef.current)]).then(([root, bar, strip]) => {
          // 윗줄이 없으면(왼쪽·오른쪽·떠 있게) 화면 맨 위 가까이가 '위에 붙이기'
          const box = bar ?? strip;
          // 도구 모음 안에서 손가락이 잡은 자리 (떠 있게 놓을 때 그 자리를 손가락 밑에 둔다)
          const grab: [number, number] = box ? [x - box[0], y - box[1]] : [20, 22];
          if (root) dragGeo.current = { root, barBottom: bar ? bar[1] + bar[3] : root[1] + 8, grab };
          showWhere(last.x, last.y);
        });
      },
      move: (x: number, y: number) => {
        last.x = x;
        last.y = y;
        tbDX.value = x - last.x0;
        tbDY.value = y - last.y0;
        showWhere(x, y);
      },
      end: () => {
        const w = where(last.x, last.y);
        const grab = dragGeo.current?.grab ?? [20, 22];
        const size = floatSizeRef.current;
        reset();
        if (!w || Math.abs(last.x - last.x0) + Math.abs(last.y - last.y0) < 8) return; // 살짝 누르기만 했다
        // 떠 있게: 잡은 자리가 손가락 밑에 오게 (윗줄처럼 길던 것이 짧아지면 잡은 자리를 막대 안으로 줄인다)
        const gx = Math.min(grab[0], size.w - 24), gy = Math.min(grab[1], size.h - 12);
        setP(w.dock === "float" ? { toolbarDock: "float", toolbarFloat: { x: w.x - gx, y: w.y - gy } } : { toolbarDock: w.dock });
      },
      cancel: reset,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 손잡이는 누르자마자 끈다 (도구 모음 전체의 '꾹 누르기'보다 먼저 잡히게 같은 제스처 도구로)
  const gripPan = usePanGesture({
    minDistance: 2,
    runOnJS: true,
    onActivate: (e) => tbDrag.begin(e.absoluteX - e.translationX, e.absoluteY - e.translationY),
    onUpdate: (e) => tbDrag.move(e.absoluteX, e.absoluteY),
    onDeactivate: () => tbDrag.end(),
    onFinalize: () => tbDrag.cancel(),
  });
  // 도구 모음 아무 데나 꾹 누르면(0.45초) 집어서 옮긴다
  const holdMove = usePanGesture({
    activateAfterLongPress: 450,
    runOnJS: true,
    onActivate: (e) => tbDrag.begin(e.absoluteX, e.absoluteY),
    onUpdate: (e) => tbDrag.move(e.absoluteX, e.absoluteY),
    onDeactivate: () => tbDrag.end(),
    onFinalize: () => tbDrag.cancel(),
  });

  // ── 불러오기 ────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const n = await store.load(id);
      if (!n) {
        if (alive) setLoadErr("노트를 열 수 없어요.");
        return;
      }
      const [k, u, p] = await Promise.all([store.loadInk(n), n.hasPdf ? store.pdfUri(n.id) : Promise.resolve(null), loadPrefs()]);
      if (!alive) return;
      setNb(n);
      setPi((i) => clampPage(i, n.pages.length)); // 그 사이 쪽이 줄었으면 마지막 쪽
      setInk(k);
      setPdfUri(u);
      setPrefs(p);
    })().catch((e) => alive && setLoadErr(String((e as Error).message)));
    return () => {
      alive = false;
    };
  }, [store, id]);

  // ── 저장 ────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const n = nbRef.current;
    if (!n) return;
    const pages = [...dirty.current];
    dirty.current.clear();
    // 저장 순간의 최신 내용을 읽는다 (그 사이 다른 기기에서 온 필기를 덮지 않게)
    for (const pid of pages) await store.savePageLatest(n.id, pid, () => inkRef.current[pid] ?? []);
    if (pages.length || metaDirty.current) {
      metaDirty.current = false;
      await store.saveLatest(() => {
        const next = { ...(nbRef.current ?? n), updated: Date.now() };
        nbRef.current = next;
        return next;
      });
    }
  }, [store]);

  // ── 다른 기기에서 바뀐 것 바로 반영 (실시간 동기화) ───────
  const piRef = useRef(0);
  useEffect(() => store.subscribe((e) => {
    if (e.kind === "folders" || e.nb !== id) return;
    if (e.kind === "deleted") {
      setLoadErr("다른 기기에서 이 노트를 지웠어요.");
      return;
    }
    if (e.kind === "pdf") {
      setBg({});
      store.pdfUri(id).then(setPdfUri).catch(() => undefined);
      return;
    }
    if (e.kind !== "remote") return;
    const cur = nbRef.current;
    if (!cur) return;
    const curPage = cur.pages[piRef.current]?.id;
    const nbNext = applyToNotebook(cur, id, e.writes.filter((w) => w.t === "nb" || w.t === "page"));
    if (nbNext && nbNext !== cur) {
      nbRef.current = nbNext;
      setNb(nbNext);
      const i = nbNext.pages.findIndex((p) => p.id === curPage);
      if (i >= 0 && i !== piRef.current) setPi(i); // 앞에 쪽이 끼어도 보던 쪽에 머문다
      if (nbNext.hasPdf && !cur.hasPdf) store.pdfUri(id).then(setPdfUri).catch(() => undefined);
    }
    const inkNext = applyToInk(inkRef.current, id, e.writes);
    if (inkNext !== inkRef.current) {
      inkRef.current = inkNext;
      setInk(inkNext);
    }
  }), [store, id]);

  const touch = useCallback((pageId?: string) => {
    if (pageId) dirty.current.add(pageId);
    else metaDirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    // 획이 끝나면 곧 저장 (오래 미루면 그 사이 앱·창이 닫혔을 때 마지막 획이 사라진다).
    // 너무 바로 하면 이어 쓰는 획마다 쪽 전체를 다시 적게 되므로 조금은 기다린다. 앱이 뒤로 갈 때는 아래에서 바로 저장한다
    timer.current = setTimeout(() => void flush(), 350);
  }, [flush]);

  useEffect(() => () => void flush(), [flush]);

  // 앱이 뒤로 가면(홈 단추·다른 앱으로) 기다리지 않고 바로 저장
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") void flush();
    });
    return () => sub.remove();
  }, [flush]);

  const close = async () => {
    if (audioRef.current.live) await audioRef.current.stop(); // 녹음 중이면 저장하고 나간다
    await flush();
    onClose();
  };

  // ── 쪽 바탕 그림 (PDF) ──────────────────────────────────
  const page = nb?.pages[Math.min(pi, (nb?.pages.length ?? 1) - 1)];
  const bgRef = useRef(bg);
  bgRef.current = bg;
  const loadBg = useCallback((index: number, px: number) => {
    const n = nbRef.current;
    const pg = n?.pages[index];
    if (!n || !pdfUri || !pg || pg.pdf === undefined) return;
    // 쪽 번호가 아니라 쪽 id로 기억한다 (쪽을 끼우거나 지워도 그림이 다른 쪽으로 밀리지 않게)
    const key = pg.id;
    const have = bgRef.current[key]?.w ?? 0;
    if (have >= px * 0.9) return;
    pageImage(n.id, pdfUri, pg.pdf, px)
      .then((uri) => setBg((b) => ((b[key]?.w ?? 0) >= px ? b : { ...b, [key]: { uri, w: px } })))
      .catch(() => setToast("이 쪽의 PDF를 그리지 못했어요."));
  }, [pdfUri]);

  // 화면 근처에 있는 쪽(위아래로 이어 볼 때·두 쪽씩 볼 때는 여러 쪽)과 그다음 쪽까지 미리
  const [near, setNear] = useState<[number, number]>([pi, pi]);
  const onVisible = useCallback((first: number, last: number) => setNear([first, last]), []);
  const [wantPx, setWantPx] = useState(0);
  useEffect(() => {
    if (!nb) return;
    const px = Math.min(4096, Math.max(1024, wantPx || 1400));
    loadBg(pi, px);
    const last = Math.min(nb.pages.length - 1, Math.max(near[1], pi) + 1);
    for (let i = Math.max(0, Math.min(near[0], pi)); i <= last; i++) loadBg(i, px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi, near, wantPx, nb?.pages, pdfUri]);

  const viewPx = useRef(0); // 쪽이 화면에서 차지하는 폭 (펜 견본을 같은 배율로 보여 주려고)
  const onViewWidth = useCallback((pagePx: number) => {
    viewPx.current = pagePx;
    setWantPx(Math.min(4096, Math.ceil(pagePx * PixelRatio.get() / 256) * 256));
  }, []);

  /** 이 쪽을 지금 쪽으로 (도구 모음의 쪽 번호). jump면 화면도 그 쪽으로 옮긴다 */
  const showPage = (i: number, pages = nbRef.current?.pages ?? []) => {
    const k = Math.max(0, Math.min(pages.length - 1, i));
    setPi(k);
    if (pages[k]) setJump((j) => ({ id: pages[k].id, n: j.n + 1 }));
  };
  /** 손이 닿은 쪽을 지금 쪽으로 (화면은 그대로). 그 쪽 정보를 돌려준다 */
  const activate = (pageId: string) => {
    const pages = nbRef.current?.pages ?? [];
    const i = pages.findIndex((x) => x.id === pageId);
    if (i < 0) return undefined;
    if (i !== piRef.current) {
      piRef.current = i;
      setPi(i);
    }
    return pages[i];
  };
  /** 화면을 옮겨 가운데 쪽이 바뀜 */
  const onShown = useCallback((pageId: string) => {
    const i = (nbRef.current?.pages ?? []).findIndex((x) => x.id === pageId);
    if (i >= 0 && i !== piRef.current) setPi(i);
  }, []);

  // ── 도구 ────────────────────────────────────────────────
  const setP = (patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...(p as Prefs), ...patch };
      void savePrefs(next);
      return next;
    });
  };

  const say = (s: string) => {
    setToast(s);
    setTimeout(() => setToast((x) => (x === s ? "" : x)), s.length > 40 ? 4200 : 2600);
  };

  // ── 강의 녹음 ───────────────────────────────────────────
  // 녹음 중에 쓴 획에 녹음 시각을 붙이고, 재생 막대에서 '필기 눌러 듣기'를 켜면 필기를 눌러 그때부터 듣는다
  const audio = useLectureAudio({ store, nbId: id, say });
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const [listening, setListening] = useState(false); // 필기 눌러 듣기
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  const [follow, setFollow] = useState(true); // 재생하면 그때 쓰던 쪽으로 따라가기
  const playing = !!audio.cur && audio.status.playing;
  const fadeMs = audio.cur ? fadeStep(audio.status.currentTime) : 0;

  // S펜 옆 단추를 (펜을 띄운 채) 두 번 누르면 등록한 도구로, 한 번 더 두 번 누르면 원래대로
  const swapSaved = useRef<SwapSaved | null>(null);
  const onPenDouble = useCallback(() => {
    const p = prefsRef.current;
    if (!p) return;
    const r = penSwap(p, swapSaved.current);
    if (!r) return;
    swapSaved.current = r.saved;
    if (Object.keys(r.patch).length) setP(r.patch);
    say(r.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⋯ 메뉴가 닫힌 때를 적어 둔다 (메뉴 항목을 빠르게 두 번 누르면 둘째 누름이 밑의 종이에 닿는다)
  useEffect(() => {
    if (!menu) return; // 열렸다가 닫힐 때만 (노트를 막 열었을 때는 아님)
    return () => {
      menuClosedAt.current = Date.now();
    };
  }, [menu]);
  /** 저장하지 않을 획: 화면에 남은 '방금 그은 선'만 지운다 (PageCanvas는 strokes가 바뀔 때 지운다) */
  const dropLive = (pageId: string) => setInk((k) => ({ ...k, [pageId]: [...(k[pageId] ?? [])] }));

  const onStroke = useCallback((pts: number[], stylus: boolean, pageId: string) => {
    const n = nbRef.current;
    const p = prefs;
    const page = activate(pageId);
    if (!n || !p || !page) return;
    // 메뉴가 닫힌 바로 뒤에 끝난 획(둘째 누름이 찍은 점)과, 형광펜으로 톡 누르기만 한 안 보이는 획은 남기지 않는다
    if (justAfter(Date.now(), menuClosedAt.current) || (p.tool === "highlighter" && isHighlighterTap(pts))) return dropLive(page.id);
    if (stylus && p.fingerDraw && !p.stylusSeen) {
      // 펜을 처음 쓰면: 손가락은 화면 옮기기로 (손바닥이 닿아도 써지지 않게)
      setP({ fingerDraw: false, stylusSeen: true });
      say("펜이 감지되어 손가락은 화면 옮기기로 바꿨어요. 도구 모음의 '손가락' 단추로 바꿀 수 있어요.");
    }
    const hl = p.tool === "highlighter";
    let clean = thin(pts, 0.35);
    let w = hl ? p.hlWidth : p.penWidth;
    if (hl && p.straight) {
      // 긋는 동안 화면에 보인 곧은 선과 똑같게 (처음 점들 그대로 곧게 편다)
      const st = straighten(pts);
      if (st.length === 6) clean = st;
    }
    // 이 쪽 글자 상자 (방금 다른 쪽으로 옮겨 와 쓴 획이면 전에 읽어 둔 것)
    const pageChars = chars.current.page === page.id ? chars.current.chars : charCache.current.get(page.id) ?? null;
    if (hl && p.hlFit && pageChars) {
      // 글자 크기에 맞춰: 칠한 글줄의 높이·글자 끝에 맞춘다
      const f = fitHighlight(clean, w, pageChars);
      if (f) {
        clean = f.pts;
        w = f.width;
      }
    }
    if (!hl && p.shapes) clean = snapShape(clean)?.pts ?? clean;
    const s: Stroke = {
      id: newId(),
      tool: hl ? "highlighter" : "pen",
      color: hl ? p.hlColor : p.penColor,
      width: w,
      pts: clean.map((v) => Math.round(v * 100) / 100),
      ...(hl
        ? p.hlOpacity !== HIGHLIGHT_OPACITY ? { opacity: p.hlOpacity } : {}
        : { ...(p.penBrush !== "fountain" ? { brush: p.penBrush } : {}), ...(p.penDash !== "solid" ? { dash: p.penDash } : {}) }),
      ...(audioRef.current.stamp() ?? {}), // 녹음 중이면 녹음 id·시각
    };
    setInk((k) => hist.current.run(k, { kind: "add", page: page.id, strokes: [s] }));
    touch(page.id);
    bump((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, touch]);

  // 지우개
  //  - 획 지우개: 문지르는 동안 닿은 획을 감췄다가, 손을 떼면 한 번의 작업으로 지운다
  //  - 영역 지우개: 문지른 자리만 지우고 획을 조각낸다 (바로 보이게), 손을 떼면 한 번의 작업으로 기록
  const erased = useRef(new Set<string>());
  const lastErase = useRef<[number, number] | null>(null);
  const area = useRef<{ start: Ink; at: Map<string, number>; orig: Map<string, Stroke>; root: Map<string, string> } | null>(null);
  const onErase = useCallback((phase: 0 | 1 | 2, x: number, y: number, r: number, pageId: string) => {
    const page = phase === 0 ? activate(pageId) : nbRef.current?.pages.find((q) => q.id === pageId);
    if (!page || !prefs) return;
    // 사진·그림 스티커는 지우개로 지우지 않는다 (올가미로 골라 지우기) — 그 위에 쓴 필기만 지워지게
    const canErase = (s: Stroke) => s.tool !== "image" && (!prefs.eraserHlOnly || s.tool === "highlighter");
    if (phase === 0) {
      erased.current = new Set();
      lastErase.current = [x, y];
      if (prefs.eraserMode === "area") {
        const start = inkRef.current;
        area.current = { start, at: new Map((start[page.id] ?? []).map((s, i) => [s.id, i])), orig: new Map(), root: new Map() };
      }
    }
    if (phase === 0 || phase === 1) {
      const from = lastErase.current ?? [x, y];
      lastErase.current = [x, y];
      const A = area.current;
      if (prefs.eraserMode === "area" && A) {
        const cur = inkRef.current[page.id] ?? [];
        let changed = false;
        const next: Stroke[] = [];
        for (const s of cur) {
          const pieces = canErase(s) ? eraseFrom(s, from[0], from[1], x, y, r, newId) : null;
          if (!pieces) {
            next.push(s);
            continue;
          }
          changed = true;
          const root = A.root.get(s.id) ?? s.id;
          if (!A.orig.has(root)) A.orig.set(root, s);
          for (const p of pieces) {
            A.root.set(p.id, root);
            next.push(p);
          }
        }
        if (changed) {
          const k = { ...inkRef.current, [page.id]: next };
          inkRef.current = k;
          setInk(k);
        }
        return;
      }
      const cur = (inkRef.current[page.id] ?? []).filter((s) => !erased.current.has(s.id) && canErase(s));
      const hit = hitAlong(cur, from[0], from[1], x, y, r);
      if (hit.length) {
        for (const s of hit) erased.current.add(s.id);
        setHidden(new Set(erased.current));
      }
      return;
    }
    const A = area.current;
    area.current = null;
    if (A) {
      if (!A.orig.size) return;
      // 처음 모습(start)에 '조각내기' 한 번으로 기록 → 되돌리기 한 번에 원래대로
      const before = [...A.orig.values()].sort((p, q) => (A.at.get(p.id) ?? 0) - (A.at.get(q.id) ?? 0));
      const after = (inkRef.current[page.id] ?? []).filter((s) => A.root.has(s.id));
      const op: Op = { kind: "split", page: page.id, before, at: before.map((s) => A.at.get(s.id) ?? 0), after, from: after.map((s) => A.root.get(s.id)!) };
      const k = hist.current.run(A.start, op);
      inkRef.current = k;
      setInk(k);
      touch(page.id);
      bump((v) => v + 1);
      return;
    }
    const op = removal(inkRef.current, page.id, erased.current);
    if (op) {
      setInk((k) => hist.current.run(k, op));
      touch(page.id);
      bump((v) => v + 1);
    }
    erased.current = new Set();
    setHidden(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, touch]);

  // 이 쪽 손글씨 모두 지우기 (글상자 포함, 되돌리기 가능)
  const clearPage = () => {
    if (!page) return;
    const all = inkRef.current[page.id] ?? [];
    const go2 = () => {
      const op = removal(inkRef.current, page.id, new Set(all.map((s) => s.id)));
      if (op) {
        setInk((k) => hist.current.run(k, op));
        touch(page.id);
        bump((v) => v + 1);
      }
      setPanel(false);
    };
    if (!all.length) return setPanel(false);
    const msg = `이 쪽의 필기 ${all.length}개를 모두 지울까요? (되돌리기로 되살릴 수 있어요)`;
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(msg) ?? true) go2();
    } else {
      Alert.alert("손글씨 모두 지우기", msg, [{ text: "취소", style: "cancel" }, { text: "지우기", style: "destructive", onPress: go2 }]);
    }
  };

  // 형광펜 '글자 크기에 맞춰': 지금 쪽의 PDF 글자 상자 (없으면 글자 인식으로)
  const chars = useRef<{ page: string; chars: CharBox[] | null }>({ page: "", chars: null });
  const charCache = useRef(new Map<string, CharBox[] | null>());
  useEffect(() => {
    if (!page || page.pdf === undefined || !pdfUri || prefs?.tool !== "highlighter" || !prefs.hlFit) return;
    const key = page.id;
    if (charCache.current.has(key)) {
      chars.current = { page: key, chars: charCache.current.get(key) ?? null };
      return;
    }
    let alive = true;
    pageText(pdfUri, page.pdf)
      .then((c) => {
        charCache.current.set(key, c);
        if (alive) chars.current = { page: key, chars: c };
      })
      .catch(() => charCache.current.set(key, null));
    return () => {
      alive = false;
    };
  }, [page?.id, page?.pdf, pdfUri, prefs?.tool, prefs?.hlFit]);

  // ── 올가미: 고르기 · 옮기기 · 색 바꾸기 · 지우기 ───────────
  const selBox = (strokes: Stroke[]): [number, number, number, number] => {
    const bs = strokes.map(bounds);
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
  };
  const onLasso = useCallback((pts: number[], pageId: string) => {
    const page = activate(pageId);
    if (!page) return;
    const cur = inkRef.current[page.id] ?? [];
    const ids = lassoSelect(cur, pts, prefs?.lassoPartial ?? false);
    if (!ids.size) return setSelection(null);
    setSelection({ page: page.id, ids, box: selBox(cur.filter((s) => ids.has(s.id))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.lassoPartial]);
  // 고른 것은 고른 쪽에 있다 (위아래로 이어 볼 때는 지금 쪽 번호가 바뀌어도 그대로 둔다)
  const replaceSelected = (fn: (s: Stroke) => Stroke) => {
    if (!selection) return;
    const pid = selection.page;
    const before = (inkRef.current[pid] ?? []).filter((s) => selection.ids.has(s.id));
    if (!before.length) return;
    const after = before.map(fn);
    setInk((k) => hist.current.run(k, { kind: "replace", page: pid, before, after }));
    setSelection({ page: pid, ids: selection.ids, box: selBox(after) });
    touch(pid);
    bump((x) => x + 1);
  };
  /** 고른 것 크게·작게 (고른 상자 가운데를 기준으로) */
  const resizeSelected = (k: number) => {
    if (!selection) return;
    const [x0, y0, x1, y1] = selection.box;
    replaceSelected((s) => scaled(s, k, (x0 + x1) / 2, (y0 + y1) / 2));
  };
  const onMoveSelection = useCallback((dx: number, dy: number) => {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    replaceSelected((s) => moved(s, dx, dy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  const deleteSelected = () => {
    if (!selection) return;
    const op = removal(inkRef.current, selection.page, selection.ids);
    if (op) {
      setInk((k) => hist.current.run(k, op));
      touch(selection.page);
      bump((x) => x + 1);
    }
    setSelection(null);
  };
  useEffect(() => {
    if (prefs?.tool !== "lasso") setSelection(null);
  }, [prefs?.tool]);
  // 고른 쪽이 지워졌으면 고른 것도 푼다
  useEffect(() => {
    setSelection((cur) => (cur && !nb?.pages.some((x) => x.id === cur.page) ? null : cur));
  }, [nb?.pages]);

  // ── 글상자 ──────────────────────────────────────────────
  const onTextTap = useCallback((x: number, y: number, pageId: string) => {
    if (justAfter(Date.now(), menuClosedAt.current)) return; // 메뉴를 두 번 누른 둘째 누름은 넘긴다
    const page = activate(pageId);
    if (!page) return;
    if (listeningRef.current) {
      // 필기 눌러 듣기: 그 자리 획을 쓰던 때(조금 앞)부터
      const st = timedStrokeAt(inkRef.current[page.id] ?? [], x, y, 10);
      if (!st) return say("녹음하면서 쓴 필기를 눌러 주세요.");
      const rec = audioRef.current.recs.find((r) => r.id === st.rec);
      if (!rec) return say("이 필기의 녹음이 이 기기에 없어요. (녹음은 녹음한 기기에만 있어요)");
      void audioRef.current.play(rec, seekFor(st));
      return;
    }
    const hit = [...(inkRef.current[page.id] ?? [])].reverse().find((s) => s.tool === "text" && !s.stamp && hitAlong([s], x, y, x, y, 2).length); // 도장 스티커는 글상자 고치기에서 뺀다
    setTextEdit(hit ? { page: page.id, x: hit.pts[0], y: hit.pts[1], stroke: hit } : { page: page.id, x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveText = (text: string, size: number) => {
    const ed = textEdit;
    setTextEdit(null);
    const page = ed ? nbRef.current?.pages.find((x) => x.id === ed.page) : undefined;
    if (!ed || !page || !prefs) return;
    if (size !== prefs.textSize) setP({ textSize: size });
    const color = ed.stroke?.color ?? prefs.penColor;
    if (ed.stroke) {
      if (!text.trim()) {
        const op = removal(inkRef.current, page.id, new Set([ed.stroke.id]));
        if (op) setInk((k) => hist.current.run(k, op));
      } else {
        const after = makeTextBox(ed.stroke.id, ed.x, ed.y, text, size, color, page.w);
        setInk((k) => hist.current.run(k, { kind: "replace", page: page.id, before: [ed.stroke!], after: [after] }));
      }
    } else if (text.trim()) {
      const s = { ...makeTextBox(newId(), ed.x, ed.y, text, size, color, page.w), ...(audioRef.current.stamp() ?? {}) };
      setInk((k) => hist.current.run(k, { kind: "add", page: page.id, strokes: [s] }));
    }
    touch(page.id);
    bump((v) => v + 1);
  };

  // 되돌리기 기록은 노트 전체에 하나다. 바뀐 필기가 다른 쪽에 있으면 그 쪽으로 넘겨서 보여 준다 (안 보이는 쪽이 말없이 바뀌지 않게)
  const showChanged = (pageId: string | undefined, what: string) => {
    const i = otherPage(nbRef.current?.pages ?? [], page?.id, pageId);
    if (i < 0) return;
    showPage(i);
    say(`${what} 필기가 ${i + 1}쪽에 있어서 그 쪽으로 넘겼어요.`);
  };
  const undo = () => {
    setSelection(null);
    const r = hist.current.undo(inkRef.current);
    setInk(r.ink);
    if (r.page) touch(r.page);
    showChanged(r.page, "되돌린");
    bump((x) => x + 1);
  };
  const redo = () => {
    setSelection(null);
    const r = hist.current.redo(inkRef.current);
    setInk(r.ink);
    if (r.page) touch(r.page);
    showChanged(r.page, "다시 한");
    bump((x) => x + 1);
  };

  // ── 쪽 ──────────────────────────────────────────────────
  const go = (i: number) => {
    if (!nb) return;
    showPage(i, nb.pages);
  };
  const addPage = (paper?: Paper) => {
    if (!nb) return;
    const next = insertPage(nb, pi, paper);
    setNb(next);
    nbRef.current = next;
    touch();
    showPage(pi + 1, next.pages);
    setMenu(false);
  };
  const deletePage = () => {
    if (!nb || nb.pages.length <= 1 || !page) return;
    const doIt = () => {
      const next = removePage(nb, pi);
      setNb(next);
      nbRef.current = next;
      setInk((k) => {
        const c = { ...k };
        delete c[page.id];
        return c;
      });
      hist.current.clear();
      dirty.current.add(page.id);
      touch();
      setBg({});
      showPage(Math.min(pi, next.pages.length - 1), next.pages);
      setMenu(false);
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm?.("이 쪽을 지울까요? 쪽의 필기도 함께 지워집니다.") ?? true) doIt();
    } else {
      Alert.alert("이 쪽을 지울까요?", "쪽의 필기도 함께 지워집니다.", [{ text: "취소", style: "cancel" }, { text: "지우기", style: "destructive", onPress: doIt }]);
    }
  };

  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = (title: string) => {
    if (!nb || !title.trim()) return setRenaming(null);
    const next = { ...nb, title: title.trim() };
    setNb(next);
    nbRef.current = next;
    touch();
    setRenaming(null);
  };

  const exportPdf = async () => {
    if (!nb) return;
    setMenu(false);
    setBusy("PDF 만드는 중…");
    try {
      await flush();
      await onExport(nbRef.current ?? nb, inkRef.current);
    } catch (e) {
      say(`내보내지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  };

  const summarize = async () => {
    if (!nb) return;
    setMenu(false);
    await flush();
    keptHistory = { id, hist: hist.current }; // 요약을 보고 돌아와도 되돌리기가 이어지게
    onSummarize(nbRef.current ?? nb, inkRef.current, piRef.current);
  };
  const quick = async () => {
    if (!nb) return;
    setMenu(false);
    await flush();
    keptHistory = { id, hist: hist.current };
    onQuick(nbRef.current ?? nb, inkRef.current, piRef.current);
  };

  // 재생 중 쪽 따라가기: 지금 들리는 때에 쓰던 쪽으로
  useEffect(() => {
    if (!playing || !follow || !audio.cur) return;
    const pid = pageAt(inkRef.current, audio.cur.id, fadeMs);
    const i = pid ? (nbRef.current?.pages.findIndex((x) => x.id === pid) ?? -1) : -1;
    if (i >= 0 && i !== piRef.current) showPage(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fadeMs, playing, follow]);

  // ── 사진·스티커 넣기 ───────────────────────────────────
  // 화면 가운데(지금 쪽)에 넣고 바로 올가미로 골라 둔다 → 끌어서 옮기거나 '크게·작게'
  const viewRef = useRef<(() => ViewSpot | null) | null>(null);
  const [insertMenu, setInsertMenu] = useState(false);
  const [stickerSheet, setStickerSheet] = useState(false);
  const addObjects = (pageId: string, strokes: Stroke[]) => {
    setInk((k) => hist.current.run(k, { kind: "add", page: pageId, strokes }));
    touch(pageId);
    bump((x) => x + 1);
    activate(pageId);
    setP({ tool: "lasso" });
    setSelection({ page: pageId, ids: new Set(strokes.map((x) => x.id)), box: selBox(strokes) });
  };
  /** 지금 보는 곳 (지금 쪽, 쪽 좌표). 화면을 모르면 쪽 가운데 */
  const spot = (): { pg: { id: string; w: number; h: number }; x: number; y: number; w: number; h: number } | null => {
    const n = nbRef.current;
    const v = viewRef.current?.();
    const pg = (v && n?.pages.find((x) => x.id === v.page)) || n?.pages[piRef.current];
    if (!pg) return null;
    return v ? { pg, x: v.x, y: v.y, w: Math.min(v.w, pg.w), h: Math.min(v.h, pg.h) } : { pg, x: pg.w / 2, y: pg.h / 2, w: pg.w, h: pg.h };
  };
  /** 그림 넣기: 보이는 곳의 절반 안에 들어가는 크기로 (fixed면 그 폭으로) */
  const placePicture = (pic: Picture, fixed?: number) => {
    const at = spot();
    if (!at) return;
    const k = fixed ? fixed / pic.w : Math.min((at.w * 0.5) / pic.w, (at.h * 0.5) / pic.h, (at.pg.w * 0.8) / pic.w);
    const w = Math.round(pic.w * k * 10) / 10, h = Math.round(pic.h * k * 10) / 10;
    const x = Math.max(0, Math.min(at.pg.w - w, at.x - w / 2)), y = Math.max(0, Math.min(at.pg.h - h, at.y - h / 2));
    addObjects(at.pg.id, [makeImage(newId(), x, y, w, h, pic.uri)]);
  };
  const insertPhoto = async () => {
    setInsertMenu(false);
    try {
      const pic = await pickPhoto();
      if (pic) placePicture(pic);
    } catch (e) {
      say((e as Error).message);
    }
  };
  const insertPaste = async () => {
    setInsertMenu(false);
    try {
      const pic = await clipboardPicture();
      if (pic) placePicture(pic);
      else say("복사한 사진이 없어요. 사진을 길게 눌러 '복사'한 뒤 다시 해 보세요.");
    } catch (e) {
      say(`붙여넣지 못했어요: ${(e as Error).message}`);
    }
  };
  const insertSticker = (st: Sticker) => {
    setStickerSheet(false);
    const pic = stickerPicture(st);
    const at = spot();
    if (pic && at) placePicture(pic, Math.min(64, at.w * 0.2));
  };
  const insertStamp = (text: string, color: string) => {
    setStickerSheet(false);
    const at = spot();
    if (at) addObjects(at.pg.id, [makeStamp(newId(), at.x, at.y, text, color)]);
  };
  // 웹: Ctrl+V로 복사한 그림 붙여넣기 (글 쓰는 칸 안에서는 그 칸에)
  const pasteRef = useRef(placePicture);
  pasteRef.current = placePicture;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onPaste = (e: Event) => {
      const ev = e as ClipboardEvent;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const file = [...(ev.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      ev.preventDefault();
      void fileToDataUri(file).then((u) => {
        const pic = shrinkDataUri(u);
        if (pic) pasteRef.current(pic);
      });
    };
    globalThis.addEventListener?.("paste", onPaste);
    return () => globalThis.removeEventListener?.("paste", onPaste);
  }, []);

  // 키보드(웹·키보드 달린 태블릿의 웹판): Ctrl+Z 되돌리기, Ctrl+Shift+Z·Ctrl+Y 다시 하기. 글 쓰는 칸 안에서는 그 칸의 되돌리기를 그대로 둔다
  const keys = useRef({ undo, redo });
  keys.current = { undo, redo };
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) keys.current.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) keys.current.redo();
      else return;
      e.preventDefault();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, []);

  // 안드로이드 '뒤로': 열린 창이나 고른 것이 있으면 그것부터 닫고, 없으면 저장한 뒤 노트 목록으로 (앱 밖으로 나가지 않게)
  const onBack = useRef(() => {});
  onBack.current = () => {
    if (menu) setMenu(false);
    else if (panel) setPanel(false);
    else if (grid) setGrid(false);
    else if (textEdit) setTextEdit(null);
    else if (renaming !== null) setRenaming(null);
    else if (selection) setSelection(null);
    else void close();
  };
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  piRef.current = pi;

  if (loadErr) {
    return (
      <SafeAreaView style={[sx.center, { backgroundColor: t.bg }]}>
        <Text style={[type.body, { color: t.bad, textAlign: "center" }]}>{loadErr}</Text>
        <Button label="‹ 노트 목록" onPress={onClose} />
      </SafeAreaView>
    );
  }
  if (!nb || !prefs || !page) {
    return (
      <SafeAreaView style={[sx.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.muted} />
      </SafeAreaView>
    );
  }

  const tool = prefs.tool;
  const colors = tool === "highlighter" ? HIGHLIGHT_COLORS : PEN_COLORS;
  const widths = tool === "highlighter" ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
  const color = tool === "highlighter" ? prefs.hlColor : prefs.penColor;
  const width = tool === "highlighter" ? prefs.hlWidth : prefs.penWidth;
  const edge = swatchEdge(t.card); // 색 단추 테두리 (어두운 모드에서도 검정 단추가 보이게)
  const narrow = win.width < 480; // 세로로 든 폰 (고르기 안내 줄을 두 줄로)
  const pad = win.width >= 700 ? 16 : 8; // 화면 양옆 여백
  const dock: ToolbarDock = prefs.toolbarDock;
  const vertBar = dock === "left" || (dock === "float" && (prefs.toolbarShape ?? "row") === "column");
  tipSide.current = vertBar ? "right" : dock === "right" ? "left" : "below";
  const order = toolbarOrder(prefs.toolbar);
  const hiddenItems = new Set(prefs.toolbarHidden);
  /** 도구 설정 창 열기 — 위·떠 있는 도구 모음이면 도구 모음 바로 밑 지금 도구 단추 왼쪽 끝에,
   *  왼쪽·오른쪽에 붙였으면 도구 모음 옆 지금 도구 단추 높이에 */
  const openPanel = () => {
    const btn = toolRefs.current[tool];
    const box = dock === "top" ? barRef.current : stripRef.current;
    void Promise.all([winOf(box), winOf(btn ?? null)]).then(([b, r]) => {
      if (!b) setPanelAt(null);
      else if (vertBar) setPanelAt({ top: r ? r[1] : b[1], left: b[0] + b[2] + 4 });
      else if (dock === "right") setPanelAt({ top: r ? r[1] : b[1], left: b[0] - PANEL_W - 4 });
      else setPanelAt({ top: b[1] + b[3] + 4, left: r ? r[0] : b[0] + 12 });
      setPanel(true);
    });
  };
  const toolRef = (name: ToolName) => (v: HostInstance | null) => {
    toolRefs.current[name] = v;
  };
  /** 도구 고르기 — 이미 고른 도구를 한 번 더 누르면 설정 창 */
  const pick = (next: ToolName) => (tool === next ? openPanel() : setP({ tool: next }));
  const penName = PENS.find((x) => x.id === prefs.penBrush)?.label ?? "펜";

  /** 도구 모음 항목 하나 (vertical: 왼쪽·오른쪽에 붙여 세로로 늘어놓을 때) */
  const item = (id: ToolbarItem, vertical: boolean): ReactNode => {
    const line = vertical ? sx.swatchesCol : sx.swatches;
    switch (id) {
      case "pen":
        return <ToolBtn ref={toolRef("pen")} icon="pen" label={penName} on={tool === "pen"} onPress={() => pick("pen")} hint="한 번 더 누르면 펜 설정" />;
      case "highlighter":
        return <ToolBtn ref={toolRef("highlighter")} icon="highlighter" label="형광펜" on={tool === "highlighter"} onPress={() => pick("highlighter")} hint="한 번 더 누르면 형광펜 설정" />;
      case "eraser":
        return <ToolBtn ref={toolRef("eraser")} icon="eraser" label={prefs.eraserMode === "area" ? "영역 지우개" : "지우개"} on={tool === "eraser"} onPress={() => pick("eraser")} hint="한 번 더 누르면 지우개 설정" />;
      case "lasso":
        return <ToolBtn ref={toolRef("lasso")} icon="lasso" label="올가미" on={tool === "lasso"} onPress={() => pick("lasso")} hint="둘러싸서 고르고 옮기기, 한 번 더 누르면 설정" />;
      case "text":
        return <ToolBtn ref={toolRef("text")} icon="text" label="글상자" on={tool === "text"} onPress={() => setP({ tool: "text" })} hint="쪽을 누르면 글을 써 넣어요" />;
      case "record":
        return (
          <View style={vertical ? sx.swatchesCol : sx.swatches}>
            {audio.live ? (
              <Pressable onPress={() => void audio.stop()} accessibilityRole="button" accessibilityLabel={`녹음 멈추기 (${clock(audio.elapsed)})`} style={({ pressed }) => [sx.recLive, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={sx.recDot} />
                {!vertical && <Text style={sx.recTime}>{clock(audio.elapsed)}</Text>}
              </Pressable>
            ) : (
              <IconBtn icon="mic" onPress={() => void audio.start()} label="강의 녹음" />
            )}
            {audio.recs.length > 0 && !audio.live && (
              <IconBtn icon="headphones" onPress={() => void audio.play(audio.cur ?? audio.recs[audio.recs.length - 1])} label="녹음 듣기" />
            )}
          </View>
        );
      case "insert":
        return <IconBtn icon="image" onPress={() => setInsertMenu(true)} label="사진·스티커 넣기" />;
      case "colors":
        if (tool === "text") {
          return (
            <View style={line}>
              {PEN_COLORS.map((c) => (
                <Swatch key={c} color={c} edge={edge} on={c === prefs.penColor} onPress={() => setP({ penColor: c })} label={`글 색 ${c}`} />
              ))}
            </View>
          );
        }
        if (tool === "eraser" || tool === "lasso") return null;
        return (
          <View style={line}>
            {colors.map((c) => (
              <Swatch key={c} color={c} edge={edge} on={c === color} onPress={() => setP(tool === "highlighter" ? { hlColor: c } : { penColor: c })} label={`색 ${c}`} />
            ))}
          </View>
        );
      case "widths":
        if (tool !== "pen" && tool !== "highlighter") return null;
        return (
          <View style={line}>
            {widths.map((w, i) => (
              <WidthDot key={w} size={6 + i * 6} on={w === width} onPress={() => setP(tool === "highlighter" ? { hlWidth: w } : { penWidth: w })} label={`굵기 ${i + 1}`} tipText={widthName(i)} />
            ))}
            {tool === "highlighter" ? (
              <ToolBtn icon="line" label="직선" on={prefs.straight} onPress={() => setP({ straight: !prefs.straight })} hint="처음 찍은 점에서 곧은 선으로" />
            ) : (
              <ToolBtn icon="shapes" label="도형 펴기" on={prefs.shapes} onPress={() => setP({ shapes: !prefs.shapes })} hint="선·사각형·원·삼각형을 반듯하게" />
            )}
          </View>
        );
      case "finger":
        return (
          <ToolBtn
            icon={prefs.fingerDraw ? "finger" : "hand"}
            label={prefs.fingerDraw ? "손가락: 쓰기" : "손가락: 이동"}
            on={false}
            onPress={() => setP({ fingerDraw: !prefs.fingerDraw })}
            hint="손가락으로 쓸지, 화면만 옮길지"
          />
        );
      case "zoom":
        return (
          <View style={line}>
            <IconBtn icon="minus" onPress={() => setZoom((z) => ({ kind: "out", n: z.n + 1 }))} label="축소" />
            <IconBtn icon="fit" onPress={() => setZoom((z) => ({ kind: "fit", n: z.n + 1 }))} label="맞춤 (쪽 폭에 맞추기)" />
            <IconBtn icon="plus" onPress={() => setZoom((z) => ({ kind: "in", n: z.n + 1 }))} label="확대" />
          </View>
        );
      case "undo":
        return (
          <View style={line}>
            <IconBtn icon="undo" onPress={undo} disabled={!hist.current.canUndo} label="되돌리기" />
            <IconBtn icon="redo" onPress={redo} disabled={!hist.current.canRedo} label="다시 하기" />
          </View>
        );
    }
  };
  /** 도구 모음 내용: 사용자가 정한 순서대로, 무리가 바뀔 때 나눔 줄. 맨 끝에 '도구 모음 접기'·'도구 모음 편집'.
   *  접었으면 지금 도구 하나와 '펼치기'만. part: 두 줄로 띄울 때 윗줄(0)·아랫줄(1) — 보이는 항목을 반씩 */
  const strip = (vertical: boolean, part?: 0 | 1) => {
    if (prefs.toolbarMin) {
      if (part === 1) return [];
      return [
        <Fragment key={tool}>{item(tool, vertical)}</Fragment>,
        <IconBtn key="grow" icon="grow" onPress={() => setP({ toolbarMin: false })} label="도구 모음 펼치기" />,
      ];
    }
    let items = order.filter((id) => !hiddenItems.has(id)).map((id) => [id, item(id, vertical)] as const).filter(([, n]) => !!n);
    if (part !== undefined) {
      const half = Math.ceil(items.length / 2);
      items = part === 0 ? items.slice(0, half) : items.slice(half);
    }
    const out: ReactNode[] = [];
    let last = "";
    for (const [id, node] of items) {
      if (out.length && groupOf(id) !== last) out.push(<Divider key={`d-${id}`} vertical={vertical} />);
      out.push(<Fragment key={id}>{node}</Fragment>);
      last = groupOf(id);
    }
    if (part === 0) return out;
    out.push(<Divider key="d-edit" vertical={vertical} />);
    out.push(<IconBtn key="shrink" icon="shrink" onPress={() => setP({ toolbarMin: true })} label="도구 모음 접기" />);
    out.push(<IconBtn key="edit" icon="sliders" onPress={() => setTbEdit(true)} label="도구 모음 편집" />);
    return out;
  };
  const backBtn = <IconBtn icon="back" onPress={close} label="노트 목록으로" />;
  /** 쪽 넘기기 ‹ 1 / 4 › (세로 도구 모음에서는 위·아래로). 가운데 쪽 번호를 누르면 쪽 모아보기 */
  const pageNav = (vertical: boolean) => (
    <View style={[vertical ? sx.pageNavV : sx.pageNav, { backgroundColor: t.sunken }]}>
      <IconBtn compact icon={vertical ? "up" : "prev"} onPress={() => go(pi - 1)} disabled={pi === 0} label="이전 쪽" />
      <Pressable onPress={() => setGrid(true)} accessibilityRole="button" accessibilityLabel="쪽 모아보기" style={sx.pageNo}>
        <Text style={[vertical ? type.caption : type.label, sx.tabular, { color: t.ink, textAlign: "center" }]}>{vertical ? `${pi + 1}\n/${nb.pages.length}` : `${pi + 1} / ${nb.pages.length}`}</Text>
      </Pressable>
      <IconBtn compact icon={vertical ? "down" : "next"} onPress={() => go(pi + 1)} disabled={pi >= nb.pages.length - 1} label="다음 쪽" />
    </View>
  );
  const moreBtn = <IconBtn icon="more" onPress={() => setMenu(true)} label="더 보기" />;
  const sumBtn = (vertical: boolean) => (
    <Button kind="primary" small label="요약" accessibilityLabel="요약 만들기" onPress={quick} style={vertical ? sx.sumV : undefined} />
  );
  const shape = prefs.toolbarShape ?? "row";
  /** 끌어서 옮기는 손잡이 */
  const gripView = (
    <GestureDetector gesture={gripPan}>
    <View collapsable={false} accessibilityRole="adjustable" accessibilityLabel="도구 모음 옮기기 (끌어서 왼쪽·오른쪽·위 끝에 놓으면 붙고, 가운데에 놓으면 떠 있어요)" hitSlop={6} style={sx.grip}>
      <ToolIcon name="grip" color={t.muted} size={18} />
    </View>
    </GestureDetector>
  );
  // 왼쪽·오른쪽에 붙인 도구 모음: 맨 위 돌아가기, 가운데 도구, 맨 아래 쪽·더 보기·요약·손잡이 (윗줄은 없앤다)
  // 손잡이(점 6개)는 어느 모양에서나 맨 끝(가로면 오른쪽 끝, 세로면 맨 아래)에 둔다 (사용자 요청)
  const sideStrip = (
    <Animated.View style={[lifted && sx.lifted, liftStyle]}>
    <StylusView onHover={onBarHover} style={{ flex: 1 }}>
      <GestureDetector gesture={holdMove}>
        <View ref={stripRef} collapsable={false} style={[sx.sideBar, { borderColor: t.lineSoft, backgroundColor: t.bg }, dock === "left" ? sx.sideLeft : sx.sideRight]}>
          {backBtn}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={sx.toolCol} keyboardShouldPersistTaps="handled">
            {strip(true)}
          </ScrollView>
          <View style={[sx.sideFoot, { borderColor: t.lineSoft }]}>
            {pageNav(true)}
            {moreBtn}
            {sumBtn(true)}
            {gripView}
          </View>
        </View>
      </GestureDetector>
    </StylusView>
    </Animated.View>
  );
  const fl = clampFloat(prefs.toolbarFloat?.x ?? 80, prefs.toolbarFloat?.y ?? 120, floatSize.w, floatSize.h, win.width, win.height, 4);

  return (
    <TipCtx.Provider value={tipCtx}>
    <SafeAreaView ref={rootRef} style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      {/* 맨 윗줄 (위에 붙였을 때만): 돌아가기 · 도구 모음 · 쪽 · 더 보기 · 요약 · 손잡이.
          노트 이름은 자리를 차지하지 않게 ⋯ 메뉴의 '이름 바꾸기'로. 좁으면 도구 모음만 옆으로 민다.
          왼쪽·오른쪽에 붙이거나 띄우면 윗줄을 없애고 그 자리를 쪽 화면이 쓴다 */}
      {dock === "top" && (
        <Animated.View style={[lifted && sx.lifted, liftStyle]}>
        <StylusView onHover={onBarHover}>
          <GestureDetector gesture={holdMove}>
            <View ref={barRef} collapsable={false} style={[sx.toolBar, { borderColor: t.lineSoft, backgroundColor: t.bg, paddingHorizontal: pad }]}>
              {backBtn}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.toolRow} keyboardShouldPersistTaps="handled" style={sx.toolScroll}>
                {strip(false)}
              </ScrollView>
              {pageNav(false)}
              {moreBtn}
              {sumBtn(false)}
              {gripView}
            </View>
          </GestureDetector>
        </StylusView>
        </Animated.View>
      )}

      <View style={sx.body}>
      {dock === "left" && sideStrip}
      <View style={sx.toolScroll}>
      <PageCanvas
        pages={nb.pages}
        ink={ink}
        bgOf={(p) => pageBg(bg, p)}
        active={page.id}
        jump={jump}
        flow={prefs.flow}
        two={prefs.twoPages}
        hidden={hidden}
        tool={tool}
        color={color}
        width={width}
        opacity={prefs.hlOpacity}
        dash={prefs.penDash}
        eraserPx={prefs.eraserSize}
        lassoRect={prefs.lassoMode === "rect"}
        fingerDraw={prefs.fingerDraw}
        straight={prefs.straight}
        zoom={zoom}
        onStroke={onStroke}
        onErase={onErase}
        onViewWidth={onViewWidth}
        selection={selection}
        onLasso={onLasso}
        onMoveSelection={onMoveSelection}
        onTextTap={onTextTap}
        onPenDouble={onPenDouble}
        onShown={onShown}
        onVisible={onVisible}
        viewRef={viewRef}
        tapOnly={listening && !!audio.cur}
        fade={audio.cur ? { rec: audio.cur.id, ms: fadeMs } : null}
      />
      </View>
      {dock === "right" && sideStrip}
      </View>

      {/* 떠 있는 도구 모음: 손잡이로 끌어 아무 데나 */}
      {dock === "float" && (
        <Animated.View style={[sx.floatWrap, { left: fl.x, top: fl.y }, lifted && sx.lifted, liftStyle]}>
        <StylusView onHover={onBarHover}>
          <GestureDetector gesture={holdMove}>
            <View
              ref={stripRef}
              collapsable={false}
              onLayout={(e) => setFloatSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
              style={[floating(t), shape === "column" ? sx.floatCol : shape === "two" ? sx.floatTwo : sx.floatBar, shape === "column" ? { maxHeight: win.height - 16 } : { maxWidth: win.width - 16 }]}
            >
              {shape === "column" ? (
                <>
                  {backBtn}
                  <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={sx.toolCol} keyboardShouldPersistTaps="handled">
                    {strip(true)}
                  </ScrollView>
                  {pageNav(true)}
                  {moreBtn}
                  {sumBtn(true)}
                  {gripView}
                </>
              ) : shape === "two" ? (
                <>
                  <View style={sx.floatLine}>
                    {backBtn}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.toolRow} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
                      {strip(false, 0)}
                    </ScrollView>
                    {pageNav(false)}
                  </View>
                  <View style={sx.floatLine}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.toolRow} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
                      {strip(false, 1)}
                    </ScrollView>
                    {moreBtn}
                    {sumBtn(false)}
                    {gripView}
                  </View>
                </>
              ) : (
                <>
                  {backBtn}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.toolRow} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
                    {strip(false)}
                  </ScrollView>
                  {pageNav(false)}
                  {moreBtn}
                  {sumBtn(false)}
                  {gripView}
                </>
              )}
            </View>
          </GestureDetector>
        </StylusView>
        </Animated.View>
      )}
      {/* 끄는 중 가장자리 가까이: 그쪽에 붙는다는 띠 (가운데면 놓은 자리에 그대로 뜬다) */}
      {ghost && ghost.dock !== "float" && (
        <View pointerEvents="none" style={[sx.dockZone, ghost.dock === "top" ? sx.dockTop : ghost.dock === "left" ? sx.dockLeft : sx.dockRight, { borderColor: t.accent, backgroundColor: t.soft }]}>
          <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{`${DOCKS.find((d) => d.id === ghost.dock)?.label}에 붙이기`}</Text>
        </View>
      )}

      {/* 올가미로 고른 것: 아래에 떠 있는 작은 막대 (색 바꾸기·지우기·끝내기) */}
      {selection && (
        <View style={[floating(t), sx.selBar, narrow && sx.selBarNarrow]}>
          <Text style={[type.caption, { color: t.sub, marginRight: 4 }, narrow && sx.selTextNarrow]}>{selection.ids.size}개 고름 · 끌어서 옮기기</Text>
          <View style={sx.swatches}>
            {PEN_COLORS.slice(0, 5).map((c) => (
              <Swatch key={c} color={c} edge={edge} onPress={() => replaceSelected((s) => ({ ...s, color: c }))} label={`고른 것 색 ${c}`} />
            ))}
          </View>
          <Divider />
          <TextBtn label="작게" onPress={() => resizeSelected(0.8)} label2="고른 것 작게" />
          <TextBtn label="크게" onPress={() => resizeSelected(1.25)} label2="고른 것 크게" />
          <Divider />
          <TextBtn label="지우기" danger onPress={deleteSelected} label2="고른 것 지우기" />
          <IconBtn glyph="✕" onPress={() => setSelection(null)} label="고르기 끝내기" />
        </View>
      )}

      <PlayerBar audio={audio} listening={listening} onListening={setListening} follow={follow} onFollow={setFollow} />
      {tip && <TipBubble key={`${tip.label}@${tip.r.join(",")}`} label={tip.label} r={tip.r} side={tip.side} maxX={win.width} />}
      {!!toast && (
        <View pointerEvents="none" style={sx.toastWrap}>
          <View style={[floating(t), sx.toast, { backgroundColor: t.ink, borderColor: t.ink }]}>
            <Text style={[sx.toastText, { color: t.bg }]}>{toast}</Text>
          </View>
        </View>
      )}
      {!!busy && (
        <View style={[sx.cover, { backgroundColor: backdrop(t) }]}>
          <View style={[floating(t), sx.busyBox]}>
            <ActivityIndicator color={t.sub} />
            <Text style={[type.body, { color: t.ink }]}>{busy}</Text>
          </View>
        </View>
      )}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={[sx.menuBack, { backgroundColor: popBackdrop(t) }]} onPress={() => setMenu(false)}>
          {/* 화면이 낮으면(가로로 든 폰·나눠 쓰기) 메뉴 안에서 밀어서 끝까지 볼 수 있게 */}
          <Pressable style={[floating(t), sx.menu, { marginRight: pad, maxHeight: Math.max(120, win.height - 72) }]} onPress={() => {}}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={sx.menuList}>
              <MenuItem label="바로 요약 (기기에서, 서버 없이)" onPress={quick} />
              <MenuItem label="서버로 자세히 요약 (요약집·AI)" onPress={summarize} />
              <MenuSep />
              <MenuItem label="쪽 모아보기" onPress={() => { setMenu(false); setGrid(true); }} />
              <MenuItem label="PDF로 내보내기 (필기 포함)" onPress={exportPdf} />
              <MenuSep />
              <MenuItem label="좌우로 넘기기 (한 쪽씩)" checked={prefs.flow === "h"} onPress={() => { setMenu(false); setP({ flow: "h" }); }} />
              <MenuItem label="위아래로 넘기기 (이어서)" checked={prefs.flow === "v"} onPress={() => { setMenu(false); setP({ flow: "v" }); }} />
              <MenuItem label="두 쪽씩 보기" checked={prefs.twoPages} onPress={() => { setMenu(false); setP({ twoPages: !prefs.twoPages }); }} />
              <MenuSep />
              <MenuItem label="＋ 뒤에 빈 쪽 (같은 속지)" onPress={() => addPage()} />
              <MenuItem label="＋ 뒤에 줄 쪽" onPress={() => addPage("lined")} />
              <MenuItem label="＋ 뒤에 모눈 쪽" onPress={() => addPage("grid")} />
              <MenuSep />
              <MenuItem label="노트 이름 바꾸기" onPress={() => { setMenu(false); setRenaming(nb.title); }} />
              <MenuItem label="이 쪽 지우기" onPress={deletePage} disabled={nb.pages.length <= 1} danger />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ToolbarDialog open={tbEdit} prefs={prefs} setP={setP} onClose={() => setTbEdit(false)} />
      <Modal visible={insertMenu} transparent animationType="fade" onRequestClose={() => setInsertMenu(false)}>
        <Pressable style={[sx.menuBack, { backgroundColor: popBackdrop(t) }]} onPress={() => setInsertMenu(false)}>
          <Pressable style={[floating(t), sx.menu, sx.insertMenu]} onPress={() => {}}>
            <View style={sx.menuList}>
              <MenuItem label="사진 고르기 (갤러리)" onPress={() => void insertPhoto()} />
              <MenuItem label="붙여넣기 (복사한 사진)" onPress={() => void insertPaste()} />
              <MenuItem label="스티커" onPress={() => { setInsertMenu(false); setStickerSheet(true); }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <StickerSheet open={stickerSheet} onClose={() => setStickerSheet(false)} onStamp={insertStamp} onSticker={insertSticker} />
      <ToolPanel open={panel} at={panelAt} prefs={prefs} setP={setP} onClearPage={clearPage} onClose={() => setPanel(false)} viewScale={viewPx.current ? viewPx.current / page.w : undefined} />
      <RenameDialog value={renaming} onDone={rename} />
      <TextDialog
        open={!!textEdit}
        initial={textEdit?.stroke?.text ?? ""}
        size={textEdit?.stroke?.width ?? prefs.textSize}
        editing={!!textEdit?.stroke}
        onCancel={() => setTextEdit(null)}
        onSave={saveText}
      />
      {grid && (
        <PageGrid
          visible={grid}
          nb={nb}
          ink={ink}
          pdfUri={pdfUri}
          current={pi}
          onPick={(i) => {
            setGrid(false);
            go(i);
          }}
          onClose={() => setGrid(false)}
        />
      )}
    </SafeAreaView>
    </TipCtx.Provider>
  );
}

// ── 창과 작은 부품 ────────────────────────────────────────────────

/** 단추 이름표 말풍선: 제 크기를 재서 단추 가운데 밑(또는 옆)에 놓는다 (재기 전에는 안 보이게). 화면 끝에 닿으면 안쪽으로만 민다.
 *  r = 단추 자리 [x, y, 폭, 높이] (화면 전체 기준) */
function TipBubble({ label, r, side, maxX }: { label: string; r: number[]; side: "below" | "right" | "left"; maxX: number }) {
  const t = useTheme();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const w = size?.w ?? 0, h = size?.h ?? 0;
  const left = side === "right" ? r[0] + r[2] + 6 : side === "left" ? r[0] - w - 6 : Math.max(4, Math.min(maxX - w - 4, r[0] + r[2] / 2 - w / 2));
  const top = side === "below" ? r[1] + r[3] + 6 : r[1] + r[3] / 2 - h / 2;
  return (
    <View
      pointerEvents="none"
      testID="tool-tip"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={[sx.tip, { top, left, opacity: size ? 1 : 0, backgroundColor: t.ink }]}
    >
      <Text style={[type.caption, { color: t.bg }]}>{label}</Text>
    </View>
  );
}

/** 스티커 고르기: 도장(중요·암기 …)과 그림(별·체크 …) */
function StickerSheet({ open, onClose, onStamp, onSticker }: { open: boolean; onClose: () => void; onStamp: (text: string, color: string) => void; onSticker: (s: Sticker) => void }) {
  const t = useTheme();
  // 그림 스티커 미리 보기는 창을 처음 열 때 한 번만 만든다
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open || Object.keys(pics).length) return;
    const out: Record<string, string> = {};
    for (const st of STICKERS) {
      const p = stickerPicture(st, 120);
      if (p) out[st.id] = p.uri;
    }
    setPics(out);
  }, [open, pics]);
  return (
    <Dialog open={open} title="스티커" maxWidth={520} onClose={onClose}>
      <Text style={[type.label, { color: t.sub }]}>도장</Text>
      <View style={sx.stickerWrap}>
        {STAMPS.map((st) => (
          <Pressable
            key={st.text}
            onPress={() => onStamp(st.text, st.color)}
            accessibilityRole="button"
            accessibilityLabel={`도장 스티커: ${st.text}`}
            style={({ pressed }) => [sx.stamp, { borderColor: st.color, backgroundColor: st.color + "1F", opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ color: st.color, fontWeight: "700", fontSize: 15 }}>{st.text}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[type.label, { color: t.sub, marginTop: 8 }]}>그림</Text>
      <View style={sx.stickerWrap}>
        {STICKERS.map((st) => (
          <Pressable
            key={st.id}
            onPress={() => onSticker(st)}
            accessibilityRole="button"
            accessibilityLabel={`그림 스티커: ${st.label}`}
            style={({ pressed }) => [sx.stickerCell, { backgroundColor: t.sunken, opacity: pressed ? 0.6 : 1 }]}
          >
            {pics[st.id] ? <Image source={{ uri: pics[st.id] }} style={{ width: 44, height: 44 }} /> : null}
          </Pressable>
        ))}
      </View>
      <View style={sx.actions}>
        <View style={{ flex: 1 }} />
        <Button label="닫기" onPress={onClose} />
      </View>
    </Dialog>
  );
}

/** 도구 설정 창(ToolPanel) 폭 — 오른쪽에 붙인 도구 모음 왼쪽에 놓을 때 */
const PANEL_W = 368;

/** 도구 모음 편집: 자리(위·왼쪽·오른쪽·떠 있게), 항목 순서(▲▼), 보이기 */
function ToolbarDialog({ open, prefs, setP, onClose }: { open: boolean; prefs: Prefs; setP: (p: Partial<Prefs>) => void; onClose: () => void }) {
  const t = useTheme();
  const win = useWindowDimensions();
  const order = toolbarOrder(prefs.toolbar);
  const hidden = new Set(prefs.toolbarHidden);
  return (
    <Dialog open={open} title="도구 모음 편집" maxWidth={460} onClose={onClose}>
      <Text style={[type.label, { color: t.sub }]}>자리</Text>
      <View style={sx.sizeRow}>
        {DOCKS.map((d) => {
          const on = prefs.toolbarDock === d.id;
          return (
            <Pressable key={d.id} onPress={() => setP({ toolbarDock: d.id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`도구 모음 자리: ${d.label}`} style={[sx.sizeChip, { backgroundColor: on ? t.ink : t.sunken }]}>
              <Text style={{ color: on ? t.bg : t.sub, fontWeight: on ? "600" : "500" }}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {prefs.toolbarDock === "float" && (
        <>
          <Text style={[type.label, { color: t.sub }]}>떠 있는 모양</Text>
          <View style={sx.sizeRow}>
            {([["row", "한 줄"], ["two", "두 줄"], ["column", "세로"]] as const).map(([id, label]) => {
              const on = (prefs.toolbarShape ?? "row") === id;
              return (
                <Pressable key={id} onPress={() => setP({ toolbarShape: id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`떠 있는 모양: ${label}`} style={[sx.sizeChip, { backgroundColor: on ? t.ink : t.sunken }]}>
                  <Text style={{ color: on ? t.bg : t.sub, fontWeight: on ? "600" : "500" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <Text style={[type.caption, { color: t.muted }]}>도구 모음 빈 곳을 꾹 누르거나 앞의 손잡이(⋮⋮)를 끌어 화면 왼쪽·오른쪽·위 끝에 놓으면 그쪽에 붙고, 가운데에 놓으면 떠 있어요.</Text>
      <Text style={[type.label, { color: t.sub, marginTop: 4 }]}>순서와 보이기</Text>
      <ScrollView style={{ maxHeight: Math.max(160, win.height - 380) }}>
        {order.map((id, i) => {
          const label = itemLabel(id);
          const shown = !hidden.has(id);
          return (
            <View key={id} style={[sx.tbRow, { borderColor: t.lineSoft }]}>
              <Text style={[type.body, { color: shown ? t.ink : t.muted, flex: 1 }]}>{label}</Text>
              <Switch
                value={shown}
                onValueChange={(v) => setP({ toolbarHidden: v ? prefs.toolbarHidden.filter((x) => x !== id) : [...prefs.toolbarHidden, id] })}
                accessibilityLabel={`${label} 보이기`}
              />
              <IconBtn icon="up" onPress={() => setP({ toolbar: moveItem(order, id, -1) })} disabled={i === 0} label={`${label} 앞으로`} />
              <IconBtn icon="down" onPress={() => setP({ toolbar: moveItem(order, id, 1) })} disabled={i === order.length - 1} label={`${label} 뒤로`} />
            </View>
          );
        })}
      </ScrollView>
      <View style={sx.actions}>
        <TextBtn label="처음대로" onPress={() => setP({ toolbar: [], toolbarHidden: [], toolbarDock: "top", toolbarMin: false })} label2="도구 모음을 처음 모습으로" />
        <View style={{ flex: 1 }} />
        <Button kind="primary" label="닫기" onPress={onClose} />
      </View>
    </Dialog>
  );
}

/** 화면(창) 기준 [x, y, 폭, 높이] */
function winOf(r: HostInstance | null): Promise<number[] | null> {
  return new Promise((res) => (r ? r.measureInWindow((x, y, w, h) => res([x, y, w, h])) : res(null)));
}

/** 도구 모음 단추 이름표: 단추가 자기 이름과 자리를 알린다 */
const TipCtx = createContext<{ add: (label: string, ref: RefObject<HostInstance | null>) => () => void; press: (label: string, ref: RefObject<HostInstance | null>) => void } | null>(null);
function useTip(label: string, outer?: Ref<HostInstance>) {
  const ctx = useContext(TipCtx);
  const own = useRef<HostInstance | null>(null);
  useEffect(() => (label ? ctx?.add(label, own) : undefined), [ctx, label]);
  const ref = (v: HostInstance | null) => {
    own.current = v;
    if (typeof outer === "function") outer(v);
    else if (outer) (outer as { current: HostInstance | null }).current = v;
  };
  return { ref, onLongPress: ctx ? () => ctx.press(label, own) : undefined };
}

/** 창 뒤를 덮는 반투명 바탕: 가운데 뜨는 창용 / 메뉴처럼 가볍게 뜨는 것용 (쪽이 조금 더 보이게) */
const backdrop = (t: Theme) => (t.dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)");
const popBackdrop = (t: Theme) => (t.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)");

/** 가운데 뜨는 작은 창 (글상자 · 노트 이름) */
function Dialog({ open, title, maxWidth, onClose, children }: { open: boolean; title: string; maxWidth: number; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[sx.dialogBack, { backgroundColor: backdrop(t) }]}>
        <View style={[floating(t), sx.dialog, { maxWidth }]}>
          <Text style={[type.title, { color: t.ink }]}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function TextDialog({ open, initial, size, editing, onCancel, onSave }: { open: boolean; initial: string; size: number; editing: boolean; onCancel: () => void; onSave: (text: string, size: number) => void }) {
  const t = useTheme();
  const [v, setV] = useState("");
  const [sz, setSz] = useState(size);
  useEffect(() => {
    if (open) {
      setV(initial);
      setSz(size);
    }
  }, [open, initial, size]);
  return (
    <Dialog open={open} title={editing ? "글상자 고치기" : "글상자"} maxWidth={520} onClose={onCancel}>
      <TextInput
        value={v}
        onChangeText={setV}
        autoFocus
        multiline
        accessibilityLabel="글상자 내용"
        placeholder="여기에 쓰세요"
        placeholderTextColor={t.muted}
        style={[ui.input, sx.textArea, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
      />
      <View style={sx.sizeRow}>
        <Text style={[type.label, { color: t.sub, marginRight: 4 }]}>글자 크기</Text>
        {TEXT_SIZES.map((s, i) => {
          const on = sz === s;
          return (
            <Pressable key={s} onPress={() => setSz(s)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[sx.sizeChip, { backgroundColor: on ? t.ink : t.sunken }]}>
              <Text style={{ color: on ? t.bg : t.sub, fontSize: 12 + i * 3, fontWeight: on ? "600" : "500" }}>{["작게", "보통", "크게"][i]}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={sx.actions}>
        {editing && <TextBtn label="지우기" danger onPress={() => onSave("", sz)} />}
        <View style={{ flex: 1 }} />
        <Button label="취소" onPress={onCancel} />
        <Button kind="primary" label="넣기" onPress={() => onSave(v, sz)} />
      </View>
    </Dialog>
  );
}

function RenameDialog({ value, onDone }: { value: string | null; onDone: (v: string) => void }) {
  const t = useTheme();
  const [v, setV] = useState("");
  useEffect(() => {
    if (value !== null) setV(value);
  }, [value]);
  return (
    <Dialog open={value !== null} title="노트 이름" maxWidth={420} onClose={() => onDone("")}>
      <TextInput
        value={v}
        onChangeText={setV}
        autoFocus
        accessibilityLabel="노트 이름"
        onSubmitEditing={() => onDone(v)}
        style={[ui.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card, fontSize: 16 }]}
      />
      <View style={sx.actions}>
        <View style={{ flex: 1 }} />
        <Button label="취소" onPress={() => onDone("")} />
        <Button kind="primary" label="저장" onPress={() => onDone(v)} />
      </View>
    </Dialog>
  );
}

/** 되돌리기·다시 하기: 되돌릴 것이 없어도 단추 자리는 보이게 (바탕은 그대로, 글자만 흐리게). 넓은 화면에서는 글도 같이 */
/** 글자 하나짜리 단추 (‹ › ⋯ − ＋ ⚙︎ ✕): 바탕 없이 회색 글자만 */
function IconBtn({ glyph, icon, onPress, disabled, label, big, compact }: { glyph?: string; icon?: IconName; onPress: () => void; disabled?: boolean; label: string; big?: boolean; compact?: boolean }) {
  const t = useTheme();
  const tip = useTip(icon ? label : "");
  return (
    <Pressable
      ref={icon ? tip.ref : undefined}
      onPress={onPress}
      onLongPress={icon ? tip.onLongPress : undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [sx.iconBtn, compact && sx.iconCompact, { backgroundColor: pressed ? t.sunken : "transparent", opacity: disabled ? 0.3 : 1 }]}
    >
      {icon ? (
        <ToolIcon name={icon} color={icon === "back" ? t.ink : t.sub} size={compact ? 20 : 22} />
      ) : (
        <Text style={[big ? sx.glyphBig : compact ? sx.glyphNav : sx.glyph, { color: big ? t.ink : t.sub }]}>{glyph}</Text>
      )}
    </Pressable>
  );
}

/** 낱말 단추 (맞춤, 지우기): 바탕 없이 글자만. danger는 빨간 글자 */
function TextBtn({ label, onPress, label2, danger }: { label: string; onPress: () => void; label2?: string; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label2 ?? label}
      hitSlop={4}
      style={({ pressed }) => [sx.textBtn, { backgroundColor: pressed ? t.sunken : "transparent" }]}
    >
      <Text style={[sx.textBtnText, { color: danger ? t.bad : t.sub }]}>{label}</Text>
    </Pressable>
  );
}

/** 도구 단추: 그림 아이콘. 고른 도구는 검은 바탕. 이름(label)은 화면에 쓰지 않고(한 줄에 들어가게)
 *  접근성 이름표와, S펜을 위에 띄우면(또는 길게 누르면) 뜨는 이름표로 */
function ToolBtn({ label, icon, on, onPress, hint, ref }: { label: string; icon: IconName; on: boolean; onPress: () => void; hint?: string; ref?: Ref<HostInstance> }) {
  const t = useTheme();
  const tip = useTip(label, ref);
  return (
    <Pressable
      ref={tip.ref}
      onPress={onPress}
      onLongPress={tip.onLongPress}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label} (${hint})` : label}
      accessibilityState={{ selected: on }}
      hitSlop={2}
      style={({ pressed }) => [sx.toolBtn, { backgroundColor: on ? t.ink : "transparent", opacity: pressed ? 0.7 : 1 }]}
    >
      <ToolIcon name={icon} color={on ? t.bg : t.sub} />
    </Pressable>
  );
}

/** 동그란 색 단추. 고른 색은 둘레에 검은 고리 (사이를 조금 띄워서) */
function Swatch({ color, on, onPress, label, edge }: { color: string; on?: boolean; onPress: () => void; label: string; edge: string }) {
  const t = useTheme();
  const tip = useTip(colorName(color));
  return (
    <Pressable
      ref={tip.ref}
      onPress={onPress}
      onLongPress={tip.onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      style={[sx.swatchRing, { borderColor: on ? t.ink : "transparent" }]}
    >
      <View style={[sx.swatch, { backgroundColor: color, borderColor: edge }]} />
    </Pressable>
  );
}

/** 굵기 빠른 고르기: 점 크기가 굵기. 고른 것은 색 단추처럼 둘레에 검은 고리 */
function WidthDot({ size, on, onPress, label, tipText }: { size: number; on: boolean; onPress: () => void; label: string; tipText?: string }) {
  const t = useTheme();
  const tip = useTip(tipText ?? label);
  return (
    <Pressable
      ref={tip.ref}
      onPress={onPress}
      onLongPress={tip.onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={[sx.widthBtn, { borderColor: on ? t.ink : "transparent" }]}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: on ? t.ink : t.sub }} />
    </Pressable>
  );
}

/** ⋯ 메뉴 한 줄. 괄호 안 덧말은 옅은 글자로 */
/** ⋯ 메뉴 한 줄. checked가 있으면 고를 수 있는 항목 (켜져 있으면 ✓) */
function MenuItem({ label, onPress, disabled, danger, checked }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; checked?: boolean }) {
  const t = useTheme();
  const cut = label.indexOf(" (");
  const main = cut < 0 ? label : label.slice(0, cut);
  const more = cut < 0 ? "" : label.slice(cut);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={checked === undefined ? "menuitem" : "checkbox"}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={({ pressed }) => [sx.menuItem, checked !== undefined && sx.menuCheck, { opacity: disabled ? 0.35 : 1, backgroundColor: pressed ? t.sunken : "transparent" }]}
    >
      <Text style={[type.body, { color: danger ? t.bad : t.ink }]}>
        {main}
        {!!more && <Text style={{ color: t.muted }}>{more}</Text>}
      </Text>
      {checked !== undefined && <Text style={[type.body, { color: checked ? t.ink : "transparent", fontWeight: "700" }]}>✓</Text>}
    </Pressable>
  );
}

function MenuSep() {
  const t = useTheme();
  return <View style={[sx.menuSep, { backgroundColor: t.lineSoft }]} />;
}

/** 도구 모음의 무리 나누기: 가는 세로줄 */
function Divider({ vertical }: { vertical?: boolean }) {
  const t = useTheme();
  return <View style={[vertical ? sx.dividerH : sx.divider, { backgroundColor: t.line }]} />;
}

const sx = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  tabular: { fontVariant: ["tabular-nums"] },

  // 한 줄 도구 모음
  pageNav: { flexDirection: "row", alignItems: "center", height: 36, borderRadius: radius.pill, paddingHorizontal: 2 },
  pageNo: { minWidth: 48, height: 36, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },

  // 도구 줄
  toolBar: { flexDirection: "row", alignItems: "center", gap: 4, borderBottomWidth: 1, paddingVertical: 6 },
  toolScroll: { flex: 1 },
  toolRow: { alignItems: "center", gap: 2, paddingHorizontal: 2 },
  toolCol: { alignItems: "center", gap: 2, paddingVertical: 4 },
  body: { flex: 1, flexDirection: "row" },
  // 왼쪽·오른쪽에 붙인 도구 모음 (세로)
  sideBar: { flex: 1, width: 56, alignItems: "center", paddingTop: 4 },
  sideFoot: { alignItems: "center", gap: 4, paddingVertical: 6, borderTopWidth: 1, alignSelf: "stretch" },
  pageNavV: { alignItems: "center", borderRadius: radius.lg, paddingVertical: 2 },
  sumV: { paddingHorizontal: 8 },
  floatTwo: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.xl, gap: 2 },
  floatLine: { flexDirection: "row", alignItems: "center" },
  floatCol: { alignItems: "center", paddingHorizontal: 4, paddingVertical: 6, borderRadius: radius.xl, width: 60 },
  sideLeft: { borderRightWidth: 1 },
  sideRight: { borderLeftWidth: 1 },
  // 떠 있는 도구 모음
  floatWrap: { position: "absolute", zIndex: 15 },
  floatBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.xl },
  grip: { width: 22, height: 36, alignItems: "center", justifyContent: "center" },
  // 끄는 동안 도구 모음을 다른 것들 위로 띄운다
  lifted: { zIndex: 40, elevation: 12, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, opacity: 0.94 },
  dockZone: { position: "absolute", zIndex: 30, borderWidth: 2, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center", opacity: 0.9 },
  dockTop: { top: 4, left: 8, right: 8, height: 56 },
  dockLeft: { top: 8, bottom: 8, left: 4, width: 72 },
  dockRight: { top: 8, bottom: 8, right: 4, width: 72 },
  // 녹음 중 단추: 빨간 점 + 시간
  recLive: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: "#FDE8EA" },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#E5484D" },
  recTime: { color: "#C62A35", fontWeight: "700", fontVariant: ["tabular-nums"] },
  insertMenu: { alignSelf: "center" },
  stickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stamp: { borderWidth: 2, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8 },
  stickerCell: { width: 64, height: 64, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  tbRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  swatchesCol: { flexDirection: "column", alignItems: "center", gap: 2 },
  toolBtn: { width: 38, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  swatches: { flexDirection: "row", alignItems: "center", gap: 2 },
  swatchRing: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  widthBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  divider: { width: 1, height: 20, marginHorizontal: 8 },
  dividerH: { height: 1, width: 24, marginVertical: 6 },
  iconBtn: { minWidth: 36, height: 36, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconCompact: { minWidth: 30, paddingHorizontal: 4 },
  glyphNav: { fontSize: 23, lineHeight: 26, marginTop: -2 },
  glyph: { fontSize: 20, lineHeight: 24 },
  glyphBig: { fontSize: 30, lineHeight: 32, marginTop: -3 },
  textBtn: { height: 36, paddingHorizontal: 10, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  textBtnText: { fontSize: 14, fontWeight: "500", letterSpacing: -0.2 },

  // 떠 있는 것들
  selBar: { position: "absolute", bottom: 24, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingLeft: 18, paddingRight: 6, paddingVertical: 6 },
  // 좁은 폰: 설명 글을 윗줄에 두고 단추는 아랫줄에 (한 줄에 다 들어가지 않아서)
  selBarNarrow: { left: 16, right: 16, alignSelf: "auto", flexWrap: "wrap", justifyContent: "center", rowGap: 2, borderRadius: radius.xl, paddingLeft: 12, paddingTop: 10 },
  selTextNarrow: { width: "100%", textAlign: "center", marginRight: 0 },
  // 단추 이름표: 단추 가운데 밑에 작은 검은 말풍선 (TipBubble이 제 폭을 재서 자리를 잡는다)
  tip: { position: "absolute", zIndex: 20, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
  toastWrap: { position: "absolute", bottom: 32, left: 16, right: 16, alignItems: "center" },
  toast: { maxWidth: 560, borderRadius: radius.xl, paddingHorizontal: 18, paddingVertical: 10 },
  toastText: { fontSize: 14, lineHeight: 20, fontWeight: "500", textAlign: "center", letterSpacing: -0.2 },
  cover: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  busyBox: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 20, paddingHorizontal: 24, borderRadius: radius.lg },

  // ⋯ 메뉴
  menuBack: { flex: 1, alignItems: "flex-end" },
  menu: { marginTop: 56, minWidth: 280, maxWidth: 360, borderRadius: radius.lg },
  menuList: { paddingVertical: 8 },
  menuItem: { marginHorizontal: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: radius.md },
  menuCheck: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  menuSep: { height: 1, marginVertical: 6, marginHorizontal: 20 },

  // 가운데 뜨는 창
  dialogBack: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  dialog: { width: "100%", borderRadius: radius.xl, padding: 24, gap: 16 },
  textArea: { minHeight: 120, fontSize: 16, textAlignVertical: "top" },
  sizeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  sizeChip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
});
