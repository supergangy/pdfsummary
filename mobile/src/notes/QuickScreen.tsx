// 서버 없이 기기에서 바로 만드는 요약 화면
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import * as DeviceAi from "../../modules/device-ai";
import { inkAvailable, inkStatus, prepareInk, recognizeInk } from "../../modules/ink-recognizer";
import { pageText } from "../../modules/pdf-pages";
import { ResultView } from "../platform/ResultView";
import { Bar, Button, Hint, type, useTheme } from "../ui";
import { tooSoon } from "./app-nav";
import type { Ink, Notebook } from "./model";
import { MyNoteMaker } from "./MyNoteMaker";
import { overviewPrompt, quickHtml, quickSummary, type QuickSummary, splitInkLines } from "./quick";
import { shareFile } from "./shareFile";
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
          <Button small label="공유 (HTML)" onPress={() => void shareFile(html, `${nb.title} 요약.html`, "text/html")} disabled={!q} />
          <Button small label="서버로 자세히" onPress={serverSummary} />
          {/* 손글씨를 다 읽은 뒤에 (읽는 중에 만들면 메모가 빠진다) */}
          <Button small kind="primary" label="나만의 노트" onPress={() => setMaking(true)} disabled={!q || !!prog} />
        </View>
      </View>
      {prog && (
        <View style={[s.strip, pad, { borderColor: t.lineSoft }]}>
          <Text style={[type.caption, { color: t.sub }]}>{prog.label}</Text>
          <Bar ratio={prog.ratio} />
        </View>
      )}
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
  msg: { paddingTop: 12 },
});
