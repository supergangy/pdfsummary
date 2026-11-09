// 요약 서버에 보낼 노트 (쪽 크기 + 원본 쪽 번호 + 획)
import type { Ink, Notebook } from "./model.ts";

export type NotePayload = {
  title: string;
  pages: { w: number; h: number; pdf?: number; strokes: { tool: string; color: string; width: number; pts: number[] }[] }[];
};

export function notePayload(nb: Notebook, ink: Ink): NotePayload {
  return {
    title: nb.title,
    pages: nb.pages.map((p) => ({
      w: p.w,
      h: p.h,
      ...(p.pdf !== undefined ? { pdf: p.pdf } : {}),
      strokes: (ink[p.id] ?? []).map((s) => ({ tool: s.tool, color: s.color, width: s.width, pts: s.pts })),
    })),
  };
}

export function strokeCount(ink: Ink): number {
  return Object.values(ink).reduce((n, ss) => n + ss.length, 0);
}
