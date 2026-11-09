// 필기 화면: 도구 모음 + 쪽 그리기 + 자동 저장
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, PixelRatio, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../ui";
import { bounds, hitAlong, straighten, thin } from "./geometry";
import { History, removal } from "./history";
import {
  HIGHLIGHT_COLORS, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTHS, TEXT_SIZES, insertPage, makeTextBox, newId, removePage,
  type Ink, type Notebook, type Paper, type Stroke,
} from "./model";
import { pageImage } from "./pageImage";
import { PageCanvas, type Selection, type ToolName, type ZoomCmd } from "./PageCanvas";
import { PageGrid } from "./PageGrid";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { lassoSelect, moved, snapShape } from "./shapes";
import type { NoteStore } from "./store";

type Props = {
  store: NoteStore;
  id: string;
  onClose: () => void;
  onExport: (nb: Notebook, ink: Ink) => Promise<void>;
  onSummarize: (nb: Notebook, ink: Ink) => void; // 서버로 자세히
  onQuick: (nb: Notebook, ink: Ink) => void; // 기기에서 바로
};

export function Editor({ store, id, onClose, onExport, onSummarize, onQuick }: Props) {
  const t = useTheme();
  const [nb, setNb] = useState<Notebook | null>(null);
  const [ink, setInk] = useState<Ink>({});
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pi, setPi] = useState(0);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<ZoomCmd>({ kind: "fit", n: 0 });
  const [bg, setBg] = useState<Record<number, { uri: string; w: number }>>({});
  const [menu, setMenu] = useState(false);
  const [grid, setGrid] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; stroke?: Stroke } | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const hist = useRef(new History());
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const nbRef = useRef(nb);
  nbRef.current = nb;
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
    for (const pid of pages) await store.savePage(n.id, pid, inkRef.current[pid] ?? []);
    if (pages.length || metaDirty.current) {
      metaDirty.current = false;
      const next = { ...n, updated: Date.now() };
      nbRef.current = next;
      await store.save(next);
    }
  }, [store]);

  const touch = useCallback((pageId?: string) => {
    if (pageId) dirty.current.add(pageId);
    else metaDirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  useEffect(() => () => void flush(), [flush]);

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
    const have = bg[index]?.w ?? 0;
    if (have >= px * 0.9) return;
    pageImage(n.id, pdfUri, pg.pdf, px)
      .then((uri) => setBg((b) => ((b[index]?.w ?? 0) >= px ? b : { ...b, [index]: { uri, w: px } })))
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

  const onViewWidth = useCallback((pagePx: number) => {
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

  const onStroke = useCallback((pts: number[], stylus: boolean) => {
    const n = nbRef.current;
    const p = prefs;
    if (!n || !p || !page) return;
    if (stylus && p.fingerDraw && !p.stylusSeen) {
      // 펜을 처음 쓰면: 손가락은 화면 옮기기로 (손바닥이 닿아도 써지지 않게)
      setP({ fingerDraw: false, stylusSeen: true });
      say("펜이 감지되어 손가락은 화면 옮기기로 바꿨어요. 도구 모음의 ✋ 단추로 바꿀 수 있어요.");
    }
    const hl = p.tool === "highlighter";
    let clean = thin(pts, 0.35);
    if (hl && p.straight) clean = straighten(clean);
    if (!hl && p.shapes) clean = snapShape(clean)?.pts ?? clean;
    const s: Stroke = {
      id: newId(),
      tool: hl ? "highlighter" : "pen",
      color: hl ? p.hlColor : p.penColor,
      width: hl ? p.hlWidth : p.penWidth,
      pts: clean.map((v) => Math.round(v * 100) / 100),
    };
    setInk((k) => hist.current.run(k, { kind: "add", page: page.id, strokes: [s] }));
    touch(page.id);
    bump((x) => x + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, page, touch]);

  // 지우개: 문지르는 동안 닿은 획을 감췄다가, 손을 떼면 한 번의 작업으로 지운다
  const erased = useRef(new Set<string>());
  const lastErase = useRef<[number, number] | null>(null);
  const onErase = useCallback((phase: 0 | 1 | 2, x: number, y: number, r: number) => {
    if (!page) return;
    if (phase === 0) {
      erased.current = new Set();
      lastErase.current = [x, y];
    }
    if (phase === 0 || phase === 1) {
      const from = lastErase.current ?? [x, y];
      const cur = (inkRef.current[page.id] ?? []).filter((s) => !erased.current.has(s.id));
      const hit = hitAlong(cur, from[0], from[1], x, y, r);
      lastErase.current = [x, y];
      if (hit.length) {
        for (const s of hit) erased.current.add(s.id);
        setHidden(new Set(erased.current));
      }
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
  }, [page, touch]);

  // ── 올가미: 고르기 · 옮기기 · 색 바꾸기 · 지우기 ───────────
  const selBox = (strokes: Stroke[]): [number, number, number, number] => {
    const bs = strokes.map(bounds);
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
  };
  const onLasso = useCallback((pts: number[]) => {
    if (!page) return;
    const cur = inkRef.current[page.id] ?? [];
    const ids = lassoSelect(cur, pts);
    if (!ids.size) return setSelection(null);
    setSelection({ ids, box: selBox(cur.filter((s) => ids.has(s.id))) });
  }, [page]);
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

  // ── 글상자 ──────────────────────────────────────────────
  const onTextTap = useCallback((x: number, y: number) => {
    if (!page) return;
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

  const undo = () => {
    setSelection(null);
    const r = hist.current.undo(inkRef.current);
    setInk(r.ink);
    if (r.page) touch(r.page);
    bump((x) => x + 1);
  };
  const redo = () => {
    setSelection(null);
    const r = hist.current.redo(inkRef.current);
    setInk(r.ink);
    if (r.page) touch(r.page);
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
    onSummarize(nbRef.current ?? nb, inkRef.current);
  };
  const quick = async () => {
    if (!nb) return;
    setMenu(false);
    await flush();
    onQuick(nbRef.current ?? nb, inkRef.current);
  };

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.card }} edges={["top", "left", "right"]}>
      {/* 윗줄: 노트 이름, 되돌리기, 쪽 넘기기, 요약 (항상 보임) */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 4, gap: 2, backgroundColor: t.card }}>
        <Btn label="‹ 노트" onPress={close} label2="노트 목록으로" />
        <Pressable onPress={() => setRenaming(nb.title)} accessibilityRole="button" accessibilityLabel="노트 이름 바꾸기" style={{ flex: 1, paddingHorizontal: 6 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>{nb.title}</Text>
        </Pressable>
        <Btn label="↶" onPress={undo} disabled={!hist.current.canUndo} label2="되돌리기" />
        <Btn label="↷" onPress={redo} disabled={!hist.current.canRedo} label2="다시 하기" />
        <Sep />
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
      <View style={{ borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 8, paddingVertical: 5, gap: 4 }} keyboardShouldPersistTaps="handled">
          <ToolBtn label="✒️ 펜" on={tool === "pen"} onPress={() => setP({ tool: "pen" })} />
          <ToolBtn label="🖍 형광펜" on={tool === "highlighter"} onPress={() => setP({ tool: "highlighter" })} />
          <ToolBtn label="⌫ 지우개" on={tool === "eraser"} onPress={() => setP({ tool: "eraser" })} />
          <ToolBtn label="➰ 올가미" on={tool === "lasso"} onPress={() => setP({ tool: "lasso" })} hint="둘러싸서 고르고 옮기기" />
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
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c }} />
                </Pressable>
              ))}
              <Text style={{ color: t.muted, marginLeft: 6 }}>쪽을 누르면 글상자, 글상자를 누르면 고치기</Text>
            </>
          )}
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
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: 1, borderColor: "rgba(0,0,0,0.15)" }} />
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
        background={bg[pi]?.uri ?? null}
        strokes={strokes}
        hidden={hidden}
        tool={tool}
        color={color}
        width={width}
        fingerDraw={prefs.fingerDraw}
        zoom={zoom}
        onStroke={onStroke}
        onErase={onErase}
        onViewWidth={onViewWidth}
        selection={selection}
        onLasso={onLasso}
        onMoveSelection={onMoveSelection}
        onTextTap={onTextTap}
      />

      {selection && (
        <View style={{ position: "absolute", bottom: 24, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.card, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: t.line, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 }}>
          <Text style={{ color: t.muted, marginRight: 4 }}>{selection.ids.size}개 고름 · 끌어서 옮기기</Text>
          {PEN_COLORS.slice(0, 5).map((c) => (
            <Pressable key={c} onPress={() => replaceSelected((s) => ({ ...s, color: c }))} accessibilityRole="button" accessibilityLabel={`고른 것 색 ${c}`} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: 1, borderColor: "rgba(0,0,0,0.15)" }} />
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
          <Pressable style={{ marginTop: 60, marginRight: 12, backgroundColor: t.card, borderRadius: 12, paddingVertical: 6, minWidth: 240, borderWidth: 1, borderColor: t.line }} onPress={() => {}}>
            <MenuItem label="⚡ 바로 요약 (기기에서, 서버 없이)" onPress={quick} />
            <MenuItem label="✨ 서버로 자세히 요약 (요약집·AI)" onPress={summarize} />
            <MenuItem label="▦ 쪽 모아보기" onPress={() => { setMenu(false); setGrid(true); }} />
            <MenuItem label="📄 PDF로 내보내기 (필기 포함)" onPress={exportPdf} />
            <MenuItem label="＋ 뒤에 빈 쪽 (같은 속지)" onPress={() => addPage()} />
            <MenuItem label="＋ 뒤에 줄 쪽" onPress={() => addPage("lined")} />
            <MenuItem label="＋ 뒤에 모눈 쪽" onPress={() => addPage("grid")} />
            <MenuItem label="✎ 노트 이름 바꾸기" onPress={() => { setMenu(false); setRenaming(nb.title); }} />
            <MenuItem label="🗑 이 쪽 지우기" onPress={deletePage} disabled={nb.pages.length <= 1} danger />
          </Pressable>
        </Pressable>
      </Modal>

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

function ToolBtn({ label, on, onPress, hint }: { label: string; on: boolean; onPress: () => void; hint?: string }) {
  const t = useTheme();
  return (
    <Pressable
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
