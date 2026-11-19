const KEY = "pdfsummary.sync";
export type SyncConfig = { code: string };

export async function loadSyncConfig(): Promise<SyncConfig | null> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export async function saveSyncConfig(c: SyncConfig | null): Promise<void> {
  try {
    if (c) window.localStorage.setItem(KEY, JSON.stringify(c));
    else window.localStorage.removeItem(KEY);
  } catch {
    // 개인 정보 보호 모드 등
  }
}
