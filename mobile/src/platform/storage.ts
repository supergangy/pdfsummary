// 설정(서버 주소·접속 코드·API 키)은 기기의 보안 저장소(키체인/키스토어)에 둔다.
import * as SecureStore from "expo-secure-store";
import type { Settings } from "../api";

const KEY = "pdfsummary.settings";
export const EMPTY: Settings = { serverUrl: "", accessCode: "", apiKey: "" };

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}
