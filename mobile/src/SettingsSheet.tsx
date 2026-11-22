// 설정: 화면 밝기 · 서버 주소 · 접속 코드 · 내 Claude API 키
import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Client, normalizeUrl, type ServerState, type Settings } from "./api";
import { Button, Hint, ScreenTitle, Segmented, styles as ui, type, useTheme, useThemeMode, type ThemeMode } from "./ui";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
  { value: "system", label: "기기 설정 따르기" },
];

export function SettingsSheet({
  visible, initial, onClose, onSave,
}: {
  visible: boolean;
  initial: Settings;
  onClose: () => void;
  onSave: (s: Settings, state: ServerState | null) => void;
}) {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const [s, setS] = useState<Settings>(initial);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const field = (label: string, key: keyof Settings, opts: { placeholder: string; secret?: boolean; hint?: string }) => (
    <View style={sx.field}>
      <Text style={[type.label, sx.fieldLabel, { color: t.ink }]}>{label}</Text>
      <TextInput
        value={s[key]}
        onChangeText={(v) => setS({ ...s, [key]: v })}
        placeholder={opts.placeholder}
        placeholderTextColor={t.muted}
        secureTextEntry={opts.secret}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        style={[ui.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
      />
      {!!opts.hint && <Hint style={sx.fieldHint}>{opts.hint}</Hint>}
    </View>
  );

  async function check() {
    setChecking(true);
    setMsg(null);
    const next = { ...s, serverUrl: normalizeUrl(s.serverUrl) };
    setS(next);
    try {
      const st = await new Client(next).state();
      const ai = next.apiKey.trim() ? "내 API 키로 AI 사용" : st.server_key ? "서버 키로 AI 사용" : "AI 없이 (API 키를 넣으면 AI 사용)";
      setMsg({ ok: true, text: `연결됐어요 · 서버 ${st.version} · 업로드 ${st.max_upload_mb}MB까지 · 파일은 ${st.keep_minutes}분 뒤 삭제 · ${ai}` });
      onSave(next, st);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onShow={() => { setS(initial); setMsg(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={[sx.page, { paddingHorizontal: width >= 700 ? 24 : 16 }]} keyboardShouldPersistTaps="handled">
          <ScreenTitle title="설정" right={<View style={sx.close}><Button kind="link" label="닫기" onPress={onClose} /></View>} />

          <Section title="화면">
            <Segmented label="화면 밝기" options={THEME_OPTIONS} value={mode} onChange={setMode} />
          </Section>

          <Section title="서버 연결">
            {/* 서버를 아직 안 정한 사람에게: 이 창이 왜 떴는지, 서버 없이도 되는 일이 있다는 것을 먼저 알린다 */}
            {(!initial.serverUrl.trim() || !initial.accessCode.trim()) && (
              <Hint style={sx.lead}>
                서버는 자세한 요약과 기기끼리 동기화에만 필요해요. 서버가 없으면 '닫기'를 누르세요. 필기와 노트 화면의 '요약' 단추(바로 요약)는 서버 없이도 쓸 수 있어요.
              </Hint>
            )}
            {field("서버 주소", "serverUrl", { placeholder: "https://…", hint: "PDF를 분석하는 서버예요. 직접 띄우는 방법은 README의 '앱용 서버'를 보세요." })}
            {field("접속 코드", "accessCode", { placeholder: "서버에 정한 접속 코드", secret: true })}
            {field("Claude API 키 (선택)", "apiKey", {
              placeholder: "sk-ant-…",
              secret: true,
              hint: "넣으면 손글씨 읽기와 단원 개요·연결 설명을 쓸 수 있어요. 이 기기의 보안 저장소에만 저장되고, 요약을 만들 때만 서버로 보내져 저장되지 않아요.",
            })}
            <View style={sx.link}>
              <Button kind="link" label="API 키 발급받기 (Claude Console) ›" accessibilityLabel="API 키 발급받기 (Claude Console)" onPress={() => Linking.openURL("https://platform.claude.com/")} />
            </View>
            <Button kind="primary" label="저장하고 연결 확인" onPress={check} busy={checking} disabled={!s.serverUrl.trim() || !s.accessCode.trim()} />
            {msg && <Hint color={msg.ok ? t.ok : t.bad} style={sx.result}>{msg.text}</Hint>}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** 설정의 한 묶음: 위에 옅은 구분선, 작은 제목 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[sx.section, { borderColor: t.lineSoft }]}>
      <Text style={[type.heading, sx.sectionTitle, { color: t.ink }]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

const sx = StyleSheet.create({
  page: { maxWidth: 640, width: "100%", alignSelf: "center", paddingTop: 24, paddingBottom: 48 },
  close: { paddingBottom: 6 },
  section: { marginTop: 24, paddingTop: 24, borderTopWidth: 1 },
  sectionTitle: { marginBottom: 4 },
  lead: { marginBottom: 4 },
  field: { marginTop: 20 },
  fieldLabel: { marginBottom: 8 },
  fieldHint: { marginTop: 8 },
  link: { marginTop: 16, marginBottom: 24, alignSelf: "flex-start" },
  result: { marginTop: 12 },
});
