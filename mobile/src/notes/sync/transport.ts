// 동기화 서버와 이야기하기 (HTTP). 서버 접속 코드 + (계정 로그인 세션 또는 동기화 코드).
import type { RemoteOp, Transport } from "./engine.ts";
import type { Write } from "./writes.ts";

export class SyncHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
    async push(device, ops) {
      const r = await ok(await f(`${base}/api/sync/push`, { method: "POST", headers: H({ "Content-Type": "application/json" }), body: JSON.stringify({ device, ops }) }));
      return ((await r.json()) as { seqs: number[] }).seqs;
    },
    async pull(since, wait, signal) {
      const r = await ok(await f(`${base}/api/sync/pull?since=${since}&wait=${wait}`, { headers: H(), signal }));
      return (await r.json()) as { ops: RemoteOp[]; last: number; more: boolean };
    },
    async hasBlob(sha) {
      const r = await ok(await f(`${base}/api/sync/blob/${sha}?check=1`, { headers: H() }));
      return !!((await r.json()) as { exists: boolean }).exists;
    },
    async putBlob(sha, data) {
      await ok(await f(`${base}/api/sync/blob/${sha}`, { method: "PUT", headers: H({ "Content-Type": "application/octet-stream" }), body: data as BodyInit }));
    },
    async getBlob(sha) {
      const r = await f(`${base}/api/sync/blob/${sha}`, { headers: H() });
      if (r.status === 404) return null;
      await ok(r);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

/** 새 동기화 공간 만들기 → 동기화 코드 */
export async function createSpace(serverUrl: string, accessCode: string, fetchImpl?: typeof fetch): Promise<string> {
  const base = serverBase(serverUrl);
  const f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  const r = await f(`${base}/api/sync/space`, { method: "POST", headers: { Authorization: `Bearer ${accessCode.trim()}`, "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new SyncHttpError(r.status === 403 ? "서버 접속 코드가 맞지 않아요." : `동기화를 시작하지 못했어요 (${r.status})`, r.status);
  return ((await r.json()) as { code: string }).code;
}

/** 동기화 코드가 맞는지 */
export async function checkSpace(serverUrl: string, accessCode: string, code: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const base = serverBase(serverUrl);
  const f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  const r = await f(`${base}/api/sync/info`, { headers: { Authorization: `Bearer ${accessCode.trim()}`, "X-Sync-Space": code } });
  return r.ok;
}

export type { Write };
