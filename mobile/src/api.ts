// 필기 요약 서버와 이야기하는 부분 (화면과 분리해서 Node로도 시험할 수 있게).
import type { DeviceTask } from "./deviceRun.ts";

export type Settings = {
  serverUrl: string; // 예: https://pdfsummary.example.com
  accessCode: string; // 서버의 PDFSUMMARY_ACCESS_CODE
  apiKey: string; // 내 Claude API 키 (선택). 요청마다 보내고 서버에는 저장되지 않음
};

export type ServerState = {
  server: boolean;
  version: string;
  server_key: boolean; // 서버에 운영자 키가 있어 내 키 없이도 AI를 쓸 수 있는지
  max_upload_mb: number;
  keep_minutes: number;
};

export type UploadInfo = { id: string; name: string; pages: number; title: string; has_toc: boolean };

export type ColorInfo = {
  filter: string; // --color에 넣는 값 (#RRGGBB 또는 색 이름)
  code: string | null;
  family: string; // yellow, pink …
  name: string; // 노랑, 분홍 …
  css: string;
  count: number;
  pages: number[];
  sample: string;
};

export type RunOptions = {
  style: "booklet" | "list"; // booklet = AI 핵심 정리 요약집
  scope: "focus" | "all";
  group_by: "chapter" | "page" | "color";
  context: "ai" | "sentence" | "none" | "device"; // device = 태블릿·폰의 기기 안 AI가 개요·설명을 씀
  handwriting: "auto" | "image" | "both";
  colors: string[]; // 비우면 전부
  labels: Record<string, string>; // 색 계열 → 의미
  title?: string;
  pages?: string;
};

export type JobState = {
  status: "running" | "done" | "error";
  log: string[];
  progress: Record<string, [number, number]>;
  error: string;
  summary: string;
};

export type ResultFile = "요약.html" | "요약.md" | "요약.json" | "요약.zip";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

export function authHeaders(s: Settings, withKey = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${s.accessCode.trim()}` };
  if (withKey && s.apiKey.trim()) h["X-Anthropic-Key"] = s.apiKey.trim();
  return h;
}

export function uploadUrl(s: Settings, fileName: string): string {
  return `${normalizeUrl(s.serverUrl)}/api/upload?name=${encodeURIComponent(fileName)}`;
}

export function resultUrl(s: Settings, job: string, file: ResultFile): string {
  return `${normalizeUrl(s.serverUrl)}/r/${job}/${encodeURIComponent(file)}`;
}

/** 서버의 오류 응답({error}) 또는 연결 실패를 사람이 읽을 말로. */
export function explain(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (j && typeof j.error === "string") return j.error;
  } catch {
    // JSON이 아님
  }
  if (status === 403) return "접속 코드가 맞지 않아요. 설정에서 확인해 주세요.";
  if (status === 404) return "서버 주소가 맞는지 확인해 주세요.";
  if (status === 413) return "파일이 너무 커요.";
  if (status >= 500) return `서버 오류 (${status})`;
  return `요청 실패 (${status || "연결 안 됨"})`;
}

export function parseUpload(status: number, body: string): UploadInfo {
  if (status !== 200) throw new ApiError(explain(status, body), status);
  return JSON.parse(body) as UploadInfo;
}

type FetchLike = typeof fetch;

export class Client {
  private s: Settings;
  private fetchImpl: FetchLike;
  constructor(s: Settings, fetchImpl?: FetchLike) {
    this.s = s;
    // 브라우저의 fetch는 window 밖에서(객체 메서드로) 부르면 'Illegal invocation'이 나므로 감싸서 부른다
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async req<T>(path: string, init: RequestInit & { withKey?: boolean } = {}): Promise<T> {
    if (!this.s.serverUrl.trim()) throw new ApiError("설정에서 서버 주소를 넣어 주세요.");
    let r: Response;
    try {
      r = await this.fetchImpl(normalizeUrl(this.s.serverUrl) + path, {
        ...init,
        headers: { "Content-Type": "application/json", ...authHeaders(this.s, init.withKey), ...(init.headers || {}) },
      });
    } catch {
      throw new ApiError("서버에 연결할 수 없어요. 인터넷과 서버 주소를 확인해 주세요.");
    }
    const text = await r.text();
    if (!r.ok) throw new ApiError(explain(r.status, text), r.status);
    return JSON.parse(text) as T;
  }

  state() {
    return this.req<ServerState>("/api/state");
  }

  colors(file: string, original?: string | null, pages?: string) {
    return this.req<{ colors: ColorInfo[] }>("/api/colors", {
      method: "POST",
      body: JSON.stringify({ file, original: original || null, pages: pages || "" }),
    }).then((r) => r.colors);
  }

  run(file: string, original: string | null, options: RunOptions) {
    return this.req<{ job: string }>("/api/run", {
      method: "POST",
      withKey: true,
      body: JSON.stringify({ file, original, options }),
    }).then((r) => r.job);
  }

  job(id: string) {
    return this.req<JobState>(`/api/job/${id}`);
  }

  /** 기기 안 AI에게 맡길 일감 (context: "device"로 만든 작업만). */
  deviceTasks(job: string) {
    return this.req<{ tasks: DeviceTask[] }>(`/api/job/${job}/device-tasks`).then((r) => r.tasks);
  }

  /** 기기 안 AI가 쓴 답을 보내면 서버가 요약에 넣고 다시 그린다. */
  deviceAnswers(job: string, answers: Record<string, string>) {
    return this.req<{ ok: boolean; overviews: number; notes: number }>(`/api/job/${job}/device-answers`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  }

  async resultText(job: string, file: ResultFile = "요약.html"): Promise<string> {
    const r = await this.fetchImpl(resultUrl(this.s, job, file), { headers: authHeaders(this.s) });
    const text = await r.text();
    if (!r.ok) throw new ApiError(explain(r.status, text), r.status);
    return text;
  }
}

/** 형광펜 색 고르기 → 서버에 보낼 거르기 값. 전부 켜져 있으면 거르지 않는다. */
export function colorFilters(colors: (ColorInfo & { on: boolean })[]): string[] {
  if (colors.every((c) => c.on)) return [];
  return colors.filter((c) => c.on).map((c) => c.filter);
}

/** 진행 기록 마지막 줄에서 앞의 기호를 떼어 화면에 보여 줄 문장으로. */
export function lastLine(log: string[]): string {
  const l = [...log].reverse().find((x) => x.trim());
  return l ? l.trim().replace(/^[^\p{L}\p{N}]+/u, "") : "만드는 중…";
}

export function isPdf(name: string, mimeType?: string | null): boolean {
  return /\.pdf$/i.test(name) || mimeType === "application/pdf";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
