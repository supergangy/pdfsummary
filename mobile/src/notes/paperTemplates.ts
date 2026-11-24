// 속지 무늬와 서식(템플릿)을 '그릴 것 목록'으로. 화면(Skia)·PDF 내보내기·목록의 작은 견본이 같은 목록을 그린다.
// 좌표는 쪽 좌표(pt, 왼쪽 위가 0,0). 글(text)의 y는 글자 밑줄(baseline) 자리.
import type { Paper } from "./model.ts";

export type PaperMark =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; color: string; w: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number }
  | { k: "dot"; x: number; y: number; r: number; color: string }
  | { k: "text"; x: number; y: number; size: number; color: string; text: string; center?: boolean };

/** 새 노트 창·쪽 더하기에 보이는 차례 */
export const PAPER_CHOICES: { value: Paper; label: string; template?: boolean }[] = [
  { value: "plain", label: "무지" },
  { value: "lined", label: "줄" },
  { value: "grid", label: "모눈" },
  { value: "dotted", label: "점" },
  { value: "cornell", label: "코넬 노트", template: true },
  { value: "todo", label: "할 일", template: true },
  { value: "month", label: "월간 달력", template: true },
  { value: "week", label: "주간 계획", template: true },
  { value: "wrong", label: "오답 노트", template: true },
];

export const PAPERS: readonly Paper[] = PAPER_CHOICES.map((p) => p.value);
export const isPaper = (v: unknown): v is Paper => typeof v === "string" && (PAPERS as readonly string[]).includes(v);

// 색: 종이 위라 밝은·어두운 모드와 관계없이 같다
const RULE = "#B9D3EE"; // 줄
const RULE_SOFT = "#DCE6F0"; // 옅은 줄
const FRAME = "#AFC0D1"; // 칸 테두리
const LABEL = "#8A96A3"; // 칸 이름
const BAND = "#F3F6F9"; // 칸 이름 줄 바탕
const SUN = "#E06C6C";
const SAT = "#5B8DEF";

const M = 36; // 쪽 가장자리 여백

function hline(out: PaperMark[], x1: number, x2: number, y: number, color = RULE, w = 0.6) {
  out.push({ k: "line", x1, y1: y, x2, y2: y, color, w });
}
function vline(out: PaperMark[], x: number, y1: number, y2: number, color = FRAME, w = 0.8) {
  out.push({ k: "line", x1: x, y1, x2: x, y2, color, w });
}
/** y0부터 y1 앞까지 gap마다 가로줄 */
function rules(out: PaperMark[], x1: number, x2: number, y0: number, y1: number, gap = 26, color = RULE_SOFT) {
  for (let y = y0; y < y1 - 4; y += gap) hline(out, x1, x2, y, color);
}
function label(out: PaperMark[], x: number, y: number, text: string, size = 10, color = LABEL) {
  out.push({ k: "text", x, y, size, color, text });
}
function box(out: PaperMark[], x: number, y: number, w: number, h: number, fill?: string) {
  out.push({ k: "rect", x, y, w, h, stroke: FRAME, sw: 0.8, ...(fill ? { fill } : {}) });
}

/** 쪽 하나의 속지 무늬 (무지·PDF 쪽은 빈 목록) */
export function paperMarks(paper: Paper | undefined, w: number, h: number): PaperMark[] {
  const out: PaperMark[] = [];
  switch (paper) {
    case "lined":
      for (let y = 84; y < h - 30; y += 26) hline(out, M, w - M, y);
      vline(out, 64, 40, h - 30, "#F2B8B8", 0.6);
      break;
    case "grid":
      for (let x = 18; x < w; x += 18) vline(out, x, 0, h, "#D5DEE8", 0.5);
      for (let y = 18; y < h; y += 18) hline(out, 0, w, y, "#D5DEE8", 0.5);
      break;
    case "dotted":
      for (let x = 18; x < w; x += 18) for (let y = 18; y < h; y += 18) out.push({ k: "dot", x, y, r: 0.8, color: "#B8BEC6" });
      break;
    case "cornell": {
      // 위: 제목 / 왼쪽: 핵심어 / 오른쪽: 필기 / 아래: 요약
      const top = 96, cue = 180, sum = h - 170;
      label(out, M + 4, 60, "제목 · 날짜");
      hline(out, M, w - M, top, FRAME, 1);
      vline(out, cue, top, sum, FRAME, 1);
      hline(out, M, w - M, sum, FRAME, 1);
      label(out, M + 4, top + 18, "핵심어 · 질문");
      label(out, cue + 8, top + 18, "필기");
      rules(out, M, w - M, top + 52, sum);
      label(out, M + 4, sum + 18, "요약");
      rules(out, M, w - M, sum + 48, h - M);
      break;
    }
    case "todo": {
      label(out, M + 4, 66, "할 일", 18, "#5F6B78");
      hline(out, M, w - M, 84, FRAME, 1);
      for (let y = 124; y < h - 40; y += 34) {
        out.push({ k: "rect", x: M + 8, y: y - 15, w: 14, h: 14, stroke: "#9AA7B4", sw: 1 });
        hline(out, M + 32, w - M, y + 3, RULE_SOFT);
      }
      break;
    }
    case "month": {
      // 위에 '○월'을 쓸 자리, 아래에 7칸 × 6줄 달력 (날짜는 직접 쓴다)
      hline(out, M, M + 58, 74, FRAME, 1);
      label(out, M + 62, 72, "월", 22, "#5F6B78");
      const y0 = 100, head = 26, cols = 7, rows = 6;
      const cw = (w - 2 * M) / cols, rh = (h - M - y0 - head) / rows;
      box(out, M, y0, w - 2 * M, head, BAND);
      ["일", "월", "화", "수", "목", "금", "토"].forEach((d, i) => {
        out.push({ k: "text", x: M + cw * i + cw / 2, y: y0 + 17, size: 11, color: i === 0 ? SUN : i === 6 ? SAT : LABEL, text: d, center: true });
      });
      for (let i = 0; i <= cols; i++) vline(out, M + cw * i, y0, h - M);
      for (let r = 0; r <= rows; r++) hline(out, M, w - M, y0 + head + rh * r, FRAME, 0.8);
      break;
    }
    case "week": {
      // 2줄 × 4칸: 월~일 + 메모
      label(out, M + 4, 66, "주간 계획", 18, "#5F6B78");
      hline(out, M, w - M, 84, FRAME, 1);
      const y0 = 100, gap = 10, cw = (w - 2 * M - gap) / 2, rh = (h - M - y0 - 3 * gap) / 4;
      const days = ["월", "화", "수", "목", "금", "토", "일", "메모"];
      days.forEach((d, i) => {
        const x = M + (i % 2) * (cw + gap), y = y0 + Math.floor(i / 2) * (rh + gap);
        box(out, x, y, cw, rh);
        label(out, x + 8, y + 17, d, 11, d === "일" ? SUN : d === "토" ? SAT : LABEL);
        rules(out, x + 8, x + cw - 8, y + 48, y + rh, 26);
      });
      break;
    }
    case "wrong": {
      // 오답 노트: 과목·날짜 / 문제 / 내 답·정답 / 풀이 / 다시 볼 점
      label(out, M + 4, 62, "과목");
      hline(out, M + 34, w / 2 - 12, 64, FRAME, 0.8);
      label(out, w / 2 + 4, 62, "날짜");
      hline(out, w / 2 + 34, w - M, 64, FRAME, 0.8);
      const sec = (y: number, hh: number, name: string, lines = true) => {
        box(out, M, y, w - 2 * M, hh);
        label(out, M + 8, y + 17, name);
        if (lines) rules(out, M + 8, w - M - 8, y + 48, y + hh, 26);
      };
      sec(84, 250, "문제", false);
      const ay = 344, ah = 52, half = (w - 2 * M - 10) / 2;
      box(out, M, ay, half, ah);
      label(out, M + 8, ay + 17, "내 답");
      box(out, M + half + 10, ay, half, ah);
      label(out, M + half + 18, ay + 17, "정답", 10, SUN);
      sec(406, 250, "풀이");
      sec(666, h - M - 666, "다시 볼 점");
      break;
    }
    default:
      break;
  }
  return out;
}

/** 서식에 글(칸 이름)이 있는지 — 있으면 PDF 내보내기에 한글 글꼴이 필요하다 */
export const paperHasText = (paper: Paper | undefined) => paperMarks(paper, 595, 842).some((m) => m.k === "text");
