// 동기화 켜기·연결·끄기 화면
import { useState } from "react";
import { Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";

import { Button, Hint, useTheme } from "../../ui";
import type { SyncStatus } from "./engine";
import type { SyncApi } from "./useSync";

export function statusText(s: SyncStatus): string {
  if (s.state === "off") return "꺼짐";
  if (s.state === "offline") return `연결 안 됨${s.waiting ? ` · 보낼 것 ${s.waiting}개 대기` : ""} (다시 연결되면 자동으로 보내요)`;
  if (s.state === "syncing" || s.waiting) return `동기화 중${s.waiting ? ` · 보낼 것 ${s.waiting}개` : ""}`;
  return "최신 상태";
}

export function SyncSheet({ visible, sync, onClose, onOpenSettings }: { visible: boolean; sync: SyncApi; onClose: () => void; onOpenSettings: () => void }) {
  const t = useTheme();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const hasServer = !!sync.server?.serverUrl && !!sync.server?.accessCode;

  const run = async (label: string, fn: () => Promise<void>) => {
    setErr("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const confirmStop = () => {
    const msg = "이 기기의 동기화를 끌까요? 이 기기의 노트는 그대로 남고, 다른 기기와 더 이상 맞춰지지 않아요.";
    if (Platform.OS === "web" ? (globalThis.confirm?.(msg) ?? true) : true) void run("끄는 중…", sync.stop);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 22, maxWidth: 640, width: "100%", alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700", flex: 1 }}>☁️ 실시간 동기화</Text>
          <Button kind="link" label="닫기" onPress={onClose} />
        </View>
        <Hint>아이패드·갤럭시탭·폰·컴퓨터에서 같은 노트를 쓰면, 한 기기에서 쓴 필기가 몇 초 안에 다른 기기에 나타나요. 인터넷이 끊겨도 쓰던 것은 모아 두었다가 다시 연결되면 보내요.</Hint>

        {!hasServer ? (
          <View style={{ marginTop: 18 }}>
            <Hint color={t.bad}>동기화는 앱용 서버를 거쳐요. 먼저 설정에서 서버 주소와 접속 코드를 넣어 주세요.</Hint>
            <Button label="설정 열기" onPress={onOpenSettings} style={{ marginTop: 10, alignSelf: "flex-start" }} />
          </View>
        ) : sync.code ? (
          <View style={{ marginTop: 18, gap: 10 }}>
            <Text style={{ color: t.ink, fontWeight: "600" }}>상태: {statusText(sync.status)}</Text>
            {!!sync.status.error && sync.status.state === "offline" && <Hint color={t.bad}>{sync.status.error}</Hint>}
            <Text style={{ color: t.ink, fontWeight: "600", marginTop: 8 }}>동기화 코드</Text>
            <Text selectable accessibilityLabel="동기화 코드" style={{ color: t.ink, fontSize: 22, fontWeight: "700", letterSpacing: 1, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", backgroundColor: t.card, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.line }}>
              {sync.code}
            </Text>
            <Hint>다른 기기의 '☁️ 동기화 → 코드로 연결'에 이 코드를 넣으세요. 코드를 아는 사람은 노트를 볼 수 있으니 다른 사람에게 알려 주지 마세요.</Hint>
            <Button label="이 기기 동기화 끄기" onPress={confirmStop} busy={busy === "끄는 중…"} style={{ alignSelf: "flex-start", marginTop: 8 }} />
          </View>
        ) : (
          <View style={{ marginTop: 18, gap: 12 }}>
            <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>처음 쓰는 기기라면</Text>
            <Button kind="primary" label="새로 동기화 시작" onPress={() => run("시작하는 중…", () => sync.start())} busy={busy === "시작하는 중…"} style={{ alignSelf: "flex-start" }} />
            <Hint>이 기기의 노트를 모두 올리고 동기화 코드를 만들어요.</Hint>
            <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16, marginTop: 14 }}>다른 기기에서 이미 쓰고 있다면</Text>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              placeholderTextColor={t.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="동기화 코드 넣기"
              style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 12, color: t.ink, backgroundColor: t.card, fontSize: 16 }}
            />
            <Button label="코드로 연결" onPress={() => run("연결하는 중…", () => sync.start(joinCode))} disabled={joinCode.replace(/[^A-Za-z0-9]/g, "").length < 20} busy={busy === "연결하는 중…"} style={{ alignSelf: "flex-start" }} />
            <Hint>그 기기의 노트를 받아 오고, 이 기기에 있던 노트도 함께 올려요.</Hint>
          </View>
        )}
        {!!err && <Hint color={t.bad} style={{ marginTop: 12 }}>{err}</Hint>}
      </ScrollView>
    </Modal>
  );
}
