// 도구 설정(마지막에 쓴 펜·색·굵기, 손가락으로 쓰기)을 기억한다.
import { HIGHLIGHT_COLORS, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTHS } from "./model";
import type { ToolName } from "./PageCanvas";
import { deviceFs } from "./fs";

export type Prefs = {
  tool: ToolName;
  penColor: string;
  penWidth: number;
  hlColor: string;
  hlWidth: number;
  straight: boolean; // 형광펜 직선
  fingerDraw: boolean; // 손가락으로 쓰기 (꺼지면 손가락은 화면 옮기기)
  stylusSeen: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  tool: "pen",
  penColor: PEN_COLORS[0],
  penWidth: PEN_WIDTHS[1],
  hlColor: HIGHLIGHT_COLORS[0],
  hlWidth: HIGHLIGHT_WIDTHS[1],
  straight: true,
  fingerDraw: true,
  stylusSeen: false,
};

const PATH = "prefs.json";

export async function loadPrefs(): Promise<Prefs> {
  try {
    const t = await deviceFs.readText(PATH);
    return t ? { ...DEFAULT_PREFS, ...JSON.parse(t) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(p: Prefs): Promise<void> {
  try {
    await deviceFs.writeText(PATH, JSON.stringify(p));
  } catch {
    // 기억 못 해도 쓰는 데는 문제없음
  }
}
