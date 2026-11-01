import type { Settings } from "../api";

const KEY = "pdfsummary.settings";
export const EMPTY: Settings = { serverUrl: "", accessCode: "", apiKey: "" };

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 개인 정보 보호 모드 등: 이번 화면에서만 쓴다
  }
}
