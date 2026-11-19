// 동기화 코드·로그인 세션 보관 (기기 보안 저장소). 아는 사람은 노트를 볼 수 있으므로 비밀로.
import * as SecureStore from "expo-secure-store";

const KEY = "pdfsummary.sync";
/** 동기화 코드로 쓰거나(code), 계정으로 로그인해서 쓴다(token·email). 둘 다 비밀. */
export type SyncConfig = { code?: string; token?: string; email?: string };

export async function loadSyncConfig(): Promise<SyncConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export async function saveSyncConfig(c: SyncConfig | null): Promise<void> {
  if (c) await SecureStore.setItemAsync(KEY, JSON.stringify(c));
  else await SecureStore.deleteItemAsync(KEY);
}
