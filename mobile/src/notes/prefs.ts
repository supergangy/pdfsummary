// 도구 설정(마지막에 쓴 펜·색·굵기, 손가락으로 쓰기)을 기억한다.
import { HIGHLIGHT_COLORS, HIGHLIGHT_OPACITY, HIGHLIGHT_WIDTHS, PEN_COLORS, PEN_WIDTH_STEPS, PEN_WIDTHS, type LineDash, type PenBrush } from "./model";
import type { PenLook, SwapTarget } from "./editor-logic";
import type { PageFlow } from "./pageLayout";
import type { ToolbarDock } from "./toolbar";
import type { ToolName } from "./PageCanvas";
import { deviceFs } from "./fs";

export type Prefs = {
  tool: ToolName;
  penColor: string;
  penWidth: number;
  hlColor: string;
  hlWidth: number;
  penBrush: PenBrush;
  penDash: LineDash;
  hlOpacity: number;
  straight: boolean; // 형광펜 직선 자동 보정
  hlFit: boolean; // 형광펜을 글자 크기(글줄)에 맞춰 두께·자리 조절 (PDF 쪽)
  shapes: boolean; // 펜으로 그린 선·사각형·원·삼각형을 반듯하게
  eraserMode: "stroke" | "area"; // 획 지우개(닿은 획 통째로) / 영역 지우개(문지른 자리만)
  eraserSize: number; // 화면에서 지우개 반지름(px)
  eraserHlOnly: boolean; // 형광펜만 지우기
  lassoMode: "free" | "rect";
  lassoPartial: boolean; // 조금이라도 걸친 것도 고르기
  textSize: number;
  fingerDraw: boolean; // 손가락으로 쓰기 (꺼지면 손가락은 화면 옮기기)
  swapTool: SwapTarget; // S펜 옆 단추를 (펜을 띄운 채) 두 번 누르면 바꿀 도구
  favorite: PenLook | null; // 즐겨찾는 펜 (두 번 누르기로 바꿀 펜 모양)
  stylusSeen: boolean;
  flow: PageFlow; // 쪽 넘기기: 좌우(한 쪽씩 딱 맞춰) / 위아래(이어서)
  twoPages: boolean; // 두 쪽씩 보기
  snapPages: boolean; // 좌우 넘기기에서 손을 떼면 쪽에 딱 맞추기 (기본 꺼짐: 놓은 자리 그대로, 사용자 요청)
  toolbar: string[]; // 도구 모음 순서 (toolbar.ts의 항목 id, 비면 기본 순서)
  toolbarHidden: string[]; // 도구 모음에서 숨긴 항목
  toolbarDock: ToolbarDock; // 도구 모음 자리: 위·왼쪽·오른쪽·떠 있게
  toolbarFloat: { x: number; y: number } | null; // 떠 있는 도구 모음 자리
  toolbarMin: boolean; // 도구 모음 접기 (지금 도구 하나와 펼치기 단추만)
  toolbarShape: "row" | "two" | "column"; // 떠 있는 도구 모음 모양: 한 줄·두 줄·세로
};

export const DEFAULT_PREFS: Prefs = {
  tool: "pen",
  penColor: PEN_COLORS[0],
  penWidth: PEN_WIDTHS[1],
  hlColor: HIGHLIGHT_COLORS[0],
  hlWidth: HIGHLIGHT_WIDTHS[1],
  penBrush: "fountain",
  penDash: "solid",
  hlOpacity: HIGHLIGHT_OPACITY,
  straight: true,
  hlFit: true,
  shapes: false,
  eraserMode: "stroke",
  eraserSize: 12,
  eraserHlOnly: false,
  lassoMode: "free",
  lassoPartial: false,
  textSize: 16,
  fingerDraw: true,
  swapTool: "highlighter",
  favorite: null,
  stylusSeen: false,
  flow: "h",
  twoPages: false,
  snapPages: false,
  toolbar: [],
  toolbarHidden: [],
  toolbarDock: "top",
  toolbarFloat: null,
  toolbarMin: false,
  toolbarShape: "row",
};

const PATH = "prefs.json";

/** 예전 판에서 고른 펜 굵기(pt)를 가장 가까운 mm 단계로 (0.3·0.5·0.7mm 단추가 켜져 보이게) */
export function snapWidth(w: number): number {
  if (!Number.isFinite(w) || w <= 0) return DEFAULT_PREFS.penWidth;
  return PEN_WIDTH_STEPS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const t = await deviceFs.readText(PATH);
    if (!t) return DEFAULT_PREFS;
    const p: Prefs = { ...DEFAULT_PREFS, ...JSON.parse(t) };
    return { ...p, penWidth: snapWidth(p.penWidth) };
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
