// Google로 계속하기 (아이패드·아이폰·안드로이드): 기기의 Google 로그인 → ID 토큰 → 서버가 확인
import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { radius, useTheme } from "../../ui";

export type GoogleIds = { web: string; ios?: string };
export type GoogleButtonProps = {
  ids: GoogleIds;
  onToken: (idToken: string) => Promise<void>;
  onError: (message: string) => void;
  label?: string;
};

/** iOS 앱에 빌드할 때 넣은 iOS 클라이언트 ID (app.config.js) */
const builtInIos = (Constants.expoConfig?.extra as { googleIosClientId?: string | null } | undefined)?.googleIosClientId ?? null;

/** 이 기기에서 Google 로그인을 쓸 수 있는지. iOS는 앱에 넣은 iOS 클라이언트 ID가 서버 것과 같아야 한다. */
export function googleAvailable(ids: GoogleIds | null | undefined): ids is GoogleIds {
  if (!ids?.web) return false;
  return Platform.OS !== "ios" || (!!builtInIos && builtInIos === ids.ios);
}

export function GoogleButton({ ids, onToken, onError, label = "Google로 계속하기" }: GoogleButtonProps) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const press = async () => {
    setBusy(true);
    try {
      // 서버가 확인할 토큰의 '받는 앱': 안드로이드는 웹 클라이언트 ID, iOS는 iOS 클라이언트 ID
      GoogleSignin.configure({ webClientId: ids.web, ...(ids.ios ? { iosClientId: ids.ios } : {}) });
      if (Platform.OS === "android") await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const r = await GoogleSignin.signIn();
      if (r.type !== "success") return; // 사용자가 닫음
      await GoogleSignin.signOut().catch(() => undefined); // 다음에 다른 Google 계정도 고를 수 있게
      if (!r.data.idToken) throw new Error("Google에서 로그인 정보를 받지 못했어요.");
      await onToken(r.data.idToken);
    } catch (e) {
      if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) return;
      if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return onError("이 기기에는 Google Play 서비스가 없어 Google 로그인을 쓸 수 없어요.");
      onError((e as Error).message || "Google 로그인에 실패했어요.");
    } finally {
      setBusy(false);
    }
  };
  // 흰 바탕 + 옅은 테두리 단추. 왼쪽 'G'는 Google 파란색 (Google 로그인 단추 안내에 맞춤)
  return (
    <Pressable
      onPress={() => void press()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [s.btn, { backgroundColor: t.card, borderColor: t.line, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={s.mark}>{busy ? <ActivityIndicator size="small" color={t.ink} /> : <Text style={s.g}>G</Text>}</View>
      <Text style={[s.label, { color: t.ink }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingHorizontal: 18, borderWidth: 1, borderRadius: radius.md },
  mark: { width: 20, alignItems: "center" },
  g: { color: "#4285F4", fontSize: 18, fontWeight: "700" },
  label: { fontSize: 15, fontWeight: "600", letterSpacing: -0.2 },
});
