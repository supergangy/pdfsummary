// 필기 화면: 도구 모음 + 쪽 그리기 + 자동 저장
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, PixelRatio, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../ui";
import { hitAlong, straighten, thin } from "./geometry";
import { History, removal } from "./history";
import {
  HIGHLIGHT_COLORS, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTHS, insertPage, newId, removePage,
  type Ink, type Notebook, type Paper, type Stroke,
} from "./model";
import { pageImage } from "./pageImage";
import { PageCanvas, type ToolName, type ZoomCmd } from "./PageCanvas";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import type { NoteStore } from "./store";

type Props = {
  store: NoteStore;
  id: string;
  onClose: () => void;
  onExport: (nb: Notebook, ink: Ink) => Promise<void>;
  onSummarize: (nb: Notebook, ink: Ink) => void;
};

export function Editor({ store, id, onClose, onExport, onSummarize }: Props) {
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

  const undo = () => {
    const r = hist.current.undo(inkRef.current);
    setInk(r.ink);
    if (r.page) touch(r.page);
    bump((x) => x + 1);
  };
  const redo = () => {
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
        <Text style={{ color: t.ink, minWidth: 52, textAlign: "center" }} accessibilityLabel="쪽 번호">{pi + 1} / {nb.pages.length}</Text>
        <Btn label="▶" onPress={() => go(pi + 1)} disabled={pi >= nb.pages.length - 1} label2="다음 쪽" />
        <Btn label="⋯" onPress={() => setMenu(true)} label2="더 보기" />
        <Pressable onPress={summarize} accessibilityRole="button" accessibilityLabel="요약 만들기" style={{ backgroundColor: t.accent, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, marginLeft: 4 }}>
          <Text style={{ color: t.accentInk, fontWeight: "700" }}>요약</Text>
        </Pressable>
      </View>
      {/* 아랫줄: 도구 (좁으면 옆으로 밀어서) */}
      <View style={{ borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingHorizontal: 8, paddingVertical: 5, gap: 4 }} keyboardShouldPersistTaps="handled">
          <ToolBtn label="✒️ 펜" on={tool === "pen"} onPress={() => setP({ tool: "pen" })} />
          <ToolBtn label="🖍 형광펜" on={tool === "highlighter"} onPress={() => setP({ tool: "highlighter" })} />
          <ToolBtn label="⌫ 지우개" on={tool === "eraser"} onPress={() => setP({ tool: "eraser" })} />
          {tool !== "eraser" && (
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
      />

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
            <MenuItem label="✨ 요약 만들기" onPress={summarize} />
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
    </SafeAreaView>
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
