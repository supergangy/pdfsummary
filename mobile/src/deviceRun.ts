// 서버가 만든 일감을 기기 안 AI로 하나씩 처리한다 (화면과 분리해 Node로도 시험할 수 있게).

export type DeviceTask = { id: string; title: string; instructions: string; prompt: string; fallback: string };

export type Generate = (instructions: string, prompt: string, maxTokens: number) => Promise<string>;

export type RunResult = {
  answers: Record<string, string>;
  done: number; // 답을 받은 일감 수
  skipped: number; // 거절·오류로 건너뛴 일감 수
  stopped?: string; // 중간에 멈춘 까닭 (기기 AI를 쓸 수 없게 됨 등)
};

export const MAX_TOKENS = 320;

// 이 오류가 나면 남은 일감도 안 되므로 멈춘다
const FATAL = new Set(["ERR_UNAVAILABLE", "ERR_NOT_READY", "ERR_BACKGROUND", "ERR_LANGUAGE"]);

export function errorCode(e: unknown): string {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" ? c : "ERR_FAILED";
}

export function errorText(e: unknown): string {
  const code = errorCode(e);
  if (code === "ERR_BACKGROUND") return "앱이 화면에서 벗어나 기기 안 AI가 멈췄어요. 앱을 켠 채로 다시 해 주세요.";
  return (e as Error)?.message || "기기 안 AI 오류";
}

export async function runDeviceTasks(
  tasks: DeviceTask[],
  generate: Generate,
  onProgress?: (done: number, total: number, title: string) => void,
  opts: { shouldStop?: () => boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<RunResult> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const res: RunResult = { answers: {}, done: 0, skipped: 0 };
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (opts.shouldStop?.()) {
      res.stopped = "멈췄어요.";
      break;
    }
    onProgress?.(i, tasks.length, t.title);
    let prompt = t.prompt;
    let busyRetry = true;
    for (;;) {
      try {
        const text = await generate(t.instructions, prompt, MAX_TOKENS);
        if (text.trim()) {
          res.answers[t.id] = text;
          res.done++;
        } else {
          res.skipped++;
        }
        break;
      } catch (e) {
        const code = errorCode(e);
        if (code === "ERR_CONTEXT" && prompt !== t.fallback && t.fallback) {
          prompt = t.fallback; // 본문 발췌를 빼고 다시
          continue;
        }
        if (code === "ERR_BUSY" && busyRetry) {
          busyRetry = false;
          await wait(4000);
          continue;
        }
        if (FATAL.has(code)) {
          res.stopped = errorText(e);
          return res;
        }
        res.skipped++; // 거절 등: 이 일감만 건너뛴다
        break;
      }
    }
  }
  if (!res.stopped) onProgress?.(tasks.length, tasks.length, "");
  return res;
}
