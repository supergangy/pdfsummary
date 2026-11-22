// '나만의 노트' 만들기 전 미리 보기: 넣을 항목 고르기, 차례 바꾸기, 메모 고치기, 형광펜 색의 뜻 정하기
import { Canvas, Picture } from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Hint, radius, styles as ui, type, useTheme } from "../ui";
import type { Notebook, Stroke } from "./model";
import {
  boxesToMeasure, buildDraft, countOn, layoutNote, meaningOf, measureKey, moveEntry, patchEntry, placeInk, tagOf, usedHighlightColors,
  type Meanings, type MyNoteDraft, type NoteEntry,
} from "./myNote";
import { loadMeanings, saveMeanings } from "./myNotePrefs";
import type { QuickSummary } from "./quick";
import { inkPicture } from "./render";
import type { NoteStore } from "./store";

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
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const pad = wide ? 24 : 16;
  const colors = useMemo(() => usedHighlightColors(draft), [draft]);
  const { on, all } = countOn(draft);

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
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EntryRow({ e, tag, withContext, first, last, onToggle, onMemo, onText, onMove }: {
  e: NoteEntry; tag: string; withContext: boolean; first: boolean; last: boolean;
  onToggle: () => void; onMemo: (v: string) => void; onText: (v: string) => void; onMove: (dir: -1 | 1) => void;
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
      </View>
      <View style={s.moves}>
        <MoveBtn label="↑" a11y={`${short} 위로`} disabled={first} onPress={() => onMove(-1)} />
        <MoveBtn label="↓" a11y={`${short} 아래로`} disabled={last} onPress={() => onMove(1)} />
      </View>
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
  measure: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" },
  inkBox: { marginTop: 6, borderWidth: 1, borderRadius: radius.sm, backgroundColor: "#FFFFFF", overflow: "hidden" },
});
