// 동기화 코드 보관 (기기 보안 저장소). 코드를 아는 사람은 노트를 볼 수 있으므로 비밀로.
import * as SecureStore from "expo-secure-store";

const KEY = "pdfsummary.sync";
export type SyncConfig = { code: string };

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
