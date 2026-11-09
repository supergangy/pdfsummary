// 서버 없이 기기에서 바로 만드는 요약 화면
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import * as DeviceAi from "../../modules/device-ai";
import { inkAvailable, inkStatus, prepareInk, recognizeInk } from "../../modules/ink-recognizer";
import { pageText } from "../../modules/pdf-pages";
import { ResultView } from "../platform/ResultView";
import { Bar, Button, Hint, useTheme } from "../ui";
import type { Ink, Notebook } from "./model";
import { overviewPrompt, quickHtml, quickSummary, type QuickSummary } from "./quick";
import { shareFile } from "./shareFile";
import type { NoteStore } from "./store";

type Props = { nb: Notebook; ink: Ink; store: NoteStore; onBack: () => void; onServerSummary: () => void };

export function QuickScreen({ nb, ink, store, onBack, onServerSummary }: Props) {
  const t = useTheme();
  const [q, setQ] = useState<QuickSummary | null>(null);
  const [prog, setProg] = useState<{ label: string; ratio: number } | null>({ label: "필기한 쪽을 읽는 중…", ratio: 0 });
  const [err, setErr] = useState("");
  const [ink2, setInk2] = useState<string>("checking"); // 손글씨 인식 상태
  const [ai, setAi] = useState<DeviceAi.DeviceAiStatus | null>(null);
  const [note, setNote] = useState("");
  const alive = useRef(true);

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
        it.text = await recognizeInk(it.strokes);
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
  const aiOk = !!ai && ["available", "downloadable", "downloading"].includes(ai.status);
  const hwCount = q?.pages.reduce((n, p) => n + p.items.filter((i) => i.kind === "handwriting").length, 0) ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line, flexWrap: "wrap" }}>
        <Button kind="link" label="‹ 노트로" onPress={onBack} />
        <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16, flex: 1 }} numberOfLines={1}>⚡ {nb.title} · 기기에서 만든 요약</Text>
        {aiOk && q && !q.overview && <Button label="🤖 기기 AI 개요" onPress={writeOverview} disabled={!!prog} style={{ paddingVertical: 7 }} />}
        {inkAvailable && ink2 === "downloadable" && hwCount > 0 && (
          <Button label="✍️ 손글씨 인식 켜기 (약 20MB)" onPress={getInkModel} disabled={!!prog} style={{ paddingVertical: 7 }} />
        )}
        <Button label="공유 (HTML)" onPress={() => void shareFile(html, `${nb.title} 요약.html`, "text/html")} disabled={!q} style={{ paddingVertical: 7 }} />
        <Button label="✨ 서버로 자세히" onPress={onServerSummary} style={{ paddingVertical: 7 }} />
      </View>
      {prog && (
        <View style={{ padding: 14 }}>
          <Text style={{ color: t.ink }}>{prog.label}</Text>
          <Bar ratio={prog.ratio} />
        </View>
      )}
      {!!note && <Hint style={{ paddingHorizontal: 14, paddingTop: 8 }}>{note}</Hint>}
      {!!err && <Hint color={t.bad} style={{ padding: 14 }}>{err}</Hint>}
      {q ? <ResultView html={html} /> : !err && <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />}
    </SafeAreaView>
  );
}
