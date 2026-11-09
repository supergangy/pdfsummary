// 손글씨 획 → 글자 (기기 안에서). 웹·Expo Go에는 없음.
import { requireOptionalNativeModule } from "expo";

type Native = {
  statusAsync(lang: string): Promise<string>;
  prepareAsync(lang: string): Promise<string>;
  recognizeAsync(strokes: number[][], width: number, lang: string): Promise<string>;
};

const N = requireOptionalNativeModule<Native>("InkRecognizer");

export const inkAvailable = !!N;

/** "available" | "downloadable" | "unavailable" */
export async function inkStatus(lang = "ko"): Promise<string> {
  if (!N) return "unavailable";
  try {
    return await N.statusAsync(lang);
  } catch {
    return "unavailable";
  }
}

export async function prepareInk(lang = "ko"): Promise<string> {
  if (!N) return "unavailable";
  return N.prepareAsync(lang);
}

/** 획들([x, y, 필압, …] 형식)을 읽어 글로. 못 읽으면 "". */
export async function recognizeInk(strokes: { pts: number[]; width: number }[], lang = "ko"): Promise<string> {
  if (!N || !strokes.length) return "";
  const xy = strokes.map((s) => {
    const out: number[] = [];
    for (let i = 0; i < s.pts.length; i += 3) out.push(s.pts[i], s.pts[i + 1]);
    return out;
  });
  const w = strokes.reduce((m, s) => Math.max(m, s.width), 1);
  return (await N.recognizeAsync(xy, w, lang)).trim();
}
