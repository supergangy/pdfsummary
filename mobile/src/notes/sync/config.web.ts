const KEY = "pdfsummary.sync";
/** 동기화 코드로 쓰거나(code), 계정으로 로그인해서 쓴다(token·email). 둘 다 비밀. */
export type SyncConfig = { code?: string; token?: string; email?: string };

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
