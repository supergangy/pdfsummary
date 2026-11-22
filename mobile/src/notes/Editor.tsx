// 필기 화면: 도구 모음 + 쪽 그리기 + 자동 저장
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Alert, AppState, BackHandler, Modal, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type HostInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { pageText } from "../../modules/pdf-pages";
import { Button, floating, radius, styles as ui, type, useTheme, type Theme } from "../ui";
import { clampPage, isHighlighterTap, justAfter, otherPage, pageBg, penSwap, swatchEdge, type BgCache, type SwapSaved } from "./editor-logic";
import { bounds, eraseFrom, fitHighlight, hitAlong, straighten, thin, type CharBox } from "./geometry";
import { History, removal, type Op } from "./history";
import {
  HIGHLIGHT_COLORS, HIGHLIGHT_OPACITY, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTHS, PENS, TEXT_SIZES, insertPage, makeTextBox, newId, removePage,
  type Ink, type Notebook, type Paper, type Stroke,
} from "./model";
import { pageImage } from "./pageImage";
import { PageCanvas, type Selection, type ToolName, type ZoomCmd } from "./PageCanvas";
import { PageGrid } from "./PageGrid";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { lassoSelect, moved, snapShape } from "./shapes";
import { ToolIcon, type IconName } from "./ToolIcon";
import { ToolPanel } from "./ToolPanel";
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
  const toolRefs = useRef<Partial<Record<ToolName, HostInstance | null>>>({}); // 도구 단추들
  const [grid, setGrid] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; stroke?: Stroke } | null>(null);
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
    await flush();
    onClose();
  };

  // ── 쪽 바탕 그림 (PDF) ──────────────────────────────────
  const page = nb?.pages[Math.min(pi, (nb?.pages.length ?? 1) - 1)];
  const wantPx = useRef(0);
  const loadBg = useCallback((index: number, px: number) => {
    const n = nbRef.current;
    const pg = n?.pages[index];
    if (!n || !pdfUri || !pg || pg.pdf === undefined) return;
    // 쪽 번호가 아니라 쪽 id로 기억한다 (쪽을 끼우거나 지워도 그림이 다른 쪽으로 밀리지 않게)
    const key = pg.id;
    const have = bg[key]?.w ?? 0;
    if (have >= px * 0.9) return;
    pageImage(n.id, pdfUri, pg.pdf, px)
      .then((uri) => setBg((b) => ((b[key]?.w ?? 0) >= px ? b : { ...b, [key]: { uri, w: px } })))
      .catch(() => setToast("이 쪽의 PDF를 그리지 못했어요."));
  }, [pdfUri, bg]);

  useEffect(() => {
    if (!page) return;
    const px = Math.min(4096, Math.max(1024, wantPx.current || 1400));
    loadBg(pi, px);
    // 다음 쪽도 미리
    if (nb && pi + 1 < nb.pages.length) loadBg(pi + 1, px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi, page?.id, pdfUri]);

  const viewPx = useRef(0); // 쪽이 화면에서 차지하는 폭 (펜 견본을 같은 배율로 보여 주려고)
  const onViewWidth = useCallback((pagePx: number) => {
    viewPx.current = pagePx;
    const px = Math.min(4096, Math.ceil(pagePx * PixelRatio.get() / 256) * 256);
    wantPx.current = px;
    loadBg(pi, px);
  }, [loadBg, pi]);

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
    setTimeout(() => setToast((x) => (x === s ? "" : x)), 2600);
  };

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

  const onStroke = useCallback((pts: number[], stylus: boolean) => {
    const n = nbRef.current;
    const p = prefs;
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
    if (hl && p.straight) clean = straighten(clean);
    if (hl && p.hlFit && chars.current.page === page.id && chars.current.chars) {
      // 글자 크기에 맞춰: 칠한 글줄의 높이·글자 끝에 맞춘다
      const f = fitHighlight(clean, w, chars.current.chars);
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
    };
    setInk((k) => hist.current.run(k, { kind: "add", page: page.id, strokes: [s] }));
    touch(page.id);
    bump((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, page, touch]);

  // 지우개
  //  - 획 지우개: 문지르는 동안 닿은 획을 감췄다가, 손을 떼면 한 번의 작업으로 지운다
  //  - 영역 지우개: 문지른 자리만 지우고 획을 조각낸다 (바로 보이게), 손을 떼면 한 번의 작업으로 기록
  const erased = useRef(new Set<string>());
  const lastErase = useRef<[number, number] | null>(null);
  const area = useRef<{ start: Ink; at: Map<string, number>; orig: Map<string, Stroke>; root: Map<string, string> } | null>(null);
  const onErase = useCallback((phase: 0 | 1 | 2, x: number, y: number, r: number) => {
    if (!page || !prefs) return;
    const canErase = (s: Stroke) => !prefs.eraserHlOnly || s.tool === "highlighter";
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
  }, [page, prefs, touch]);

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
  const onLasso = useCallback((pts: number[]) => {
    if (!page) return;
    const cur = inkRef.current[page.id] ?? [];
    const ids = lassoSelect(cur, pts, prefs?.lassoPartial ?? false);
    if (!ids.size) return setSelection(null);
    setSelection({ ids, box: selBox(cur.filter((s) => ids.has(s.id))) });
  }, [page, prefs?.lassoPartial]);
  const replaceSelected = (fn: (s: Stroke) => Stroke) => {
    if (!page || !selection) return;
    const before = (inkRef.current[page.id] ?? []).filter((s) => selection.ids.has(s.id));
    if (!before.length) return;
    const after = before.map(fn);
    setInk((k) => hist.current.run(k, { kind: "replace", page: page.id, before, after }));
    setSelection({ ids: selection.ids, box: selBox(after) });
    touch(page.id);
    bump((x) => x + 1);
  };
  const onMoveSelection = useCallback((dx: number, dy: number) => {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    replaceSelected((s) => moved(s, dx, dy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, selection]);
  const deleteSelected = () => {
    if (!page || !selection) return;
    const op = removal(inkRef.current, page.id, selection.ids);
    if (op) {
      setInk((k) => hist.current.run(k, op));
      touch(page.id);
      bump((x) => x + 1);
    }
    setSelection(null);
  };
  useEffect(() => {
    if (prefs?.tool !== "lasso") setSelection(null);
  }, [prefs?.tool, pi]);
  // 다른 쪽으로 넘어가면 올가미를 든 채여도 고른 것을 푼다 (빈 선택 상자가 다른 쪽에 남지 않게)
  useEffect(() => setSelection(null), [page?.id]);

  // ── 글상자 ──────────────────────────────────────────────
  const onTextTap = useCallback((x: number, y: number) => {
    if (!page || justAfter(Date.now(), menuClosedAt.current)) return; // 메뉴를 두 번 누른 둘째 누름은 넘긴다
    const hit = [...(inkRef.current[page.id] ?? [])].reverse().find((s) => s.tool === "text" && hitAlong([s], x, y, x, y, 2).length);
    setTextEdit(hit ? { x: hit.pts[0], y: hit.pts[1], stroke: hit } : { x, y });
  }, [page]);
  const saveText = (text: string, size: number) => {
    const ed = textEdit;
    setTextEdit(null);
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
      const s = makeTextBox(newId(), ed.x, ed.y, text, size, color, page.w);
      setInk((k) => hist.current.run(k, { kind: "add", page: page.id, strokes: [s] }));
    }
    touch(page.id);
    bump((v) => v + 1);
  };

  // 되돌리기 기록은 노트 전체에 하나다. 바뀐 필기가 다른 쪽에 있으면 그 쪽으로 넘겨서 보여 준다 (안 보이는 쪽이 말없이 바뀌지 않게)
  const showChanged = (pageId: string | undefined, what: string) => {
    const i = otherPage(nbRef.current?.pages ?? [], page?.id, pageId);
    if (i < 0) return;
    setPi(i);
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
    setPi(Math.max(0, Math.min(nb.pages.length - 1, i)));
  };
  const addPage = (paper?: Paper) => {
    if (!nb) return;
    const next = insertPage(nb, pi, paper);
    setNb(next);
    nbRef.current = next;
    touch();
    setPi(pi + 1);
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
      setPi(Math.min(pi, next.pages.length - 1));
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
  const strokes = useMemo(() => (page ? ink[page.id] ?? [] : []), [ink, page]);

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
  const undoRedo = (
    <View style={sx.row}>
      <IconBtn icon="undo" onPress={undo} disabled={!hist.current.canUndo} label="되돌리기" />
      <IconBtn icon="redo" onPress={redo} disabled={!hist.current.canRedo} label="다시 하기" />
    </View>
  );
  /** 도구 설정 창 열기 — 도구 모음 바로 밑, 지금 도구 단추의 왼쪽 끝에 맞춰서 */
  const openPanel = () => {
    const bar = barRef.current;
    const btn = toolRefs.current[tool];
    if (!bar) return setPanel(true);
    bar.measureInWindow((_x, y, _w, h) => {
      const show = (left: number) => {
        setPanelAt({ top: y + h + 4, left });
        setPanel(true);
      };
      if (btn) btn.measureInWindow((x) => show(x));
      else show(12);
    });
  };
  const toolRef = (name: ToolName) => (v: HostInstance | null) => {
    toolRefs.current[name] = v;
  };
  /** 도구 고르기 — 이미 고른 도구를 한 번 더 누르면 설정 창 */
  const pick = (next: ToolName) => (tool === next ? openPanel() : setP({ tool: next }));
  const penName = PENS.find((x) => x.id === prefs.penBrush)?.label ?? "펜";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      {/* 한 줄 도구 모음: 돌아가기 · 도구(그림) · 설정 · 색 · 굵기 · 보정 · 손가락 · 확대 · 되돌리기 · 쪽 · 더 보기 · 요약.
          노트 이름은 자리를 차지하지 않게 ⋯ 메뉴의 '이름 바꾸기'로. 좁으면 가운데 부분만 옆으로 민다 */}
      <View ref={barRef} collapsable={false} style={[sx.toolBar, { borderColor: t.lineSoft, backgroundColor: t.bg, paddingHorizontal: pad }]}>
        <IconBtn icon="back" onPress={close} label="노트 목록으로" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.toolRow} keyboardShouldPersistTaps="handled" style={sx.toolScroll}>
          <ToolBtn ref={toolRef("pen")} icon="pen" label={penName} on={tool === "pen"} onPress={() => pick("pen")} hint="한 번 더 누르면 펜 설정" />
          <ToolBtn ref={toolRef("highlighter")} icon="highlighter" label="형광펜" on={tool === "highlighter"} onPress={() => pick("highlighter")} hint="한 번 더 누르면 형광펜 설정" />
          <ToolBtn ref={toolRef("eraser")} icon="eraser" label={prefs.eraserMode === "area" ? "영역 지우개" : "지우개"} on={tool === "eraser"} onPress={() => pick("eraser")} hint="한 번 더 누르면 지우개 설정" />
          <ToolBtn ref={toolRef("lasso")} icon="lasso" label="올가미" on={tool === "lasso"} onPress={() => pick("lasso")} hint="둘러싸서 고르고 옮기기, 한 번 더 누르면 설정" />
          <ToolBtn icon="text" label="글상자" on={tool === "text"} onPress={() => setP({ tool: "text" })} hint="쪽을 누르면 글을 써 넣어요" />
          {tool !== "text" && <IconBtn icon="settings" onPress={openPanel} label="도구 설정" />}
          {tool === "text" && (
            <>
              <Divider />
              <View style={sx.swatches}>
                {PEN_COLORS.map((c) => (
                  <Swatch key={c} color={c} edge={edge} on={c === prefs.penColor} onPress={() => setP({ penColor: c })} label={`글 색 ${c}`} />
                ))}
              </View>
            </>
          )}
          {tool !== "eraser" && tool !== "lasso" && tool !== "text" && (
            <>
              <Divider />
              <View style={sx.swatches}>
                {colors.map((c) => (
                  <Swatch key={c} color={c} edge={edge} on={c === color} onPress={() => setP(tool === "highlighter" ? { hlColor: c } : { penColor: c })} label={`색 ${c}`} />
                ))}
              </View>
              <Divider />
              {widths.map((w, i) => (
                <WidthDot key={w} size={6 + i * 6} on={w === width} onPress={() => setP(tool === "highlighter" ? { hlWidth: w } : { penWidth: w })} label={`굵기 ${i + 1}`} />
              ))}
              {tool === "highlighter" && (
                <ToolBtn icon="line" label="직선" on={prefs.straight} onPress={() => setP({ straight: !prefs.straight })} hint="가로로 그으면 곧은 선으로" />
              )}
              {tool === "pen" && (
                <ToolBtn icon="shapes" label="도형 펴기" on={prefs.shapes} onPress={() => setP({ shapes: !prefs.shapes })} hint="선·사각형·원·삼각형을 반듯하게" />
              )}
            </>
          )}
          <Divider />
          <ToolBtn
            icon={prefs.fingerDraw ? "finger" : "hand"}
            label={prefs.fingerDraw ? "손가락: 쓰기" : "손가락: 이동"}
            on={false}
            onPress={() => setP({ fingerDraw: !prefs.fingerDraw })}
            hint="손가락으로 쓸지, 화면만 옮길지"
          />
          <Divider />
          <IconBtn icon="minus" onPress={() => setZoom((z) => ({ kind: "out", n: z.n + 1 }))} label="축소" />
          <IconBtn icon="fit" onPress={() => setZoom((z) => ({ kind: "fit", n: z.n + 1 }))} label="맞춤 (쪽 폭에 맞추기)" />
          <IconBtn icon="plus" onPress={() => setZoom((z) => ({ kind: "in", n: z.n + 1 }))} label="확대" />
          <Divider />
          {undoRedo}
        </ScrollView>
        {/* 쪽 넘기기는 ‹ 1 / 4 › 한 덩어리로. 가운데 쪽 번호를 누르면 쪽 모아보기 */}
        <View style={[sx.pageNav, { backgroundColor: t.sunken }]}>
          <IconBtn compact icon="prev" onPress={() => go(pi - 1)} disabled={pi === 0} label="이전 쪽" />
          <Pressable onPress={() => setGrid(true)} accessibilityRole="button" accessibilityLabel="쪽 모아보기" style={sx.pageNo}>
            <Text style={[type.label, sx.tabular, { color: t.ink }]}>{pi + 1} / {nb.pages.length}</Text>
          </Pressable>
          <IconBtn compact icon="next" onPress={() => go(pi + 1)} disabled={pi >= nb.pages.length - 1} label="다음 쪽" />
        </View>
        <IconBtn icon="more" onPress={() => setMenu(true)} label="더 보기" />
        <Button kind="primary" small label="요약" accessibilityLabel="요약 만들기" onPress={quick} />
      </View>

      <PageCanvas
        page={page}
        background={pageBg(bg, page)}
        strokes={strokes}
        hidden={hidden}
        tool={tool}
        color={color}
        width={width}
        opacity={prefs.hlOpacity}
        dash={prefs.penDash}
        eraserPx={prefs.eraserSize}
        lassoRect={prefs.lassoMode === "rect"}
        fingerDraw={prefs.fingerDraw}
        zoom={zoom}
        onStroke={onStroke}
        onErase={onErase}
        onViewWidth={onViewWidth}
        selection={selection}
        onLasso={onLasso}
        onMoveSelection={onMoveSelection}
        onTextTap={onTextTap}
        onPenDouble={onPenDouble}
      />

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
          <TextBtn label="지우기" danger onPress={deleteSelected} label2="고른 것 지우기" />
          <IconBtn glyph="✕" onPress={() => setSelection(null)} label="고르기 끝내기" />
        </View>
      )}

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
  );
}

// ── 창과 작은 부품 ────────────────────────────────────────────────

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
  return (
    <Pressable
      onPress={onPress}
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

/** 도구 단추: 고른 것은 검은 알약. chip은 켜고 끄는 단추라 꺼져 있어도 옅은 회색 바탕 */
/** 도구 단추: 그림 아이콘. 고른 도구는 검은 바탕. 이름(label)은 접근성 이름표로만 (화면 글이 없어 한 줄에 들어간다) */
function ToolBtn({ label, icon, on, onPress, hint, ref }: { label: string; icon: IconName; on: boolean; onPress: () => void; hint?: string; ref?: Ref<HostInstance> }) {
  const t = useTheme();
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
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
  return (
    <Pressable
      onPress={onPress}
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
function WidthDot({ size, on, onPress, label }: { size: number; on: boolean; onPress: () => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
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
function MenuItem({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const t = useTheme();
  const cut = label.indexOf(" (");
  const main = cut < 0 ? label : label.slice(0, cut);
  const more = cut < 0 ? "" : label.slice(cut);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="menuitem"
      style={({ pressed }) => [sx.menuItem, { opacity: disabled ? 0.35 : 1, backgroundColor: pressed ? t.sunken : "transparent" }]}
    >
      <Text style={[type.body, { color: danger ? t.bad : t.ink }]}>
        {main}
        {!!more && <Text style={{ color: t.muted }}>{more}</Text>}
      </Text>
    </Pressable>
  );
}

function MenuSep() {
  const t = useTheme();
  return <View style={[sx.menuSep, { backgroundColor: t.lineSoft }]} />;
}

/** 도구 모음의 무리 나누기: 가는 세로줄 */
function Divider() {
  const t = useTheme();
  return <View style={[sx.divider, { backgroundColor: t.line }]} />;
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
  toolBtn: { width: 38, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  swatches: { flexDirection: "row", alignItems: "center", gap: 2 },
  swatchRing: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  widthBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  divider: { width: 1, height: 20, marginHorizontal: 8 },
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
  menuSep: { height: 1, marginVertical: 6, marginHorizontal: 20 },

  // 가운데 뜨는 창
  dialogBack: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  dialog: { width: "100%", borderRadius: radius.xl, padding: 24, gap: 16 },
  textArea: { minHeight: 120, fontSize: 16, textAlignVertical: "top" },
  sizeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  sizeChip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
});
