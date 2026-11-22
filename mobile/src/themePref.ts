// 화면 밝기 설정(밝게·어둡게·기기 설정 따르기)을 이 기기에 기억한다. 기본은 밝게 (흰 바탕의 모던 미니멀).
import { deviceFs } from "./notes/fs";
import type { ThemeMode } from "./ui";

const PATH = "ui.json";

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const t = await deviceFs.readText(PATH);
    const m = t ? (JSON.parse(t) as { theme?: string }).theme : undefined;
    return m === "dark" || m === "system" ? m : "light";
  } catch {
    return "light";
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await deviceFs.writeText(PATH, JSON.stringify({ theme: mode }));
  } catch {
    // 기억 못 해도 지금 화면에는 바로 적용된다
  }
}
