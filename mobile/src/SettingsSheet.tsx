// 설정: 서버 주소 · 접속 코드 · 내 Claude API 키
import { useState } from "react";
import { KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Client, normalizeUrl, type ServerState, type Settings } from "./api";
import { Button, Hint, useTheme } from "./ui";

export function SettingsSheet({
  visible, initial, onClose, onSave,
}: {
  visible: boolean;
  initial: Settings;
  onClose: () => void;
  onSave: (s: Settings, state: ServerState | null) => void;
}) {
  const t = useTheme();
  const [s, setS] = useState<Settings>(initial);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const field = (label: string, key: keyof Settings, opts: { placeholder: string; secret?: boolean; hint?: string }) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: t.ink, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={s[key]}
        onChangeText={(v) => setS({ ...s, [key]: v })}
        placeholder={opts.placeholder}
        placeholderTextColor={t.muted}
        secureTextEntry={opts.secret}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, color: t.ink, backgroundColor: t.card, fontSize: 15 }}
      />
      {!!opts.hint && <Hint style={{ marginTop: 6 }}>{opts.hint}</Hint>}
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
        <ScrollView contentContainerStyle={{ padding: 22, maxWidth: 640, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700", flex: 1 }}>설정</Text>
            <Button kind="link" label="닫기" onPress={onClose} />
          </View>
          {field("서버 주소", "serverUrl", { placeholder: "https://…", hint: "PDF를 분석하는 서버예요. 직접 띄우는 방법은 README의 '앱용 서버'를 보세요." })}
          {field("접속 코드", "accessCode", { placeholder: "서버에 정한 접속 코드", secret: true })}
          {field("Claude API 키 (선택)", "apiKey", {
            placeholder: "sk-ant-…",
            secret: true,
            hint: "넣으면 손글씨 읽기와 단원 개요·연결 설명을 쓸 수 있어요. 이 기기의 보안 저장소에만 저장되고, 요약을 만들 때만 서버로 보내져 저장되지 않아요.",
          })}
          <Button kind="link" label="API 키 발급받기 (Claude Console)" onPress={() => Linking.openURL("https://platform.claude.com/")} />
          <View style={{ height: 20 }} />
          <Button kind="primary" label="저장하고 연결 확인" onPress={check} busy={checking} disabled={!s.serverUrl.trim() || !s.accessCode.trim()} />
          {msg && <Hint color={msg.ok ? t.ok : t.bad} style={{ marginTop: 12 }}>{msg.text}</Hint>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
