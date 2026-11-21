// 동기화 서버와 이야기하기 (HTTP). 서버 접속 코드 + (계정 로그인 세션 또는 동기화 코드).
import { NO_ANSWER, SHORT_MS, withTimeLimit } from "../net-errors.ts";
import type { RemoteOp, Transport } from "./engine.ts";
import type { Write } from "./writes.ts";

export class SyncHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const PUSH_MS = 60000; // 획이 많이 밀려 있으면 보낼 것이 커서 짧은 요청보다 넉넉히

/** 서버와 한 번 이야기하기. 못 닿으면 영어 오류 대신 쉬운 말로 바꾸고, ms가 있으면 그 안에 대답이 없을 때 끊는다.
 *  일부러 멈춘 것(AbortError)은 그대로 던진다 — 동기화를 끌 때 쓰는 신호다. */
async function talk<T>(ms: number | null, run: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  try {
    if (ms === null) return await run();
    return await withTimeLimit(ms, () => new SyncHttpError(NO_ANSWER, 0), ({ signal }) => run(signal));
  } catch (e) {
    if (e instanceof SyncHttpError || (e as Error)?.name === "AbortError") throw e;
    throw new SyncHttpError("서버에 닿지 않아요. 인터넷 연결과 서버 주소를 확인해 주세요.", 0);
  }
}

/** 어느 공간을 쓰는지: 계정 로그인(세션 토큰) 또는 동기화 코드 */
export type SyncAuth = { session: string } | { code: string };

export function authHeaders(auth: SyncAuth): Record<string, string> {
  return "session" in auth ? { "X-Session": auth.session } : { "X-Sync-Space": auth.code };
}

export function serverBase(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/i, "https://");
}

export function httpTransport(serverUrl: string, accessCode: string, auth: SyncAuth, fetchImpl?: typeof fetch): Transport {
  const base = serverBase(serverUrl);
  const f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  const H = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${accessCode.trim()}`, ...authHeaders(auth), ...extra });
  const ok = async (r: Response) => {
    if (r.ok) return r;
    let msg = `동기화 서버 오류 (${r.status})`;
    try {
      const j = JSON.parse(await r.text());
      if (j?.error) msg = j.error;
    } catch {
      // JSON이 아님
    }
    throw new SyncHttpError(msg, r.status);
  };
  return {
    push(device, ops) {
      return talk(PUSH_MS, async (signal) => {
        const r = await ok(await f(`${base}/api/sync/push`, { method: "POST", headers: H({ "Content-Type": "application/json" }), body: JSON.stringify({ device, ops }), signal }));
        return ((await r.json()) as { seqs: number[] }).seqs;
      });
    },
    // 서버가 새 소식이 올 때까지 일부러 오래 붙들고 있는 요청이라 시간 제한을 두지 않는다
    pull(since, wait, signal) {
      return talk(null, async () => {
        const r = await ok(await f(`${base}/api/sync/pull?since=${since}&wait=${wait}`, { headers: H(), signal }));
        return (await r.json()) as { ops: RemoteOp[]; last: number; more: boolean };
      });
    },
    hasBlob(sha) {
      return talk(SHORT_MS, async (signal) => {
        const r = await ok(await f(`${base}/api/sync/blob/${sha}?check=1`, { headers: H(), signal }));
        return !!((await r.json()) as { exists: boolean }).exists;
      });
    },
    // 원본 PDF는 클 수 있어 올리기·받기에는 시간 제한을 두지 않는다 (오류 글만 쉬운 말로)
    putBlob(sha, data) {
      return talk(null, async () => {
        await ok(await f(`${base}/api/sync/blob/${sha}`, { method: "PUT", headers: H({ "Content-Type": "application/octet-stream" }), body: data as BodyInit }));
      });
    },
    getBlob(sha) {
      return talk(null, async () => {
        const r = await f(`${base}/api/sync/blob/${sha}`, { headers: H() });
        if (r.status === 404) return null;
        await ok(r);
        return new Uint8Array(await r.arrayBuffer());
      });
    },
  };
}

/** 새 동기화 공간 만들기 → 동기화 코드 */
export async function createSpace(serverUrl: string, accessCode: string, fetchImpl?: typeof fetch): Promise<string> {
  const base = serverBase(serverUrl);
  const f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  return talk(SHORT_MS, async (signal) => {
    const r = await f(`${base}/api/sync/space`, { method: "POST", headers: { Authorization: `Bearer ${accessCode.trim()}`, "Content-Type": "application/json" }, body: "{}", signal });
    if (!r.ok) throw new SyncHttpError(r.status === 403 ? "서버 접속 코드가 맞지 않아요." : `동기화를 시작하지 못했어요 (${r.status})`, r.status);
    return ((await r.json()) as { code: string }).code;
  });
}

/** 동기화 코드가 맞는지 */
export async function checkSpace(serverUrl: string, accessCode: string, code: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const base = serverBase(serverUrl);
  const f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  return talk(SHORT_MS, async (signal) => (await f(`${base}/api/sync/info`, { headers: { Authorization: `Bearer ${accessCode.trim()}`, "X-Sync-Space": code }, signal })).ok);
}

export type { Write };
