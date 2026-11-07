// 기기 안 AI: 아이패드·아이폰은 Apple 기기 안 AI(Foundation Models), 안드로이드는 ML Kit(Gemini Nano).
// 네이티브 모듈이 없는 곳(웹, Expo Go, 오래된 앱)에서는 '없음'으로 답한다.
import { requireOptionalNativeModule } from "expo";

export type DeviceAiStatus = {
  status: "available" | "downloadable" | "downloading" | "not-ready" | "unavailable";
  reason?: "device" | "disabled" | "language" | "os" | "unknown" | "missing";
  engine?: "apple" | "gemini-nano";
};

type Native = {
  getStatusAsync(): Promise<string>;
  prepareAsync(): Promise<string>;
  generateAsync(instructions: string, prompt: string, maxTokens: number): Promise<string>;
  addListener(event: "onDownloadProgress", fn: (e: { ratio: number | null }) => void): { remove(): void };
};

const N = requireOptionalNativeModule<Native>("DeviceAi");

function parse(s: string): DeviceAiStatus {
  try {
    return JSON.parse(s) as DeviceAiStatus;
  } catch {
    return { status: "unavailable", reason: "unknown" };
  }
}

export async function getStatus(): Promise<DeviceAiStatus> {
  if (!N) return { status: "unavailable", reason: "missing" };
  try {
    return parse(await N.getStatusAsync());
  } catch {
    return { status: "unavailable", reason: "unknown" };
  }
}

/** 모델이 기기에 없으면 받는다 (안드로이드). 애플은 시스템이 알아서 받는다. */
export async function prepare(onProgress?: (ratio: number | null) => void): Promise<DeviceAiStatus> {
  if (!N) return { status: "unavailable", reason: "missing" };
  const sub = onProgress ? N.addListener("onDownloadProgress", (e) => onProgress(e.ratio)) : null;
  try {
    return parse(await N.prepareAsync());
  } finally {
    sub?.remove();
  }
}

export function generate(instructions: string, prompt: string, maxTokens: number): Promise<string> {
  if (!N) return Promise.reject(Object.assign(new Error("기기 안 AI가 없어요."), { code: "ERR_UNAVAILABLE" }));
  return N.generateAsync(instructions, prompt, maxTokens);
}
