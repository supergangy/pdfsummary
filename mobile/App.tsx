import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable, ScrollView, Switch, Text, TextInput, useColorScheme, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import {
  Client, colorFilters, isPdf, lastLine, sleep,
  type ColorInfo, type JobState, type RunOptions, type ServerState, type Settings, type UploadInfo,
} from "./src/api";
import { ResultView } from "./src/platform/ResultView";
import { shareResult } from "./src/platform/saveResult";
import { useShareIntent } from "./src/platform/shareIntent";
import { EMPTY, loadSettings, saveSettings } from "./src/platform/storage";
import type { Picked } from "./src/platform/types";
import { uploadPdf } from "./src/platform/upload";
import { SettingsSheet } from "./src/SettingsSheet";
import { Bar, Button, Card, DARK, Hint, LIGHT, Segmented, ThemeContext, useTheme } from "./src/ui";

type Slot = { picked: Picked; info?: UploadInfo; ratio: number; error?: string };
type ColorRow = ColorInfo & { on: boolean };

const NOTES = {
  style: {
    booklet: "AI가 책 내용과 내 표시로 주제별 핵심 정리를 만들어요: 개념 → 구조(비교 표) → 예상 문제 → 시험 포인트(출제 빈도 ★).",
    list: "내가 칠한 부분을 목차·쪽·색별로 그대로 모아요. AI 없이도 돼요.",
  },
  scope: {
    focus: "내가 표시한 주제만 정리하고, 이해에 필요한 앞뒤 설명을 곁들여요.",
    all: "넣은 쪽 전체를 정리해요. 표시한 부분은 형광펜으로 강조돼요.",
  },
  group_by: {
    chapter: "큰 제목 › 작은 제목 아래에 모아요. 맨 위에 목차가 붙어요.",
    page: "쪽 순서대로 모아요. 표시마다 어느 단원인지 적어 줘요.",
    color: "색마다 모아요 (예: 노랑=핵심만 따로 복습).",
  },
  context: {
    ai: "칠한 부분이 든 문장 전체 + AI가 단원 개요와 연결 설명을 붙여요.",
    sentence: "칠한 부분이 든 문장 전체를 보여 주고 칠한 부분만 굵게 해요.",
    none: "칠한 부분만 그대로 모아요.",
  },
  handwriting: {
    auto: "AI가 손글씨를 글로 바꿔요. 애매한 글씨는 원본 이미지도 같이.",
    image: "손글씨를 잘라낸 원본 이미지 그대로 넣어요.",
    both: "AI가 읽은 글과 원본 이미지를 항상 같이 넣어요.",
  },
} as const;

export default function App() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? DARK : LIGHT;
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Main />
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function Main() {
  const t = useTheme();
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [server, setServer] = useState<ServerState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [main, setMain] = useState<Slot | null>(null);
  const [orig, setOrig] = useState<Slot | null>(null);
  const [colors, setColors] = useState<ColorRow[] | null>(null);
  const [colorsBusy, setColorsBusy] = useState(false);
  const [colorsErr, setColorsErr] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState<Pick<RunOptions, "style" | "scope" | "group_by" | "context" | "handwriting">>({
    style: "list", scope: "focus", group_by: "chapter", context: "sentence", handwriting: "image",
  });

  const [job, setJob] = useState<{ id: string; state?: JobState } | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [runErr, setRunErr] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);
  const colorsReq = useRef(0);

  const client = useMemo(() => new Client(settings), [settings]);
  const ready = !!settings.serverUrl && !!settings.accessCode;
  const aiOk = !!settings.apiKey.trim() || !!server?.server_key;

  // 처음: 저장된 설정 불러오고 서버 상태 확인
  useEffect(() => {
    loadSettings().then(async (s) => {
      setSettings(s);
      setLoaded(true);
      if (s.serverUrl && s.accessCode) {
        try {
          setServer(await new Client(s).state());
        } catch {
          // 연결은 나중에 다시
        }
      } else {
        setShowSettings(true);
      }
    });
  }, []);

  // AI를 쓸 수 있으면 기본값을 AI로
  useEffect(() => {
    setOpts((o) => ({
      ...o,
      style: aiOk ? "booklet" : "list",
      context: aiOk ? (o.context === "sentence" ? "ai" : o.context) : o.context === "ai" ? "sentence" : o.context,
      handwriting: aiOk ? (o.handwriting === "image" ? "auto" : o.handwriting) : "image",
    }));
  }, [aiOk]);

  const upload = useCallback(
    async (which: "main" | "orig", picked: Picked) => {
      const set = which === "main" ? setMain : setOrig;
      if (!isPdf(picked.name, picked.mimeType)) {
        set({ picked, ratio: 0, error: "PDF 파일만 넣을 수 있어요." });
        return;
      }
      const limit = (server?.max_upload_mb ?? 300) * 1024 * 1024;
      if (picked.size && picked.size > limit) {
        set({ picked, ratio: 0, error: `파일이 너무 커요 (${server?.max_upload_mb ?? 300}MB까지).` });
        return;
      }
      set({ picked, ratio: 0 });
      if (which === "main") {
        setHtml(null);
        setJob(null);
      }
      try {
        const info = await uploadPdf(settings, picked, (r) => set((s) => (s ? { ...s, ratio: r } : s)));
        set({ picked, info, ratio: 1 });
      } catch (e) {
        set({ picked, ratio: 0, error: (e as Error).message });
      }
    },
    [settings, server],
  );

  // 다른 앱에서 공유받은 PDF
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  useEffect(() => {
    if (!hasShareIntent || !loaded) return;
    const f = shareIntent.files?.[0];
    if (f) {
      if (!ready) setShowSettings(true);
      else upload("main", { uri: f.path, name: f.fileName || "공유받은 파일.pdf", size: f.size, mimeType: f.mimeType });
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, loaded, ready, upload, resetShareIntent]);

  // 필기본(또는 원본)이 바뀌면 형광펜 색 다시 찾기
  const mainId = main?.info?.id;
  const origId = orig?.info?.id;
  useEffect(() => {
    if (!mainId) {
      setColors(null);
      return;
    }
    const req = ++colorsReq.current;
    setColorsBusy(true);
    setColorsErr("");
    client
      .colors(mainId, origId)
      .then((cs) => req === colorsReq.current && setColors(cs.map((c) => ({ ...c, on: true }))))
      .catch((e) => req === colorsReq.current && (setColors([]), setColorsErr((e as Error).message)))
      .finally(() => req === colorsReq.current && setColorsBusy(false));
  }, [mainId, origId, client]);

  async function pick(which: "main" | "orig") {
    if (!ready) {
      setShowSettings(true);
      return;
    }
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    upload(which, { uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType, webFile: a.file });
  }

  const anyColor = !colors?.length || colors.some((c) => c.on);
  const canRun = !!mainId && (!orig || !!origId) && anyColor && !colorsBusy && job?.state?.status !== "running" && !(job && !job.state);

  async function run() {
    if (!mainId) return;
    setRunErr("");
    setHtml(null);
    try {
      const id = await client.run(mainId, origId ?? null, {
        ...opts,
        colors: colors ? colorFilters(colors) : [],
        labels,
        title: main?.info?.title,
      });
      setJob({ id });
      let st: JobState;
      do {
        await sleep(900);
        st = await client.job(id);
        setJob({ id, state: st });
      } while (st.status === "running");
      if (st.status === "error") {
        setRunErr(st.error || "만들지 못했어요.");
        return;
      }
      setHtml(await client.resultText(id));
    } catch (e) {
      setRunErr((e as Error).message);
      setJob(null);
    }
  }

  async function share(file: "요약.html" | "요약.zip") {
    if (!job) return;
    setSharing(file);
    try {
      const stem = (main?.info?.name ?? "요약").replace(/\.pdf$/i, "");
      await shareResult(settings, job.id, file, stem);
    } catch (e) {
      if (Platform.OS === "web") setRunErr((e as Error).message);
      else Alert.alert("공유하지 못했어요", (e as Error).message);
    } finally {
      setSharing(null);
    }
  }

  // ── 결과 화면 ────────────────────────────────────────────
  if (html && job) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: t.line, flexWrap: "wrap" }}>
          <Button kind="link" label="← 다시 만들기" onPress={() => setHtml(null)} />
          <View style={{ flex: 1 }} />
          <Button label="공유 (HTML)" onPress={() => share("요약.html")} busy={sharing === "요약.html"} style={{ paddingVertical: 8 }} />
          <Button label="Markdown·이미지 (zip)" onPress={() => share("요약.zip")} busy={sharing === "요약.zip"} style={{ paddingVertical: 8 }} />
        </View>
        <ResultView html={html} />
      </SafeAreaView>
    );
  }

  // ── 만드는 화면 ──────────────────────────────────────────
  const running = !!job && (!job.state || job.state.status === "running");
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, width: "100%", maxWidth: 760, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: "800" }}>📚 필기 요약</Text>
            <Text style={{ color: t.muted, marginTop: 2 }}>형광펜·밑줄·손글씨만 모아 목차대로 정리해요.</Text>
          </View>
          <Button label="설정" onPress={() => setShowSettings(true)} style={{ paddingVertical: 8 }} />
        </View>

        {loaded && !ready && (
          <Card title="먼저 서버를 연결해 주세요">
            <Hint>PDF 분석은 서버에서 해요. 설정에서 서버 주소와 접속 코드를 넣어 주세요.</Hint>
            <Button kind="primary" label="설정 열기" onPress={() => setShowSettings(true)} style={{ marginTop: 12 }} />
          </Card>
        )}

        <Card step={1} title="PDF 고르기">
          <FileSlot label="필기한 PDF" slot={main} onPick={() => pick("main")} big />
          <View style={{ height: 10 }} />
          <FileSlot
            label="필기 전 원본 PDF (선택)"
            hint="넣으면 책에 원래 인쇄된 색칠·밑줄은 빼고 내가 한 필기만 찾아요."
            slot={orig}
            onPick={() => pick("orig")}
            onRemove={() => setOrig(null)}
          />
          {Platform.OS !== "web" && (
            <Hint style={{ marginTop: 10 }}>굿노트·삼성노트 등에서 PDF로 내보낸 뒤 공유 → '필기 요약'을 눌러도 바로 들어와요.</Hint>
          )}
        </Card>

        {mainId && (
          <Card step={2} title="형광펜 색 고르기">
            {colorsBusy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator color={t.accent} />
                <Text style={{ color: t.muted }}>형광펜 색을 찾는 중…</Text>
              </View>
            ) : colors && colors.length ? (
              <>
                <Hint style={{ marginBottom: 10 }}>내가 칠한 색만 켜 두세요. 색마다 의미(예: 핵심, 정의)를 적으면 요약에 같이 표시돼요.</Hint>
                {colors.map((c, i) => (
                  <ColorRowView
                    key={`${c.filter}-${i}`}
                    c={c}
                    showLabel={colors.findIndex((x) => x.family === c.family) === i}
                    label={labels[c.family] ?? ""}
                    onToggle={(on) => setColors(colors.map((x, j) => (j === i ? { ...x, on } : x)))}
                    onLabel={(v) => setLabels({ ...labels, [c.family]: v })}
                  />
                ))}
                {!anyColor && <Hint color={t.bad}>색을 하나 이상 켜 주세요.</Hint>}
              </>
            ) : (
              <Hint color={colorsErr ? t.bad : undefined}>
                {colorsErr || "형광펜은 찾지 못했어요. 밑줄·동그라미·손글씨·메모는 그대로 정리돼요."}
              </Hint>
            )}
          </Card>
        )}

        {mainId && (
          <Card step={3} title="정리 방법">
            <Segmented
              label="결과 모양"
              value={opts.style}
              onChange={(v) => setOpts({ ...opts, style: v })}
              options={[{ value: "booklet", label: "핵심 정리 요약집", disabled: !aiOk }, { value: "list", label: "표시 모음" }]}
              note={NOTES.style[opts.style]}
            />
            {opts.style === "booklet" ? (
              <Segmented
                label="정리 범위"
                value={opts.scope}
                onChange={(v) => setOpts({ ...opts, scope: v })}
                options={[{ value: "focus", label: "내가 표시한 주제 중심" }, { value: "all", label: "책 내용 전체" }]}
                note={NOTES.scope[opts.scope]}
              />
            ) : (
            <>
            <Segmented
              label="묶는 방식"
              value={opts.group_by}
              onChange={(v) => setOpts({ ...opts, group_by: v })}
              options={[{ value: "chapter", label: "목차별" }, { value: "page", label: "쪽별" }, { value: "color", label: "색별" }]}
              note={NOTES.group_by[opts.group_by]}
            />
            <Segmented
              label="문맥 보충"
              value={opts.context}
              onChange={(v) => setOpts({ ...opts, context: v })}
              options={[
                { value: "ai", label: "AI 개요·연결 설명", disabled: !aiOk },
                { value: "sentence", label: "앞뒤 문장" },
                { value: "none", label: "칠한 부분만" },
              ]}
              note={NOTES.context[opts.context]}
            />
            <Segmented
              label="손글씨"
              value={opts.handwriting}
              onChange={(v) => setOpts({ ...opts, handwriting: v })}
              options={[
                { value: "auto", label: "AI로 읽기", disabled: !aiOk },
                { value: "image", label: "원본 이미지" },
                { value: "both", label: "글 + 원본", disabled: !aiOk },
              ]}
              note={NOTES.handwriting[opts.handwriting]}
            />
            </>
            )}
            {!aiOk && <Hint>설정에 Claude API 키를 넣으면 AI 기능을 쓸 수 있어요.</Hint>}
            <Button kind="primary" label="요약 만들기" onPress={run} disabled={!canRun} busy={running} style={{ marginTop: 16, alignSelf: "flex-start", paddingHorizontal: 28 }} />
          </Card>
        )}

        {(running || runErr || job?.state?.status === "done") && (
          <Card title={runErr ? "만들지 못했어요" : running ? "만드는 중…" : "✅ 다 만들었어요"}>
            {running && (
              <>
                <Text style={{ color: t.ink }}>{lastLine(job?.state?.log ?? [])}</Text>
                {Object.entries(job?.state?.progress ?? {}).map(([k, [d, n]]) => (
                  <View key={k} style={{ marginTop: 10 }}>
                    <Text style={{ color: t.muted, fontSize: 13 }}>{k.replace(/^[^\p{L}]+/u, "")} {d}/{n}</Text>
                    <Bar ratio={n ? d / n : 0} />
                  </View>
                ))}
              </>
            )}
            {!!runErr && <Text style={{ color: t.bad }}>{runErr}</Text>}
            {job?.state?.status === "done" && !html && !runErr && <ActivityIndicator color={t.accent} />}
          </Card>
        )}
      </ScrollView>

      <SettingsSheet
        visible={showSettings}
        initial={settings}
        onClose={() => setShowSettings(false)}
        onSave={(s, st) => {
          setSettings(s);
          setServer(st);
          saveSettings(s);
        }}
      />
    </SafeAreaView>
  );
}

function FileSlot({
  label, hint, slot, onPick, onRemove, big,
}: {
  label: string;
  hint?: string;
  slot: Slot | null;
  onPick: () => void;
  onRemove?: () => void;
  big?: boolean;
}) {
  const t = useTheme();
  const uploading = slot && !slot.info && !slot.error;
  return (
    <Pressable
      onPress={slot ? undefined : onPick}
      accessibilityRole={slot ? undefined : "button"}
      accessibilityLabel={slot ? undefined : `${label} 고르기`}
      style={{
        borderWidth: slot ? 1 : 2,
        borderStyle: slot ? "solid" : "dashed",
        borderColor: t.line,
        borderRadius: 12,
        padding: big && !slot ? 26 : 14,
        backgroundColor: slot ? t.card : t.bg,
        alignItems: big && !slot ? "center" : "stretch",
      }}
    >
      {!slot ? (
        <>
          <Text style={{ fontSize: big ? 30 : 20, textAlign: big ? "center" : "left" }}>{big ? "📄" : "📗"}</Text>
          <Text style={{ color: t.ink, fontWeight: "700", fontSize: big ? 17 : 15, marginTop: 6, textAlign: big ? "center" : "left" }}>
            {big ? "필기한 PDF 고르기" : label}
          </Text>
          {!!hint && <Hint style={{ marginTop: 4 }}>{hint}</Hint>}
        </>
      ) : (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: 22 }}>{big ? "📕" : "📗"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: "600" }} numberOfLines={2}>{slot.picked.name}</Text>
              <Text style={{ color: slot.error ? t.bad : t.muted, fontSize: 13 }}>
                {slot.error
                  ? slot.error
                  : slot.info
                    ? `${slot.info.pages}쪽${big ? (slot.info.has_toc ? " · PDF 목차 있음" : " · 글자 크기로 제목을 찾아요") : ""}`
                    : "올리는 중…"}
              </Text>
            </View>
            <Button kind="link" label="바꾸기" onPress={onPick} />
            {onRemove && <Button kind="link" label="빼기" onPress={onRemove} />}
          </View>
          {uploading && <Bar ratio={slot.ratio} />}
        </View>
      )}
    </Pressable>
  );
}

function ColorRowView({
  c, showLabel, label, onToggle, onLabel,
}: {
  c: ColorRow;
  showLabel: boolean;
  label: string;
  onToggle: (on: boolean) => void;
  onLabel: (v: string) => void;
}) {
  const t = useTheme();
  const pages = c.pages.slice(0, 6).join(", ") + (c.pages.length > 6 ? "…" : "");
  return (
    <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10, marginBottom: 8, opacity: c.on ? 1 : 0.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Switch value={c.on} onValueChange={onToggle} accessibilityLabel={`${c.name} ${c.code ?? ""} 포함`} />
        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c.css, borderWidth: 1, borderColor: "rgba(0,0,0,0.12)" }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.ink, fontWeight: "600" }}>
            {c.name} <Text style={{ color: t.muted, fontWeight: "400", fontSize: 12 }}>{c.code ?? "(색 계열)"} · {c.count}곳 · {pages}쪽</Text>
          </Text>
          <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{c.sample ? `“${c.sample}”` : "(글자 없음)"}</Text>
        </View>
      </View>
      {showLabel && (
        <TextInput
          value={label}
          onChangeText={onLabel}
          placeholder="의미 (예: 핵심)"
          placeholderTextColor={t.muted}
          accessibilityLabel={`${c.name} 색의 의미`}
          style={{ marginTop: 8, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.ink }}
        />
      )}
    </View>
  );
}
