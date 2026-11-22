// 필기 화면: 도구 모음 + 쪽 그리기 + 자동 저장
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ActivityIndicator, Alert, AppState, BackHandler, Modal, PixelRatio, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type HostInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { pageText } from "../../modules/pdf-pages";
import { useTheme } from "../ui";
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
      say("펜이 감지되어 손가락은 화면 옮기기로 바꿨어요. 도구 모음의 ✋ 단추로 바꿀 수 있어요.");
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
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 20 }}>
        <Text style={{ color: t.bad }}>{loadErr}</Text>
        <Btn label="← 노트 목록" onPress={onClose} />
      </SafeAreaView>
    );
  }
  if (!nb || !prefs || !page) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.accent} />
      </SafeAreaView>
    );
  }

  const tool = prefs.tool;
  const colors = tool === "highlighter" ? HIGHLIGHT_COLORS : PEN_COLORS;
  const widths = tool === "highlighter" ? HIGHLIGHT_WIDTHS : PEN_WIDTHS;
  const color = tool === "highlighter" ? prefs.hlColor : prefs.penColor;
  const width = tool === "highlighter" ? prefs.hlWidth : prefs.penWidth;
  const edge = swatchEdge(t.card); // 색 단추 테두리 (어두운 모드에서도 검정 단추가 보이게)
  const narrow = win.width < 480; // 세로로 든 폰: 윗줄이 좁아 노트 이름 자리가 없다 → 되돌리기 단추를 도구 줄로 내린다
  const undoRedo = (
    <View style={{ flexDirection: "row", gap: 4, marginRight: narrow ? 4 : 6 }}>
      <HistBtn glyph="↶" text="되돌리기" onPress={undo} disabled={!hist.current.canUndo} label="되돌리기" wide={!narrow} />
      <HistBtn glyph="↷" text="다시" onPress={redo} disabled={!hist.current.canRedo} label="다시 하기" wide={!narrow} />
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.card }} edges={["top", "left", "right"]}>
      {/* 윗줄: 노트 이름, 되돌리기, 쪽 넘기기, 요약 (항상 보임) */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 4, gap: 2, backgroundColor: t.card }}>
        <Btn label="‹ 노트" onPress={close} label2="노트 목록으로" />
        <Pressable onPress={() => setRenaming(nb.title)} accessibilityRole="button" accessibilityLabel="노트 이름 바꾸기" style={{ flex: 1, paddingHorizontal: 6 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>{nb.title}</Text>
        </Pressable>
        {!narrow && undoRedo}
        <Btn label="◀" onPress={() => go(pi - 1)} disabled={pi === 0} label2="이전 쪽" />
        <Pressable onPress={() => setGrid(true)} accessibilityRole="button" accessibilityLabel="쪽 모아보기" style={{ paddingHorizontal: 6, paddingVertical: 6, borderRadius: 8, backgroundColor: t.soft }}>
          <Text style={{ color: t.ink, minWidth: 52, textAlign: "center" }}>{pi + 1} / {nb.pages.length}</Text>
        </Pressable>
        <Btn label="▶" onPress={() => go(pi + 1)} disabled={pi >= nb.pages.length - 1} label2="다음 쪽" />
        <Btn label="⋯" onPress={() => setMenu(true)} label2="더 보기" />
        <Pressable onPress={quick} accessibilityRole="button" accessibilityLabel="요약 만들기" style={{ backgroundColor: t.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, marginLeft: 4 }}>
          <Text style={{ color: t.accentInk, fontWeight: "700" }}>요약</Text>
        </Pressable>
      </View>
      {/* 아랫줄: 도구 (좁으면 옆으로 밀어서) */}
      <View ref={barRef} collapsable={false} style={{ borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 8, paddingVertical: 5, gap: 4 }} keyboardShouldPersistTaps="handled">
          {narrow && undoRedo}
          <ToolBtn ref={toolRef("pen")} label={`✒️ ${PENS.find((x) => x.id === prefs.penBrush)?.label ?? "펜"}`} on={tool === "pen"} onPress={() => pick("pen")} hint="한 번 더 누르면 펜 설정" />
          <ToolBtn ref={toolRef("highlighter")} label="🖍 형광펜" on={tool === "highlighter"} onPress={() => pick("highlighter")} hint="한 번 더 누르면 형광펜 설정" />
          <ToolBtn ref={toolRef("eraser")} label={prefs.eraserMode === "area" ? "⌫ 영역 지우개" : "⌫ 지우개"} on={tool === "eraser"} onPress={() => pick("eraser")} hint="한 번 더 누르면 지우개 설정" />
          <ToolBtn ref={toolRef("lasso")} label={prefs.lassoMode === "rect" ? "⬚ 올가미" : "➰ 올가미"} on={tool === "lasso"} onPress={() => pick("lasso")} hint="둘러싸서 고르고 옮기기, 한 번 더 누르면 설정" />
          <ToolBtn label="T 글상자" on={tool === "text"} onPress={() => setP({ tool: "text" })} hint="쪽을 누르면 글을 써 넣어요" />
          {tool === "text" && (
            <>
              <Sep />
              {PEN_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setP({ penColor: c })}
                  accessibilityRole="button"
                  accessibilityLabel={`글 색 ${c}`}
                  accessibilityState={{ selected: c === prefs.penColor }}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: c === prefs.penColor ? 2 : 0, borderColor: t.accent }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: edge }} />
                </Pressable>
              ))}
              <Text style={{ color: t.muted, marginLeft: 6 }}>쪽을 누르면 글상자, 글상자를 누르면 고치기</Text>
            </>
          )}
          {tool !== "text" && <Btn label="⚙︎" onPress={openPanel} label2="도구 설정" />}
          {tool !== "eraser" && tool !== "lasso" && tool !== "text" && (
            <>
              <Sep />
              {colors.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setP(tool === "highlighter" ? { hlColor: c } : { penColor: c })}
                  accessibilityRole="button"
                  accessibilityLabel={`색 ${c}`}
                  accessibilityState={{ selected: c === color }}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: c === color ? 2 : 0, borderColor: t.accent }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: edge }} />
                </Pressable>
              ))}
              <Sep />
              {widths.map((w, i) => (
                <Pressable
                  key={w}
                  onPress={() => setP(tool === "highlighter" ? { hlWidth: w } : { penWidth: w })}
                  accessibilityRole="button"
                  accessibilityLabel={`굵기 ${i + 1}`}
                  accessibilityState={{ selected: w === width }}
                  style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: w === width ? t.soft : "transparent" }}
                >
                  <View style={{ width: 6 + i * 6, height: 6 + i * 6, borderRadius: 10, backgroundColor: t.ink }} />
                </Pressable>
              ))}
              {tool === "highlighter" && (
                <ToolBtn label="― 직선" on={prefs.straight} onPress={() => setP({ straight: !prefs.straight })} hint="가로로 그으면 곧은 선으로" />
              )}
              {tool === "pen" && (
                <ToolBtn label="△ 도형 펴기" on={prefs.shapes} onPress={() => setP({ shapes: !prefs.shapes })} hint="선·사각형·원·삼각형을 반듯하게" />
              )}
            </>
          )}
          <Sep />
          <ToolBtn
            label={prefs.fingerDraw ? "☝️ 손가락: 쓰기" : "✋ 손가락: 이동"}
            on={false}
            onPress={() => setP({ fingerDraw: !prefs.fingerDraw })}
            hint="손가락으로 쓸지, 화면만 옮길지"
          />
          <Sep />
          <Btn label="−" onPress={() => setZoom((z) => ({ kind: "out", n: z.n + 1 }))} label2="축소" />
          <Btn label="맞춤" onPress={() => setZoom((z) => ({ kind: "fit", n: z.n + 1 }))} label2="쪽 폭에 맞추기" />
          <Btn label="+" onPress={() => setZoom((z) => ({ kind: "in", n: z.n + 1 }))} label2="확대" />
        </ScrollView>
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

      {selection && (
        <View style={{ position: "absolute", bottom: 24, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.card, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: t.line, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 }}>
          <Text style={{ color: t.muted, marginRight: 4 }}>{selection.ids.size}개 고름 · 끌어서 옮기기</Text>
          {PEN_COLORS.slice(0, 5).map((c) => (
            <Pressable key={c} onPress={() => replaceSelected((s) => ({ ...s, color: c }))} accessibilityRole="button" accessibilityLabel={`고른 것 색 ${c}`} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: 1, borderColor: edge }} />
          ))}
          <Btn label="🗑" onPress={deleteSelected} label2="고른 것 지우기" />
          <Btn label="✕" onPress={() => setSelection(null)} label2="고르기 끝내기" />
        </View>
      )}

      {!!toast && (
        <View pointerEvents="none" style={{ position: "absolute", bottom: 28, left: 16, right: 16, alignItems: "center" }}>
          <Text style={{ backgroundColor: "rgba(20,20,24,0.88)", color: "#fff", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, overflow: "hidden" }}>{toast}</Text>
        </View>
      )}
      {!!busy && (
        <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: t.card, padding: 20, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ActivityIndicator color={t.accent} />
            <Text style={{ color: t.ink }}>{busy}</Text>
          </View>
        </View>
      )}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "flex-end" }} onPress={() => setMenu(false)}>
          {/* 화면이 낮으면(가로로 든 폰·나눠 쓰기) 메뉴 안에서 밀어서 끝까지 볼 수 있게 */}
          <Pressable style={{ marginTop: 60, marginRight: 12, maxHeight: Math.max(120, win.height - 72), backgroundColor: t.card, borderRadius: 12, paddingVertical: 6, minWidth: 240, borderWidth: 1, borderColor: t.line }} onPress={() => {}}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <MenuItem label="⚡ 바로 요약 (기기에서, 서버 없이)" onPress={quick} />
              <MenuItem label="✨ 서버로 자세히 요약 (요약집·AI)" onPress={summarize} />
              <MenuItem label="▦ 쪽 모아보기" onPress={() => { setMenu(false); setGrid(true); }} />
              <MenuItem label="📄 PDF로 내보내기 (필기 포함)" onPress={exportPdf} />
              <MenuItem label="＋ 뒤에 빈 쪽 (같은 속지)" onPress={() => addPage()} />
              <MenuItem label="＋ 뒤에 줄 쪽" onPress={() => addPage("lined")} />
              <MenuItem label="＋ 뒤에 모눈 쪽" onPress={() => addPage("grid")} />
              <MenuItem label="✎ 노트 이름 바꾸기" onPress={() => { setMenu(false); setRenaming(nb.title); }} />
              <MenuItem label="🗑 이 쪽 지우기" onPress={deletePage} disabled={nb.pages.length <= 1} danger />
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
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 12, padding: 18, width: "100%", maxWidth: 520 }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 17, marginBottom: 10 }}>{editing ? "글상자 고치기" : "글상자"}</Text>
          <TextInput
            value={v}
            onChangeText={setV}
            autoFocus
            multiline
            accessibilityLabel="글상자 내용"
            placeholder="여기에 쓰세요"
            placeholderTextColor={t.muted}
            style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 10, color: t.ink, fontSize: 16, minHeight: 110, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
            <Text style={{ color: t.muted }}>글자 크기</Text>
            {TEXT_SIZES.map((s, i) => (
              <Pressable key={s} onPress={() => setSz(s)} accessibilityRole="radio" accessibilityState={{ selected: sz === s }} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: sz === s ? t.accent : t.line, backgroundColor: sz === s ? t.soft : t.card }}>
                <Text style={{ color: sz === s ? t.accent : t.ink, fontSize: 12 + i * 3 }}>{["작게", "보통", "크게"][i]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            {editing && <Btn label="🗑 지우기" onPress={() => onSave("", sz)} />}
            <Btn label="취소" onPress={onCancel} />
            <Btn label="넣기" onPress={() => onSave(v, sz)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RenameDialog({ value, onDone }: { value: string | null; onDone: (v: string) => void }) {
  const t = useTheme();
  const [v, setV] = useState("");
  useEffect(() => {
    if (value !== null) setV(value);
  }, [value]);
  return (
    <Modal visible={value !== null} transparent animationType="fade" onRequestClose={() => onDone("")}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 12, padding: 18, width: "100%", maxWidth: 420 }}>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: 17, marginBottom: 10 }}>노트 이름</Text>
          <TextInput
            value={v}
            onChangeText={setV}
            autoFocus
            accessibilityLabel="노트 이름"
            onSubmitEditing={() => onDone(v)}
            style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 10, color: t.ink, fontSize: 16 }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <Btn label="취소" onPress={() => onDone("")} />
            <Btn label="저장" onPress={() => onDone(v)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 되돌리기·다시 하기: 되돌릴 것이 없어도 단추 자리는 보이게 (바탕은 그대로, 글자만 흐리게). 넓은 화면에서는 글도 같이 */
function HistBtn({ glyph, text, onPress, disabled, label, wide }: { glyph: string; text: string; onPress: () => void; disabled: boolean; label: string; wide: boolean }) {
  const t = useTheme();
  const dim = disabled ? 0.35 : 1;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: wide ? 12 : 10, borderRadius: 10, backgroundColor: t.soft, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: t.ink, fontSize: 20, lineHeight: 24, opacity: dim }}>{glyph}</Text>
      {wide && <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", opacity: dim }}>{text}</Text>}
    </Pressable>
  );
}

function Btn({ label, onPress, disabled, label2 }: { label: string; onPress: () => void; disabled?: boolean; label2?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label2 ?? label}
      hitSlop={4}
      style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: t.ink, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function ToolBtn({ label, on, onPress, hint, ref }: { label: string; on: boolean; onPress: () => void; hint?: string; ref?: Ref<HostInstance> }) {
  const t = useTheme();
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label} (${hint})` : label}
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: on ? t.soft : "transparent", borderWidth: 1, borderColor: on ? t.accent : "transparent" }}
    >
      <Text style={{ color: on ? t.accent : t.ink, fontWeight: on ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

function MenuItem({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="menuitem" style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, opacity: disabled ? 0.4 : 1, backgroundColor: pressed ? t.soft : "transparent" })}>
      <Text style={{ color: danger ? t.bad : t.ink, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Sep() {
  const t = useTheme();
  return <View style={{ width: 1, height: 22, backgroundColor: t.line, marginHorizontal: 4 }} />;
}
