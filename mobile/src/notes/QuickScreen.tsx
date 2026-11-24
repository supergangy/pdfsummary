// 서버 없이 기기에서 바로 만드는 요약 화면
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import * as DeviceAi from "../../modules/device-ai";
import { inkAvailable, inkStatus, prepareInk, recognizeInk } from "../../modules/ink-recognizer";
import { pageText } from "../../modules/pdf-pages";
import { ResultView } from "../platform/ResultView";
import { Bar, Button, floating, Hint, radius, styles as ui, type, useTheme } from "../ui";
import { COLOR_INFO, type ColorKey } from "./bakedHighlights";
import { addBakedToSummary, bakedColors, scanBaked, type BakedScan } from "./findBaked";
import { tooSoon } from "./app-nav";
import type { Ink, Notebook } from "./model";
import { MyNoteMaker } from "./MyNoteMaker";
import { overviewPrompt, quickHtml, quickSummary, quickText, type QuickSummary, splitInkLines } from "./quick";
import { SummaryShare } from "./SummaryShare";
import type { NoteStore } from "./store";

type Props = { nb: Notebook; ink: Ink; store: NoteStore; onBack: () => void; onServerSummary: () => void; onOpenNote: (id: string) => void };

export function QuickScreen({ nb, ink, store, onBack, onServerSummary, onOpenNote }: Props) {
  const t = useTheme();
  const [q, setQ] = useState<QuickSummary | null>(null);
  const [prog, setProg] = useState<{ label: string; ratio: number } | null>({ label: "필기한 쪽을 읽는 중…", ratio: 0 });
  const [err, setErr] = useState("");
  const [ink2, setInk2] = useState<string>("checking"); // 손글씨 인식 상태
  const [ai, setAi] = useState<DeviceAi.DeviceAiStatus | null>(null);
  const [note, setNote] = useState("");
  const [making, setMaking] = useState(false); // '나만의 노트' 만들기 화면
  // 다른 앱에서 칠해 쪽 그림에 굳은 형광펜 찾기
  const [baked, setBaked] = useState<BakedScan | null>(null); // 찾은 결과 (색 고르기 창이 열림)
  const [bakedPick, setBakedPick] = useState<Set<ColorKey>>(new Set());
  const [bakedBusy, setBakedBusy] = useState(false);
  const stopBaked = useRef(false);
  const [rangeOpen, setRangeOpen] = useState(false); // 찾을 쪽 범위 고르는 창
  const [rFrom, setRFrom] = useState("1");
  const [rTo, setRTo] = useState(String(nb.pages.length));
  const [rangeErr, setRangeErr] = useState("");
  const alive = useRef(true);
  // 노트의 '요약' 단추를 빠르게 두 번 누르면 두 번째 누름이 같은 자리에 뜨는 '서버로 자세히'를 눌렀다 → 막 떴을 때의 누름은 넘긴다
  const openedAt = useRef(Date.now());
  const serverSummary = () => {
    if (!tooSoon(openedAt.current, Date.now())) onServerSummary();
  };

  useEffect(() => {
    alive.current = true;
    (async () => {
      const uri = nb.hasPdf ? await store.pdfUri(nb.id) : null;
      const res = await quickSummary(nb, ink, (i) => (uri ? pageText(uri, i) : Promise.resolve(null)), (d, n) =>
        alive.current && setProg({ label: `필기한 쪽을 읽는 중… ${d}/${n}`, ratio: n ? d / n : 1 }));
      if (!alive.current) return;
      setQ(res);
      setProg(null);
      const st = await inkStatus();
      if (!alive.current) return;
      setInk2(st);
      if (st === "available") await recognize(res);
      setAi(await DeviceAi.getStatus());
    })().catch((e) => alive.current && (setErr((e as Error).message), setProg(null)));
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function recognize(base: QuickSummary) {
    const todo = base.pages.flatMap((p) => p.items.filter((i) => i.kind === "handwriting" && !i.text));
    if (!todo.length) return;
    let done = 0;
    for (const it of todo) {
      if (!alive.current) return;
      setProg({ label: `손글씨를 글자로 읽는 중… ${done}/${todo.length}`, ratio: done / todo.length });
      try {
        // 줄마다 따로 읽어 줄바꿈으로 잇는다 (여러 줄을 한 번에 넘기면 엉뚱한 한 글자로 읽힌다)
        const lines: string[] = [];
        for (const ln of splitInkLines(it.strokes)) {
          const t = await recognizeInk(ln);
          if (t) lines.push(t);
        }
        it.text = lines.join("\n");
      } catch {
        // 못 읽은 손글씨는 그림으로만
      }
      done++;
    }
    setQ({ ...base });
    setProg(null);
  }

  async function getInkModel() {
    if (!q) return;
    setProg({ label: "손글씨 인식 모델을 받는 중… (처음 한 번)", ratio: 0 });
    try {
      setInk2(await prepareInk());
      await recognize(q);
    } catch (e) {
      setNote((e as Error).message);
      setProg(null);
    }
  }

  /** 다른 앱에서 칠한 형광펜: 쪽마다 그려 색을 찾고, 찾은 색을 고르게 한다 */
  /** 쪽 범위를 정해 찾기 시작 (전체면 range 없이) */
  function startRange(all: boolean) {
    const n = nb.pages.length;
    if (all) {
      setRangeOpen(false);
      void findBakedMarks();
      return;
    }
    const a = parseInt(rFrom.replace(/[^0-9]/g, ""), 10), b = parseInt(rTo.replace(/[^0-9]/g, ""), 10);
    if (!(a >= 1 && b >= a && a <= n)) {
      setRangeErr(`1부터 ${n} 사이로, 처음 쪽이 끝 쪽보다 크지 않게 넣어 주세요.`);
      return;
    }
    setRangeOpen(false);
    void findBakedMarks([a - 1, Math.min(n, b) - 1]);
  }

  async function findBakedMarks(range?: [number, number]) {
    if (!nb.hasPdf) return;
    stopBaked.current = false;
    setBakedBusy(true);
    setNote("");
    try {
      const uri = await store.pdfUri(nb.id);
      const res = await scanBaked(nb, uri, (d, n) => alive.current && setProg({ label: `쪽 그림에서 형광펜 색을 찾는 중… ${d}/${n}쪽`, ratio: n ? d / n : 1 }), () => stopBaked.current || !alive.current, range);
      if (!alive.current) return;
      setProg(null);
      const cs = bakedColors(res);
      if (!cs.length) {
        setNote(res.scanned < res.total ? `${res.scanned}쪽까지 찾았는데 칠해진 형광펜이 없었어요.` : "쪽 그림에서 칠해진 형광펜을 찾지 못했어요.");
        return;
      }
      setBakedPick(new Set([cs[0].key]));
      setBaked(res);
    } catch (e) {
      setErr(`형광펜을 찾지 못했어요: ${(e as Error).message}`);
      setProg(null);
    } finally {
      setBakedBusy(false);
    }
  }

  /** 고른 색의 형광펜 밑 글자를 읽어 요약에 더한다 */
  async function addBaked() {
    if (!baked || !q) return;
    const scan = baked;
    setBaked(null);
    stopBaked.current = false;
    setBakedBusy(true);
    try {
      const uri = await store.pdfUri(nb.id);
      const r = await addBakedToSummary(q, nb, uri, scan, bakedPick, (d, n) => alive.current && setProg({ label: `형광펜 밑 글자를 읽는 중… ${d}/${n}쪽`, ratio: n ? d / n : 1 }), () => stopBaked.current || !alive.current);
      if (!alive.current) return;
      setProg(null);
      setQ(r.summary);
      setNote(r.added
        ? `다른 앱에서 칠한 형광펜 ${r.added}곳을 요약에 더했어요. 쪽 그림의 색으로 찾은 것이라 정확하지 않을 수 있어요 (책에 인쇄된 색 상자가 섞이거나, 칠한 곳 끝 글자가 조금 잘리거나 더 붙을 수 있어요).`
        : "형광펜은 찾았지만 그 밑의 글자를 읽지 못했어요 (글자 층이 없는 그림 PDF일 수 있어요).");
    } catch (e) {
      setErr(`형광펜 글자를 읽지 못했어요: ${(e as Error).message}`);
      setProg(null);
    } finally {
      setBakedBusy(false);
    }
  }

  async function writeOverview() {
    if (!q) return;
    const pr = overviewPrompt(q);
    if (!pr) return setNote("개요를 쓸 글자가 없어요 (손글씨만 있으면 먼저 글자로 읽어야 해요).");
    setProg({ label: "기기 안 AI가 개요를 쓰는 중…", ratio: 0.5 });
    try {
      let st = ai;
      if (st && (st.status === "downloadable" || st.status === "downloading")) st = await DeviceAi.prepare();
      const text = await DeviceAi.generate(pr.instructions, pr.prompt, 300);
      setQ({ ...q, overview: text.trim() });
    } catch (e) {
      setNote(`개요를 쓰지 못했어요: ${(e as Error).message}`);
    } finally {
      setProg(null);
    }
  }

  const html = q ? quickHtml(q) : "";
  // 앱 안에서 볼 때는 앱의 화면 밝기(밝게·어둡게)를 요약에도 맞춘다. 공유하는 파일(html)은 보는 기기 설정을 따른다
  const shown = html.replace('<html lang="ko">', `<html lang="ko" data-theme="${t.dark ? "dark" : "light"}">`);
  const aiOk = !!ai && ["available", "downloadable", "downloading"].includes(ai.status);
  const hwCount = q?.pages.reduce((n, p) => n + p.items.filter((i) => i.kind === "handwriting").length, 0) ?? 0;
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const pad = { paddingHorizontal: wide ? 24 : 16 };

  if (making && q) return <MyNoteMaker source={nb} summary={q} store={store} onCancel={() => setMaking(false)} onMade={onOpenNote} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      {/* 맨 위 줄: 왼쪽에 돌아가기와 제목, 오른쪽에 조용한 단추들 (폰에서는 제목을 빼고 요약 안의 큰 제목을 쓴다) */}
      <View style={[s.bar, pad, { borderColor: t.lineSoft }]}>
        <View style={[s.lead, wide && s.leadWide]}>
          <Button kind="link" label="‹ 노트로" onPress={onBack} />
          {wide && (
            <>
              <View style={[s.sep, { backgroundColor: t.line }]} />
              <Text style={[type.label, s.title, { color: t.ink }]} numberOfLines={1}>
                {nb.title}
                <Text style={{ color: t.muted, fontWeight: "500" }}> · 기기에서 만든 요약</Text>
              </Text>
            </>
          )}
        </View>
        <View style={s.actions}>
          {aiOk && q && !q.overview && <Button small label="기기 AI 개요" onPress={writeOverview} disabled={!!prog} />}
          {inkAvailable && ink2 === "downloadable" && hwCount > 0 && (
            <Button small label="손글씨 인식 켜기 (약 20MB)" onPress={getInkModel} disabled={!!prog} />
          )}
          {/* 복사 · 공유(글로·PDF로·웹페이지로) */}
          <SummaryShare
            name={`${nb.title} 요약`}
            text={() => (q ? quickText(q) : "")}
            html={() => html}
            disabled={!q}
            onMessage={(m, bad) => (bad ? setErr(m) : setNote(m))}
          />
          {nb.hasPdf && <Button small label="다른 앱에서 칠한 형광펜 찾기" onPress={() => { setRangeErr(""); setRangeOpen(true); }} disabled={!q || !!prog || bakedBusy} />}
          <Button small label="서버로 자세히" onPress={serverSummary} />
          {/* 손글씨를 다 읽은 뒤에 (읽는 중에 만들면 메모가 빠진다) */}
          <Button small kind="primary" label="나만의 노트" onPress={() => setMaking(true)} disabled={!q || !!prog} />
        </View>
      </View>
      {prog && (
        <View style={[s.strip, pad, { borderColor: t.lineSoft }]}>
          <View style={s.stripHead}>
            <Text style={[type.caption, { color: t.sub, flex: 1 }]}>{prog.label}</Text>
            {bakedBusy && <Button small kind="link" label="멈추기" onPress={() => (stopBaked.current = true)} />}
          </View>
          <Bar ratio={prog.ratio} />
        </View>
      )}
      {/* 찾을 쪽 범위 */}
      <Modal visible={rangeOpen} transparent animationType="fade" onRequestClose={() => setRangeOpen(false)}>
        <View style={[s.back, { backgroundColor: t.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.32)" }]}>
          <View style={[floating(t), s.sheet]}>
            <Text style={[type.title, { color: t.ink }]}>어느 쪽에서 찾을까요?</Text>
            <Text style={[type.caption, { color: t.sub }]}>{`쪽마다 그림으로 그려 색을 찾아서 쪽당 0.5초쯤 걸려요 (전체 ${nb.pages.length}쪽이면 약 ${Math.max(1, Math.round((nb.pages.length * 0.5) / 60))}분). 단원만 찾으면 금방 끝나요.`}</Text>
            <View style={s.rangeRow}>
              <TextInput value={rFrom} onChangeText={(v) => { setRFrom(v); setRangeErr(""); }} keyboardType="number-pad" selectTextOnFocus accessibilityLabel="처음 쪽" style={[ui.input, s.rangeInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} />
              <Text style={[type.body, { color: t.sub }]}>쪽부터</Text>
              <TextInput value={rTo} onChangeText={(v) => { setRTo(v); setRangeErr(""); }} keyboardType="number-pad" selectTextOnFocus accessibilityLabel="끝 쪽" style={[ui.input, s.rangeInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} />
              <Text style={[type.body, { color: t.sub }]}>쪽까지</Text>
            </View>
            {!!rangeErr && <Text style={[type.caption, { color: t.bad }]}>{rangeErr}</Text>}
            <View style={s.sheetButtons}>
              <Button label="취소" onPress={() => setRangeOpen(false)} />
              <Button label={`전체 ${nb.pages.length}쪽`} onPress={() => startRange(true)} />
              <Button kind="primary" label="이 범위에서 찾기" onPress={() => startRange(false)} />
            </View>
          </View>
        </View>
      </Modal>
      {/* 찾은 형광펜 색 고르기 */}
      <Modal visible={!!baked} transparent animationType="fade" onRequestClose={() => setBaked(null)}>
        <View style={[s.back, { backgroundColor: t.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.32)" }]}>
          <View style={[floating(t), s.sheet]}>
            <Text style={[type.title, { color: t.ink }]}>찾은 형광펜 색</Text>
            <Text style={[type.caption, { color: t.sub }]}>
              {baked && baked.scanned < baked.total ? `${baked.scanned}/${baked.total}쪽까지 찾았어요. ` : ""}요약에 넣을 색을 고르세요. 다른 앱에서 칠한 형광펜은 쪽 그림의 색으로 찾아서 정확하지 않을 수 있어요 — 책에 인쇄된 색 상자·색 글씨가 섞이거나, 칠한 곳 끝 글자가 조금 잘릴 수 있어요.
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {baked && bakedColors(baked).map((c) => {
                const on = bakedPick.has(c.key);
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setBakedPick((cur) => {
                      const n = new Set(cur);
                      if (n.has(c.key)) n.delete(c.key);
                      else n.add(c.key);
                      return n;
                    })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${COLOR_INFO[c.key].name} 형광펜 ${c.count}곳`}
                    style={({ pressed }) => [s.colorRow, { borderColor: t.lineSoft, backgroundColor: pressed ? t.sunken : "transparent" }]}
                  >
                    <View style={[s.check, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : "transparent" }]}>
                      {on && <Text style={{ color: t.accentInk, fontWeight: "700", fontSize: 13 }}>✓</Text>}
                    </View>
                    <View style={[s.swatch, { backgroundColor: COLOR_INFO[c.key].hex }]} />
                    <Text style={[type.body, { color: t.ink, flex: 1 }]}>{COLOR_INFO[c.key].name}</Text>
                    <Text style={[type.caption, { color: t.muted, textAlign: "right" }]}>{`${c.count}곳 · ${c.pages}쪽`}{c.printed ? "\n거의 모든 쪽 — 책에 인쇄된 색일 수 있어요" : ""}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={s.sheetButtons}>
              <Button label="취소" onPress={() => setBaked(null)} />
              <Button kind="primary" label="이 색으로 요약에 넣기" onPress={addBaked} disabled={!bakedPick.size} />
            </View>
          </View>
        </View>
      </Modal>
      {!!note && <Hint style={[s.msg, pad]}>{note}</Hint>}
      {!!err && <Hint color={t.bad} style={[s.msg, pad]}>{err}</Hint>}
      {q ? <ResultView html={shown} /> : !err && <ActivityIndicator color={t.muted} style={{ marginTop: 48 }} />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, minHeight: 60, paddingVertical: 12, borderBottomWidth: 1 },
  lead: { flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1 },
  // 넓은 화면: 제목이 길면 단추를 밀어내지 않고 말줄임 (단추가 많아 좁아지면 단추가 다음 줄로)
  leadWide: { flexBasis: 0, flexShrink: 1, minWidth: 220 },
  sep: { width: 1, height: 16 },
  title: { flexShrink: 1, letterSpacing: -0.2 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, flexShrink: 1, maxWidth: "100%" },
  strip: { paddingVertical: 12, borderBottomWidth: 1 },
  stripHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  back: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { width: "100%", maxWidth: 460, borderRadius: radius.lg, padding: 20, gap: 10 },
  sheetButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
  colorRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  swatch: { width: 28, height: 14, borderRadius: 4 },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rangeInput: { width: 84, textAlign: "center", fontSize: 18, fontWeight: "700" },
  msg: { paddingTop: 12 },
});
