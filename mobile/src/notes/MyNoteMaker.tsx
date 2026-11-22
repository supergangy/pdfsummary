// '나만의 노트' 만들기 전 미리 보기: 넣을 항목 고르기, 차례 바꾸기, 메모 고치기, 형광펜 색의 뜻 정하기
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { loadSettings } from "../platform/storage";
import { Button, Chip, Hint, radius, styles as ui, type, useTheme } from "../ui";
import { AI_MAX_ITEMS, aiAccess, planText, requestExplain, type AiAccess, type AiConn } from "./aiExplain";
import type { Notebook, Stroke } from "./model";
import {
  applyExplains, boxesToMeasure, buildDraft, countOn, explainRequest, layoutNote, meaningOf, measureKey, moveEntry, patchEntry, placeInk, tagOf,
  usedHighlightColors, type Explain, type Meanings, type MyNoteDraft, type NoteEntry,
} from "./myNote";
import { loadMeanings, saveMeanings } from "./myNotePrefs";
import type { QuickSummary } from "./quick";
import { inkPicture } from "./render";
import type { NoteStore } from "./store";
import { loadSyncConfig } from "./sync/config";

type Props = { source: Notebook; summary: QuickSummary; store: NoteStore; onCancel: () => void; onMade: (id: string) => void };

export function MyNoteMaker({ source, summary, store, onCancel, onMade }: Props) {
  const t = useTheme();
  const [draft, setDraft] = useState<MyNoteDraft>(() => buildDraft(summary));
  const [meanings, setMeanings] = useState<Meanings>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 만들기 직전에 글상자들을 보이지 않게 그려 실제 높이를 잰다 (기기마다 줄바꿈이 달라 어림하면 겹친다)
  const [measuring, setMeasuring] = useState<ReturnType<typeof boxesToMeasure> | null>(null);
  const measured = useRef<{ map: Map<string, number>; need: number; done: () => void } | null>(null);
  // AI 설명 (프리미엄): 서버 연결·로그인·요금제를 보고, 받은 설명은 항목에 붙는다
  const conn = useRef<AiConn | null>(null);
  const [ai, setAi] = useState<AiAccess | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const pad = wide ? 24 : 16;
  const colors = useMemo(() => usedHighlightColors(draft), [draft]);
  const { on, all } = countOn(draft);

  useEffect(() => {
    (async () => {
      const st = await loadSettings();
      const sync = await loadSyncConfig();
      conn.current = { serverUrl: st.serverUrl, accessCode: st.accessCode, session: sync?.token ?? "" };
      setAi(await aiAccess(conn.current));
    })().catch(() => setAi({ ok: false, why: "offline", message: "AI 설명을 쓸 수 있는지 알아보지 못했어요." }));
  }, []);

  async function getExplains() {
    if (!conn.current) return;
    const items = explainRequest(draft, meanings);
    if (!items.length) return setAiNote("설명할 항목이 없어요 (글이 있는 항목을 켜 주세요).");
    setAiBusy(true);
    setAiNote(items.length > AI_MAX_ITEMS ? `항목이 많아 앞의 ${AI_MAX_ITEMS}개만 설명해요.` : "");
    try {
      const r = await requestExplain(conn.current, draft.source, items);
      setDraft((d) => applyExplains(d, r.items));
      if (r.plan) setAi({ ok: true, plan: r.plan });
      setAiNote(r.items.length ? `${r.items.length}개 항목에 설명을 붙였어요. 필요 없는 설명은 항목에서 뺄 수 있어요.` : "AI가 보기에 더 설명할 곳이 없었어요.");
    } catch (e) {
      setAiNote((e as Error).message);
      if ((e as { status?: number }).status === 401) setAi(await aiAccess(conn.current));
    } finally {
      setAiBusy(false);
    }
  }

  useEffect(() => {
    // 다 읽기 전에 고친 뜻이 있으면 그것을 남긴다
    void loadMeanings().then((saved) => setMeanings((cur) => ({ ...saved, ...cur })));
  }, []);

  // 안드로이드 '뒤로'는 요약 화면으로 (나중에 단 듣기가 먼저 불린다)
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const edit = (id: string, patch: Partial<NoteEntry>) => setDraft((d) => patchEntry(d, id, patch));

  async function make() {
    setBusy(true);
    setErr("");
    try {
      void saveMeanings(meanings);
      const boxes = boxesToMeasure(draft, meanings);
      const heights = new Map<string, number>();
      await new Promise<void>((resolve) => {
        measured.current = { map: heights, need: boxes.length, done: resolve };
        setMeasuring(boxes);
        setTimeout(resolve, 4000); // 다 못 재면 어림값으로
      });
      measured.current = null;
      setMeasuring(null);
      const { nb, ink } = layoutNote(draft, meanings, Date.now(), (text, size, w) => heights.get(measureKey(text, size, w)));
      await store.importUnpacked({ nb: source.folder ? { ...nb, folder: source.folder } : nb, ink, pdf: null });
      onMade(nb.id);
    } catch (e) {
      setErr(`노트를 만들지 못했어요: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const onMeasured = (key: string, h: number) => {
    const m = measured.current;
    if (!m || m.map.has(key)) return;
    m.map.set(key, h);
    if (m.map.size >= m.need) m.done();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      {measuring && (
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" aria-hidden style={s.measure}>
          {measuring.map((b) => (
            <Text
              key={b.key}
              allowFontScaling={false} // 노트의 글상자(TextLayer)와 똑같이
              onLayout={(e) => onMeasured(b.key, e.nativeEvent.layout.height)}
              style={{ position: "absolute", left: 0, top: 0, width: b.w, fontSize: b.size, lineHeight: b.size * 1.4 }}
            >
              {b.text}
            </Text>
          ))}
        </View>
      )}
      <View style={[s.bar, { paddingHorizontal: pad, borderColor: t.lineSoft }]}>
        <View style={s.lead}>
          <Button kind="link" label="‹ 요약으로" onPress={onCancel} />
          <View style={[s.sep, { backgroundColor: t.line }]} />
          <Text style={[type.label, { color: t.ink }]} numberOfLines={1}>나만의 노트</Text>
        </View>
        <Button small kind="primary" label={`노트로 만들기 (${on}개)`} onPress={() => void make()} disabled={!on} busy={busy} accessibilityLabel="노트로 만들기" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.body, { paddingHorizontal: pad }]}>
        <View style={s.col}>
          {!!err && <Hint color={t.bad}>{err}</Hint>}
          {all === 0 ? (
            <Hint>노트로 옮길 표시가 없어요. 교재 글자에 형광펜·밑줄·동그라미를 하거나 메모를 쓰면 여기에 모여요.</Hint>
          ) : (
            <Text style={[type.caption, { color: t.muted }]}>
              교재 쪽 순서대로 모았어요. 빼고 싶은 것은 눌러서 끄고, 메모는 고쳐 쓸 수 있어요. 만든 노트는 보통 노트처럼 이어서 쓸 수 있어요.
            </Text>
          )}

          <Text style={[type.label, s.label, { color: t.ink }]}>노트 이름</Text>
          <TextInput
            value={draft.title}
            onChangeText={(title) => setDraft((d) => ({ ...d, title }))}
            placeholder="나만의 노트"
            placeholderTextColor={t.muted}
            accessibilityLabel="나만의 노트 이름"
            style={[ui.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
          />

          {colors.length > 0 && (
            <>
              <Text style={[type.label, s.label, { color: t.ink }]}>형광펜 색의 뜻</Text>
              <Text style={[type.small, { color: t.muted, marginBottom: 10 }]}>노트에 꼬리표로 붙어요. 다음에도 기억해요.</Text>
              <View style={s.meanings}>
                {colors.map((c) => (
                  <View key={c} style={[s.meaning, { borderColor: t.line, backgroundColor: t.card }]}>
                    <View style={[s.swatch, { backgroundColor: c }]} />
                    <TextInput
                      value={meanings[c] ?? meaningOf(c, {})}
                      onChangeText={(v) => setMeanings((m) => ({ ...m, [c]: v }))}
                      accessibilityLabel={`${c} 형광펜의 뜻`}
                      style={[s.meaningInput, { color: t.ink }]}
                      maxLength={12}
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={s.options}>
            <Chip role="button" label="칠한 문장도 같이" on={draft.withContext} onPress={() => setDraft((d) => ({ ...d, withContext: !d.withContext }))} />
            {draft.sections.some((x) => x.entries.some((e) => e.kind === "term")) && (
              <Chip role="button" label="끝에 용어 모음" on={draft.glossary} onPress={() => setDraft((d) => ({ ...d, glossary: !d.glossary }))} />
            )}
          </View>

          {all > 0 && (
            <View style={[s.aiBox, { borderColor: t.line, backgroundColor: t.card }]}>
              <View style={s.aiHead}>
                <Text style={[type.label, { color: t.ink }]}>AI 설명</Text>
                <View style={[s.badge, { backgroundColor: t.soft }]}>
                  <Text style={[type.small, { color: t.accent, fontWeight: "600" }]}>프리미엄</Text>
                </View>
              </View>
              <Text style={[type.caption, { color: t.sub }]}>
                칠한 문장마다 AI가 필요한 곳에만 쉬운 설명과 표·그래프·순서 그림을 붙여요. 받은 설명은 아래 항목에서 보고 뺄 수 있어요.
              </Text>
              {ai === null ? (
                <ActivityIndicator color={t.muted} style={{ alignSelf: "flex-start", marginTop: 10 }} />
              ) : ai.ok ? (
                <View style={s.aiRow}>
                  <Text style={[type.small, { color: t.muted, flexShrink: 1 }]}>{planText(ai.plan)}</Text>
                  <Button
                    small
                    kind="dark"
                    label={aiBusy ? "AI가 설명을 쓰는 중… (1~2분)" : draft.sections.some((x) => x.entries.some((e) => e.explain)) ? "AI 설명 다시 받기" : "AI 설명 받기"}
                    onPress={() => void getExplains()}
                    busy={aiBusy}
                    disabled={busy || ai.plan.used >= ai.plan.limit}
                    accessibilityLabel="AI 설명 받기"
                  />
                </View>
              ) : (
                <Text style={[type.small, { color: t.muted, marginTop: 10 }]}>{ai.message}</Text>
              )}
              {!!aiNote && <Text style={[type.small, { color: t.sub, marginTop: 8 }]}>{aiNote}</Text>}
            </View>
          )}

          {draft.sections.map((sec) => (
            <View key={sec.id} style={s.section}>
              <View style={[s.secHead, { borderColor: t.lineSoft }]}>
                <TextInput
                  value={sec.title}
                  onChangeText={(title) => setDraft((d) => ({ ...d, sections: d.sections.map((x) => (x.id === sec.id ? { ...x, title } : x)) }))}
                  accessibilityLabel={`${sec.page + 1}쪽 묶음 제목`}
                  style={[type.heading, s.secTitle, { color: t.ink }]}
                />
                <Text style={[type.small, { color: t.muted }]}>{sec.entries.filter((e) => e.on).length}/{sec.entries.length}</Text>
              </View>
              {sec.entries.map((e, i) => (
                <EntryRow
                  key={e.id}
                  e={e}
                  tag={tagOf(e, meanings)}
                  withContext={draft.withContext}
                  first={i === 0}
                  last={i === sec.entries.length - 1}
                  onToggle={() => edit(e.id, { on: !e.on })}
                  onMemo={(memo) => edit(e.id, { memo })}
                  onText={(text) => edit(e.id, { text })}
                  onMove={(dir) => setDraft((d) => moveEntry(d, e.id, dir))}
                  onDropExplain={() => edit(e.id, { explain: undefined })}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EntryRow({ e, tag, withContext, first, last, onToggle, onMemo, onText, onMove, onDropExplain }: {
  e: NoteEntry; tag: string; withContext: boolean; first: boolean; last: boolean;
  onToggle: () => void; onMemo: (v: string) => void; onText: (v: string) => void; onMove: (dir: -1 | 1) => void; onDropExplain: () => void;
}) {
  const t = useTheme();
  const [memoOpen, setMemoOpen] = useState(!!e.memo);
  const barColor = e.kind === "memo" ? "#C9A7FF" : e.kind === "ink" ? t.line : e.color;
  const short = e.text.length > 24 ? e.text.slice(0, 24) + "…" : e.text || tag;
  return (
    <View style={[s.entry, { borderColor: t.lineSoft, opacity: e.on ? 1 : 0.45 }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: e.on }}
        accessibilityLabel={`${short} 넣기`}
        hitSlop={8}
        style={[s.check, { borderColor: e.on ? t.ink : t.line, backgroundColor: e.on ? t.ink : "transparent" }]}
      >
        {e.on && <Text style={{ color: t.bg, fontSize: 13, fontWeight: "700", lineHeight: 16 }}>✓</Text>}
      </Pressable>
      <View style={[s.colorBar, { backgroundColor: barColor, opacity: e.source === "highlight" || e.kind === "memo" ? 1 : 0.5 }]} />
      <View style={s.entryBody}>
        <Text style={[type.small, { color: t.muted }]}>{tag} · {e.page + 1}쪽</Text>
        {e.kind === "ink" ? (
          <InkPreview strokes={e.strokes} />
        ) : e.kind === "memo" ? (
          <TextInput
            value={e.text}
            onChangeText={onText}
            multiline
            accessibilityLabel={`${short} 메모 글`}
            style={[type.body, s.inlineInput, { color: t.ink }]}
          />
        ) : (
          <Text style={[type.body, { color: t.ink, fontWeight: "600" }]}>{e.text}</Text>
        )}
        {withContext && !!e.context && (
          <Text style={[type.caption, { color: t.sub, marginTop: 2 }]} numberOfLines={3}>{e.context}</Text>
        )}
        {e.kind !== "memo" && (memoOpen ? (
          <TextInput
            value={e.memo}
            onChangeText={onMemo}
            placeholder="메모"
            placeholderTextColor={t.muted}
            multiline
            autoFocus={!e.memo}
            accessibilityLabel={`${short} 메모`}
            style={[type.caption, s.memo, { color: t.accent, borderColor: t.line, backgroundColor: t.card }]}
          />
        ) : (
          <Pressable onPress={() => setMemoOpen(true)} accessibilityRole="button" accessibilityLabel={`${short}에 메모 더하기`} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 6 }}>
            <Text style={[type.small, { color: t.muted }]}>+ 메모</Text>
          </Pressable>
        ))}
        {e.explain && <ExplainPreview ex={e.explain} short={short} onDrop={onDropExplain} />}
      </View>
      <View style={s.moves}>
        <MoveBtn label="↑" a11y={`${short} 위로`} disabled={first} onPress={() => onMove(-1)} />
        <MoveBtn label="↓" a11y={`${short} 아래로`} disabled={last} onPress={() => onMove(1)} />
      </View>
    </View>
  );
}

/** 받은 AI 설명 미리 보기: 설명 글 + 표·막대·순서를 작게 */
function ExplainPreview({ ex, short, onDrop }: { ex: Explain; short: string; onDrop: () => void }) {
  const t = useTheme();
  const max = ex.chart ? Math.max(...ex.chart.values, 1e-9) : 1;
  return (
    <View style={[s.exBox, { backgroundColor: t.sunken }]}>
      <View style={s.exHead}>
        <Text style={[type.small, { color: t.accent, fontWeight: "600" }]}>AI 설명</Text>
        <Pressable onPress={onDrop} accessibilityRole="button" accessibilityLabel={`${short} AI 설명 빼기`} hitSlop={6}>
          <Text style={[type.small, { color: t.muted }]}>빼기</Text>
        </Pressable>
      </View>
      {!!ex.explain && <Text style={[type.caption, { color: t.sub }]}>{ex.explain}</Text>}
      {ex.table && (
        <View style={[s.exTable, { borderColor: t.line }]}>
          {!!ex.table.title && <Text style={[type.small, { color: t.ink, fontWeight: "600", padding: 6 }]}>{ex.table.title}</Text>}
          {[ex.table.columns, ...ex.table.rows].map((row, ri) => (
            <View key={ri} style={[s.exTr, { borderColor: t.line, backgroundColor: ri === 0 ? t.lineSoft : "transparent" }]}>
              {row.map((c, ci) => (
                <Text key={ci} style={[type.small, s.exTd, { color: ri === 0 ? t.ink : t.sub, fontWeight: ri === 0 ? "600" : "400" }]}>{c}</Text>
              ))}
            </View>
          ))}
        </View>
      )}
      {ex.chart && (
        <View style={{ gap: 4, marginTop: 6 }}>
          {!!ex.chart.title && <Text style={[type.small, { color: t.ink, fontWeight: "600" }]}>{ex.chart.title}</Text>}
          {ex.chart.labels.map((l, i) => (
            <View key={i} style={s.exBarRow}>
              <Text style={[type.small, { color: t.sub, width: 90 }]} numberOfLines={1}>{l}</Text>
              <View style={[s.exBar, { width: `${Math.max(2, (ex.chart!.values[i] / max) * 60)}%`, backgroundColor: "#C9A7FF" }]} />
              <Text style={[type.small, { color: t.ink }]}>{ex.chart!.values[i]}{ex.chart!.unit}</Text>
            </View>
          ))}
        </View>
      )}
      {ex.steps && (
        <Text style={[type.small, { color: t.ink, marginTop: 6 }]}>
          {ex.steps.title ? `${ex.steps.title}: ` : ""}{ex.steps.items.join("  →  ")}
        </Text>
      )}
    </View>
  );
}

function MoveBtn({ label, a11y, disabled, onPress }: { label: string; a11y: string; disabled: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [s.move, { backgroundColor: pressed ? t.sunken : "transparent", opacity: disabled ? 0.25 : 1 }]}
    >
      <Text style={{ color: t.sub, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** 글자로 못 읽은 손글씨: 흰 종이 위에 작게 (어두운 화면에서도 검은 펜이 보이게) */
function InkPreview({ strokes }: { strokes: Stroke[] }) {
  const t = useTheme();
  // 획 좌표 자체를 상자 안으로 옮겨 그린다. (Group의 옮기기+키우기는 적용 차례가 생각과 달라 그림이 상자 밖으로 나갔다)
  const view = useMemo(() => {
    const placed = placeInk(strokes, 4, 4, 240, 72, 1.5);
    const w = Math.ceil(placed.w) + 8, h = Math.ceil(placed.h) + 8;
    return { w, h, pic: inkPicture(placed.ss, new Set(), w, h, new WeakMap()) };
  }, [strokes]);
  return (
    <View style={[s.inkBox, { width: view.w, height: view.h, borderColor: t.lineSoft }]}>
      <Canvas style={{ width: view.w, height: view.h }}>
        <Picture picture={view.pic} />
      </Canvas>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 60, paddingVertical: 12, borderBottomWidth: 1 },
  lead: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  sep: { width: 1, height: 16 },
  body: { paddingTop: 20, paddingBottom: 64 },
  col: { width: "100%", maxWidth: 760, alignSelf: "center" },
  label: { marginTop: 24, marginBottom: 8 },
  meanings: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  meaning: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: radius.md, paddingLeft: 12, paddingRight: 4, minWidth: 140 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  meaningInput: { flex: 1, fontSize: 14, paddingVertical: 10, minWidth: 90 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 24 },
  section: { marginTop: 28 },
  secHead: { flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, paddingBottom: 6, marginBottom: 4 },
  secTitle: { flex: 1, paddingVertical: 4 },
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 2 },
  colorBar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  entryBody: { flex: 1, gap: 2 },
  inlineInput: { paddingVertical: 2, paddingHorizontal: 0 },
  memo: { marginTop: 8, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  moves: { gap: 2 },
  move: { width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  aiBox: { marginTop: 24, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 6 },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  aiRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 10 },
  exBox: { marginTop: 10, borderRadius: radius.md, padding: 12, gap: 4 },
  exHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  exTable: { marginTop: 6, borderWidth: 1, borderRadius: radius.sm, overflow: "hidden" },
  exTr: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  exTd: { flex: 1, paddingHorizontal: 6, paddingVertical: 5 },
  exBarRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  exBar: { height: 10, borderRadius: 3 },
  measure: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" },
  inkBox: { marginTop: 6, borderWidth: 1, borderRadius: radius.sm, backgroundColor: "#FFFFFF", overflow: "hidden" },
});
