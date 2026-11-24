// 강의 녹음과 필기 잇기: 녹음 중에 쓴 획에는 rec(녹음 id)·rt(녹음 시작부터 몇 ms)가 붙는다.
// 여기는 계산만 (시험: audioSync.test.ts). 녹음·재생은 LectureAudio.tsx

import { hitAlong } from "./geometry.ts";
import type { Ink, Stroke } from "./model.ts";

/** 이 기기에 있는 녹음 하나 (파일은 노트 폴더 안 rec/<id>/audio.<ext>) */
export type Recording = { id: string; start: number; dur: number; ext: string };

/** 필기를 눌렀을 때 들을 곳: 그 자리의 녹음 시각이 있는 획 중 가장 위(나중에 쓴 것) */
export function timedStrokeAt(strokes: Stroke[], x: number, y: number, radius: number): Stroke | null {
  const hit = hitAlong(strokes.filter((s) => s.rec && typeof s.rt === "number"), x, y, x, y, radius);
  return hit.length ? hit[hit.length - 1] : null;
}

/** 그 획을 쓰기 조금 전부터 듣는다 (말을 듣고 받아 적으므로) — 초 */
export function seekFor(s: Stroke, lead = 2): number {
  return Math.max(0, (s.rt ?? 0) / 1000 - lead);
}

/** 재생 위치(ms)까지 쓴 획 중 가장 늦게 쓴 획이 있는 쪽 (쪽 따라가기). 없으면 null */
export function pageAt(ink: Ink, rec: string, ms: number): string | null {
  let best: { page: string; rt: number } | null = null;
  for (const [page, ss] of Object.entries(ink)) {
    for (const s of ss) {
      if (s.rec !== rec || typeof s.rt !== "number" || s.rt > ms) continue;
      if (!best || s.rt > best.rt) best = { page, rt: s.rt };
    }
  }
  return best?.page ?? null;
}

/** 재생 중 흐리게 할 기준을 0.5초 단위로 (쪽 그림을 너무 자주 다시 만들지 않게) */
export function fadeStep(seconds: number): number {
  return Math.floor(seconds * 2) * 500;
}

/** 00:00 / 1:02:03 */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** 녹음 목록 파일 읽기 (모르는 것은 버린다) */
export function parseRecordings(raw: unknown): Recording[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Recording =>
    !!r && typeof r.id === "string" && typeof r.start === "number" && typeof r.dur === "number" && typeof r.ext === "string");
}
