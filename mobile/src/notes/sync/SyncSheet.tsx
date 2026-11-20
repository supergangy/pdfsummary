// 동기화 켜기·연결·끄기 화면: 계정 로그인(추천) 또는 동기화 코드
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";

import { Button, Hint, Segmented, useTheme } from "../../ui";
import type { AccountInfo, AccountSession } from "./account";
import { GoogleButton, googleAvailable } from "./GoogleButton";
import type { SyncStatus } from "./engine";
import type { SyncApi } from "./useSync";

export function statusText(s: SyncStatus): string {
  if (s.state === "off") return "꺼짐";
  if (s.state === "offline") return `연결 안 됨${s.waiting ? ` · 보낼 것 ${s.waiting}개 대기` : ""} (다시 연결되면 자동으로 보내요)`;
  if (s.state === "syncing" || s.waiting) return `동기화 중${s.waiting ? ` · 보낼 것 ${s.waiting}개` : ""}`;
  return "최신 상태";
}

/** 되돌릴 수 없는 일 전에 묻기 */
function confirmThen(title: string, msg: string, ok: string, fn: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${msg}`) ?? true) fn();
    return;
  }
  Alert.alert(title, msg, [{ text: "취소", style: "cancel" }, { text: ok, style: "destructive", onPress: fn }]);
}

const when = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};

export function SyncSheet({ visible, sync, onClose, onOpenSettings }: { visible: boolean; sync: SyncApi; onClose: () => void; onOpenSettings: () => void }) {
  const t = useTheme();
  const [way, setWay] = useState<"account" | "code">("account");
  const [joinCode, setJoinCode] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [delPw, setDelPw] = useState("");
  const [devices, setDevices] = useState<AccountSession[] | null>(null);
  const [info, setInfo] = useState<AccountInfo | null>(null); // 비밀번호가 있는 계정인지 등
  const [forgotStep, setForgotStep] = useState<"" | "email" | "code">(""); // 비밀번호 찾기
  const [resetCode, setResetCode] = useState("");
  const [verifyFor, setVerifyFor] = useState<"" | "signup" | "link">(""); // 가입할 때 이메일 확인
  const [verifyCode, setVerifyCode] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const hasServer = !!sync.server?.serverUrl && !!sync.server?.accessCode;
  const signedIn = !!sync.account && !sync.account.expired;

  const run = async (label: string, fn: () => Promise<void>) => {
    setErr("");
    setNote("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await sync.sessions());
      setInfo(await sync.me());
    } catch {
      setDevices(null);
    }
  }, [sync.sessions, sync.me]);

  useEffect(() => {
    if (visible && signedIn) void loadDevices();
    if (!visible) {
      setPw("");
      setOldPw("");
      setNewPw("");
      setDelPw("");
      setResetCode("");
      setForgotStep("");
      setVerifyCode("");
      setVerifyFor("");
      setErr("");
      setNote("");
    }
  }, [visible, signedIn, loadDevices]);

  const input = (label: string, value: string, set: (v: string) => void, o: { secret?: boolean; placeholder?: string; email?: boolean; fresh?: boolean } = {}) => (
    <TextInput
      value={value}
      onChangeText={set}
      placeholder={o.placeholder ?? label}
      placeholderTextColor={t.muted}
      secureTextEntry={o.secret}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={o.email ? "email-address" : "default"}
      textContentType={o.email ? "username" : o.fresh ? "newPassword" : o.secret ? "password" : "none"}
      autoComplete={o.email ? "email" : o.fresh ? "new-password" : o.secret ? "password" : "off"}
      accessibilityLabel={label}
      style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 12, color: t.ink, backgroundColor: t.card, fontSize: 16 }}
    />
  );

  /** 메일로 받은 6자리 코드 칸 (숫자만) */
  const codeInput = (value: string, set: (v: string) => void) => (
    <TextInput
      value={value}
      onChangeText={(v) => set(v.replace(/[^0-9]/g, "").slice(0, 6))}
      placeholder="메일로 받은 6자리 코드"
      placeholderTextColor={t.muted}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      accessibilityLabel="메일로 받은 코드"
      style={{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 12, color: t.ink, backgroundColor: t.card, fontSize: value ? 22 : 16, letterSpacing: value ? 6 : 0 }}
    />
  );

  /** 가입(또는 코드를 계정으로 옮기기) 시작: 메일 서버가 있는 서버면 확인 코드부터 */
  const beginSignup = (kind: "signup" | "link") =>
    run(kind === "signup" ? "만드는 중…" : "옮기는 중…", async () => {
      const need = await sync.signupStart(email.trim());
      if (!need) {
        await (kind === "signup" ? sync.signup(email.trim(), pw) : sync.linkAccount(email.trim(), pw));
        return;
      }
      setVerifyFor(kind);
      setVerifyCode("");
      setNote(`${email.trim()} 로 6자리 확인 코드를 보냈어요. 받은편지함과 스팸함을 확인해 주세요. 코드는 15분 동안 쓸 수 있어요.`);
    });

  const okLogin = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim()) && pw.length >= 8;
  const google = googleAvailable(sync.features.google) ? sync.features.google : null;
  /** Google로 계속하기 + '또는' 줄 */
  const googleBlock = (label?: string) =>
    google && (
      <>
        <GoogleButton
          ids={google}
          label={label}
          onToken={(idToken) => run("Google로 로그인 중…", () => sync.googleLogin(idToken))}
          onError={(m) => setErr(m)}
        />
        <Text style={{ color: t.muted, fontSize: 13 }}>또는 이메일로</Text>
      </>
    );
  const h = (text: string) => <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16, marginTop: 14 }}>{text}</Text>;

  const statusBlock = (
    <>
      <Text style={{ color: t.ink, fontWeight: "600" }}>상태: {statusText(sync.status)}</Text>
      {!!sync.status.error && sync.status.state === "offline" && <Hint color={t.bad}>{sync.status.error}</Hint>}
    </>
  );

  let body: React.ReactNode;
  if (!hasServer) {
    body = (
      <View style={{ marginTop: 18 }}>
        <Hint color={t.bad}>동기화는 앱용 서버를 거쳐요. 먼저 설정에서 서버 주소와 접속 코드를 넣어 주세요.</Hint>
        <Button label="설정 열기" onPress={onOpenSettings} style={{ marginTop: 10, alignSelf: "flex-start" }} />
      </View>
    );
  } else if (forgotStep && !signedIn) {
    // 비밀번호 찾기: 메일로 6자리 코드 → 새 비밀번호 → 로그인
    const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim());
    const sendCode = () =>
      run("보내는 중…", async () => {
        await sync.forgot(email.trim());
        setForgotStep("code");
        setNote(`${email.trim()} 로 6자리 코드를 보냈어요 (가입된 이메일이라면). 받은편지함과 스팸함을 확인해 주세요. 코드는 15분 동안 쓸 수 있어요.`);
      });
    body = (
      <View style={{ marginTop: 18, gap: 10 }}>
        <Text style={{ color: t.ink, fontWeight: "700", fontSize: 18 }}>🔑 비밀번호 찾기</Text>
        {forgotStep === "email" ? (
          <>
            <Hint>가입한 이메일로 6자리 코드를 보내 드려요. 그 코드로 새 비밀번호를 정하면 바로 로그인돼요.</Hint>
            {input("계정 이메일", email, setEmail, { email: true, placeholder: "이메일" })}
            <Button kind="primary" label="코드 메일 받기" disabled={!okEmail} busy={busy === "보내는 중…"} onPress={sendCode} style={{ alignSelf: "flex-start" }} />
          </>
        ) : (
          <>
            <Text style={{ color: t.ink }}>{email.trim()}</Text>
            {codeInput(resetCode, setResetCode)}
            {input("새 비밀번호", newPw, setNewPw, { secret: true, fresh: true, placeholder: "새 비밀번호 (8자 이상)" })}
            <Button
              kind="primary"
              label="새 비밀번호로 로그인"
              disabled={resetCode.length !== 6 || newPw.length < 8}
              busy={busy === "바꾸는 중…"}
              onPress={() =>
                run("바꾸는 중…", async () => {
                  await sync.resetPassword(email.trim(), resetCode, newPw);
                  setForgotStep("");
                  setResetCode("");
                  setNewPw("");
                  setNote("새 비밀번호로 바꾸고 로그인했어요. 다른 기기는 모두 로그아웃되었으니 새 비밀번호로 다시 로그인해 주세요.");
                })
              }
              style={{ alignSelf: "flex-start" }}
            />
            <Button kind="link" label="코드 다시 받기" onPress={sendCode} disabled={busy === "보내는 중…"} />
          </>
        )}
        <Button kind="link" label="돌아가기" onPress={() => { setForgotStep(""); setErr(""); setNote(""); }} />
        <Hint>메일이 오지 않으면 서버를 운영하는 사람에게 비밀번호를 새로 정해 달라고 하세요.</Hint>
      </View>
    );
  } else if (verifyFor && !signedIn) {
    // 가입할 때 이메일 확인: 메일로 받은 코드를 넣으면 가입 끝
    body = (
      <View style={{ marginTop: 18, gap: 10 }}>
        <Text style={{ color: t.ink, fontWeight: "700", fontSize: 18 }}>📮 이메일 확인</Text>
        <Hint>본인 이메일이 맞는지 확인해요. 나중에 비밀번호를 잊었을 때 이 이메일로 찾을 수 있어요.</Hint>
        <Text style={{ color: t.ink }}>{email.trim()}</Text>
        {codeInput(verifyCode, setVerifyCode)}
        <Button
          kind="primary"
          label={verifyFor === "signup" ? "확인하고 가입" : "확인하고 계정으로 옮기기"}
          disabled={verifyCode.length !== 6}
          busy={busy === "확인하는 중…"}
          onPress={() =>
            run("확인하는 중…", async () => {
              await (verifyFor === "signup" ? sync.signup(email.trim(), pw, verifyCode) : sync.linkAccount(email.trim(), pw, verifyCode));
              setVerifyFor("");
              setVerifyCode("");
            })
          }
          style={{ alignSelf: "flex-start" }}
        />
        <Button kind="link" label="코드 다시 받기" onPress={() => beginSignup(verifyFor)} disabled={!!busy} />
        <Button kind="link" label="이메일 고치기" onPress={() => { setVerifyFor(""); setVerifyCode(""); setErr(""); setNote(""); }} />
      </View>
    );
  } else if (sync.account?.expired) {
    // 로그인이 끝남 → 같은 계정으로 다시
    body = (
      <View style={{ marginTop: 18, gap: 10 }}>
        <Hint color={t.bad}>{sync.account.email} 계정의 로그인이 끝났어요 (다른 기기에서 로그아웃시켰거나 비밀번호가 바뀜). 다시 로그인하면 그동안 이 기기에서 쓴 것도 이어서 보내요.</Hint>
        {googleBlock("Google로 다시 로그인")}
        {input("계정 비밀번호", pw, setPw, { secret: true })}
        <Button kind="primary" label="다시 로그인" onPress={() => run("로그인 중…", () => sync.login(sync.account!.email, pw))} disabled={pw.length < 8} busy={busy === "로그인 중…"} style={{ alignSelf: "flex-start" }} />
        <Button kind="link" label="비밀번호를 잊었어요" onPress={() => { setEmail(sync.account!.email); setForgotStep("email"); setErr(""); }} />
        <Button kind="link" label="로그아웃" onPress={() => run("로그아웃 중…", sync.logout)} />
      </View>
    );
  } else if (signedIn) {
    body = (
      <View style={{ marginTop: 18, gap: 10 }}>
        {statusBlock}
        <Text accessibilityLabel="로그인한 계정" style={{ color: t.ink, fontSize: 18, fontWeight: "700", marginTop: 6 }}>
          👤 {sync.account!.email}
        </Text>
        <Hint>다른 기기에서도 이 계정으로 로그인하면 같은 노트가 맞춰져요.</Hint>

        {h("로그인된 기기")}
        {devices === null ? (
          <Hint>불러오는 중…</Hint>
        ) : (
          devices.map((d) => (
            <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderColor: t.line }}>
              <Text style={{ color: t.ink, flex: 1 }}>
                {d.device}
                {d.current ? " (이 기기)" : ""}
                <Text style={{ color: t.muted }}>{`  · 로그인 ${when(d.created)} · 마지막 ${when(d.used)}`}</Text>
              </Text>
              {!d.current && (
                <Button
                  kind="link"
                  label="로그아웃시키기"
                  accessibilityLabel={`${d.device} 로그아웃시키기`}
                  onPress={() =>
                    confirmThen("이 기기를 로그아웃시킬까요?", `${d.device}에서 더 이상 동기화되지 않아요. 잃어버린 기기라면 비밀번호도 바꾸세요.`, "로그아웃시키기", () =>
                      void run("", async () => {
                        await sync.revoke(d.id);
                        await loadDevices();
                      }),
                    )
                  }
                />
              )}
            </View>
          ))
        )}

        {info?.google && <Hint>🔗 Google 계정이 이어져 있어요. 어느 기기에서든 'Google로 계속하기'로 로그인할 수 있어요.</Hint>}

        {h(info && !info.has_password ? "비밀번호 만들기" : "비밀번호 바꾸기")}
        {info && !info.has_password ? (
          <Hint>Google로 가입해 비밀번호가 없어요. 비밀번호를 만들면 이메일·비밀번호로도 로그인할 수 있어요.</Hint>
        ) : (
          input("지금 비밀번호", oldPw, setOldPw, { secret: true })
        )}
        {input("새 비밀번호", newPw, setNewPw, { secret: true, fresh: true, placeholder: "새 비밀번호 (8자 이상)" })}
        <Button
          label={info && !info.has_password ? "비밀번호 만들기" : "비밀번호 바꾸기"}
          disabled={(!!info?.has_password && oldPw.length < 1) || newPw.length < 8}
          busy={busy === "바꾸는 중…"}
          onPress={() =>
            run("바꾸는 중…", async () => {
              await sync.changePassword(oldPw, newPw);
              setOldPw("");
              setNewPw("");
              setNote(info && !info.has_password ? "비밀번호를 만들었어요. 이제 이메일·비밀번호로도 로그인할 수 있어요. 다른 기기는 모두 로그아웃되었어요." : "비밀번호를 바꿨어요. 다른 기기는 모두 로그아웃되었어요.");
              await loadDevices();
            })
          }
          style={{ alignSelf: "flex-start" }}
        />

        {h("이 기기에서")}
        <Button
          label="로그아웃"
          busy={busy === "로그아웃 중…"}
          onPress={() =>
            confirmThen("로그아웃할까요?", "이 기기의 노트는 그대로 남고, 다른 기기와 더 이상 맞춰지지 않아요." + (sync.status.waiting ? ` 아직 못 보낸 ${sync.status.waiting}개는 보내지 않아요.` : ""), "로그아웃", () => void run("로그아웃 중…", sync.logout))
          }
          style={{ alignSelf: "flex-start" }}
        />

        {h("계정 삭제")}
        <Hint>계정과 서버에 있는 노트(동기화 기록·원본 PDF)를 모두 지워요. 각 기기 안의 노트는 남아요. 되돌릴 수 없어요.</Hint>
        {info && !info.has_password
          ? input("계정 삭제 이메일 확인", delPw, setDelPw, { email: true, placeholder: `확인을 위해 ${sync.account!.email} 를 그대로 입력` })
          : input("계정 삭제 비밀번호 확인", delPw, setDelPw, { secret: true, placeholder: "비밀번호" })}
        <Button
          label="계정 삭제"
          disabled={delPw.length < 1}
          busy={busy === "지우는 중…"}
          onPress={() => confirmThen("정말 계정을 지울까요?", "서버의 노트가 모두 지워지고 되돌릴 수 없어요.", "지우기", () => void run("지우는 중…", () => sync.deleteAccount(delPw)))}
          style={{ alignSelf: "flex-start" }}
        />
      </View>
    );
  } else if (sync.code) {
    body = (
      <View style={{ marginTop: 18, gap: 10 }}>
        {statusBlock}
        <Text style={{ color: t.ink, fontWeight: "600", marginTop: 8 }}>동기화 코드</Text>
        <Text selectable accessibilityLabel="동기화 코드" style={{ color: t.ink, fontSize: 22, fontWeight: "700", letterSpacing: 1, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", backgroundColor: t.card, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: t.line }}>
          {sync.code}
        </Text>
        <Hint>다른 기기의 '☁️ 동기화 → 코드로 연결'에 이 코드를 넣으세요. 코드를 아는 사람은 노트를 볼 수 있으니 다른 사람에게 알려 주지 마세요.</Hint>

        {h("계정으로 옮기기")}
        <Hint>코드를 옮겨 적는 대신 {google ? "Google 계정이나 " : ""}이메일·비밀번호로 로그인해서 쓸 수 있어요. 지금 노트가 그대로 새 계정으로 가고, 이 코드로 연결된 다른 기기도 계속 맞춰져요.</Hint>
        {googleBlock("Google 계정으로 옮기기")}
        {input("계정 이메일", email, setEmail, { email: true, placeholder: "이메일" })}
        {input("계정 비밀번호", pw, setPw, { secret: true, placeholder: "비밀번호 (8자 이상)" })}
        <Button label="계정 만들고 옮기기" disabled={!okLogin} busy={busy === "옮기는 중…"} onPress={() => beginSignup("link")} style={{ alignSelf: "flex-start" }} />

        <Button
          label="이 기기 동기화 끄기"
          onPress={() => confirmThen("동기화를 끌까요?", "이 기기의 노트는 그대로 남고, 다른 기기와 더 이상 맞춰지지 않아요.", "끄기", () => void run("끄는 중…", sync.stop))}
          busy={busy === "끄는 중…"}
          style={{ alignSelf: "flex-start", marginTop: 16 }}
        />
      </View>
    );
  } else {
    body = (
      <View style={{ marginTop: 12, gap: 12 }}>
        <Segmented
          label="어떻게 맞출까요?"
          options={[
            { value: "account", label: "계정으로 로그인" },
            { value: "code", label: "계정 없이 코드로" },
          ]}
          value={way}
          onChange={setWay}
        />
        {way === "account" ? (
          <>
            <Hint>같은 계정으로 로그인한 기기끼리 노트가 맞춰져요. 이 기기에 있던 노트도 계정으로 올라가요.</Hint>
            {googleBlock()}
            {input("계정 이메일", email, setEmail, { email: true, placeholder: "이메일" })}
            {input("계정 비밀번호", pw, setPw, { secret: true, placeholder: "비밀번호 (8자 이상)" })}
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button kind="primary" label="로그인" disabled={!okLogin} busy={busy === "로그인 중…"} onPress={() => run("로그인 중…", () => sync.login(email, pw))} />
              <Button label="새 계정 만들기" disabled={!okLogin} busy={busy === "만드는 중…"} onPress={() => beginSignup("signup")} />
            </View>
            <Button kind="link" label="비밀번호를 잊었어요" onPress={() => { setForgotStep("email"); setErr(""); setNote(""); }} />
          </>
        ) : (
          <>
            <Text style={{ color: t.ink, fontWeight: "700", fontSize: 16 }}>처음 쓰는 기기라면</Text>
            <Button kind="primary" label="새로 동기화 시작" onPress={() => run("시작하는 중…", () => sync.start())} busy={busy === "시작하는 중…"} style={{ alignSelf: "flex-start" }} />
            <Hint>이 기기의 노트를 모두 올리고 동기화 코드를 만들어요.</Hint>
            {h("다른 기기에서 이미 쓰고 있다면")}
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
            <Hint>그 기기의 노트를 받아 오고, 이 기기에만 있던 노트도 함께 올려요.</Hint>
          </>
        )}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 22, maxWidth: 640, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 22, fontWeight: "700", flex: 1 }}>☁️ 실시간 동기화</Text>
          <Button kind="link" label="닫기" onPress={onClose} />
        </View>
        <Hint>아이패드·갤럭시탭·폰·컴퓨터에서 같은 노트를 쓰면, 한 기기에서 쓴 필기가 몇 초 안에 다른 기기에 나타나요. 인터넷이 끊겨도 쓰던 것은 모아 두었다가 다시 연결되면 보내요.</Hint>
        {body}
        {!!note && <Hint color={t.ok} style={{ marginTop: 12 }}>{note}</Hint>}
        {!!err && <Hint color={t.bad} style={{ marginTop: 12 }}>{err}</Hint>}
      </ScrollView>
    </Modal>
  );
}
