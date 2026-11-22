// 나만의 노트의 'AI 설명' (프리미엄): 서버(/api/ai/explain)에 칠한 항목을 보내 Claude의 설명·표·그래프·순서 그림을 받는다.
// 로그인한 계정의 요금제(무료·프리미엄)마다 한 달에 쓸 수 있는 횟수가 다르다 (서버 accounts.py).
import type { Explain } from "./myNote";
import type { StudySection } from "./studyNote";

export type AiPlan = { plan: string; label: string; used: number; limit: number };

/** AI 설명을 쓸 수 있는지: 서버 연결·로그인·서버의 AI 설정·요금제 */
export type AiAccess =
  | { ok: true; plan: AiPlan }
  | { ok: false; why: "no-server" | "no-login" | "no-ai" | "offline"; message: string };

export type AiConn = { serverUrl: string; accessCode: string; session: string };

export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const base = (u: string) => u.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/i, "https://");

async function call<T>(c: AiConn, path: string, body: unknown | null, f: typeof fetch): Promise<T> {
  let r: Response;
  try {
    r = await f(`${base(c.serverUrl)}${path}`, {
      method: body === null ? "GET" : "POST",
      headers: { Authorization: `Bearer ${c.accessCode.trim()}`, "Content-Type": "application/json", ...(c.session ? { "X-Session": c.session } : {}) },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AiError("서버에 닿지 않아요. 인터넷 연결을 확인해 주세요.", 0);
  }
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(await r.text());
  } catch {
    // JSON이 아님
  }
  if (!r.ok) {
    const msg =
      r.status === 403 ? "서버 접속 코드가 맞지 않아요. 설정을 확인해 주세요." :
      r.status === 401 ? "로그인이 끝났어요. 동기화에서 다시 로그인해 주세요." :
      (j.error as string) || `서버 오류 (${r.status})`;
    throw new AiError(msg, r.status);
  }
  return j as T;
}

/** 지금 AI 설명을 쓸 수 있는지와 요금제·남은 횟수 */
export async function aiAccess(c: AiConn | null, f: typeof fetch = fetch): Promise<AiAccess> {
  if (!c || !c.serverUrl.trim() || !c.accessCode.trim()) {
    return { ok: false, why: "no-server", message: "AI 설명은 프리미엄 기능이에요. 설정에서 서버를 연결하고 동기화에서 로그인하면 쓸 수 있어요." };
  }
  if (!c.session) return { ok: false, why: "no-login", message: "AI 설명은 로그인한 계정으로 쓸 수 있어요. 동기화에서 로그인해 주세요." };
  try {
    // ai_explain: 서버에 Claude나 Gemini 키가 있는지 (예전 서버는 server_key만 알려 준다)
    const st = await call<{ server_key?: boolean; ai_explain?: boolean }>(c, "/api/state", null, f);
    if (!(st.ai_explain ?? st.server_key)) return { ok: false, why: "no-ai", message: "이 서버는 AI가 꺼져 있어요 (서버에 AI 키가 없어요)." };
    return { ok: true, plan: await call<AiPlan>(c, "/api/account/ai", null, f) };
  } catch (e) {
    const err = e as AiError;
    if (err.status === 401) return { ok: false, why: "no-login", message: err.message };
    return { ok: false, why: "offline", message: err.message };
  }
}

/** 남은 횟수 글 ("프리미엄 · 이번 달 12/100번") */
export function planText(p: AiPlan): string {
  return `${p.label} · 이번 달 ${p.used}/${p.limit}번 썼어요`;
}

/** 서버가 한 번에 받는 항목 수 (pdfsummary/explain.py의 MAX_ITEMS와 같게) */
export const AI_MAX_ITEMS = 60;

/** 정리 노트에 보내는 쪽 하나: 교재 쪽 번호, 그 쪽 글, 그 쪽의 표시들 */
export type StudyPage = { page: number; text: string; marks: { id: string; tag: string; text: string; sentence: string; memo: string }[] };

/** 서버가 한 번에 받는 쪽 수와 쪽마다 글 길이 (pdfsummary/studynote.py와 같게) */
export const STUDY_MAX_PAGES = 80;
export const STUDY_PAGE_TEXT = 6000;

/** AI 정리 노트: 표시한 쪽의 교재 글로 '핵심 정리' 섹션들을 받는다 (한 번 만들기가 횟수 하나) */
export async function requestStudyNote(c: AiConn, book: string, pages: StudyPage[], f: typeof fetch = fetch): Promise<{ sections: StudySection[]; plan: AiPlan }> {
  const body = { book, pages: pages.slice(0, STUDY_MAX_PAGES).map((p) => ({ ...p, text: p.text.slice(0, STUDY_PAGE_TEXT) })) };
  const r = await call<{ sections: StudySection[]; ai: AiPlan }>(c, "/api/ai/studynote", body, f);
  return { sections: Array.isArray(r.sections) ? r.sections : [], plan: r.ai };
}

/** 항목들을 보내 설명을 받는다. 설명이 필요 없다고 본 항목은 답에 없다 */
export async function requestExplain(
  c: AiConn,
  book: string,
  items: { id: string; tag: string; text: string; sentence: string; memo: string }[],
  f: typeof fetch = fetch,
): Promise<{ items: (Explain & { id: string })[]; plan: AiPlan }> {
  const r = await call<{ items: (Explain & { id: string })[]; ai: AiPlan }>(c, "/api/ai/explain", { book, items: items.slice(0, AI_MAX_ITEMS) }, f);
  return { items: Array.isArray(r.items) ? r.items : [], plan: r.ai };
}
