// 계정: 가입·로그인·로그아웃·비밀번호·로그인된 기기·계정 삭제 (서버의 /api/account/*)
import { Platform } from "react-native";

import { SyncHttpError, serverBase } from "./transport";

export type AccountInfo = { email: string; created: number; devices: number; has_password: boolean; google: boolean };

export type AccountSession = { id: string; device: string; created: number; used: number; current: boolean };

export function deviceName(): string {
  if (Platform.OS === "ios") return (Platform as { isPad?: boolean }).isPad ? "iPad" : "iPhone";
  if (Platform.OS === "android") return "Android";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "브라우저";
  return `웹 (${b})`;
}

export class AccountApi {
  private base: string;
  private access: string;
  private f: typeof fetch;

  constructor(serverUrl: string, accessCode: string, fetchImpl?: typeof fetch) {
    this.base = serverBase(serverUrl);
    this.access = accessCode.trim();
    this.f = fetchImpl ?? ((i: RequestInfo | URL, o?: RequestInit) => fetch(i, o));
  }

  private async call<T>(path: string, body: unknown | null, session?: string): Promise<T> {
    let r: Response;
    try {
      r = await this.f(`${this.base}/api/account/${path}`, {
        method: body === null ? "GET" : "POST",
        headers: { Authorization: `Bearer ${this.access}`, "Content-Type": "application/json", ...(session ? { "X-Session": session } : {}) },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SyncHttpError("서버에 닿지 않아요. 인터넷 연결과 서버 주소를 확인해 주세요.", 0);
    }
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try {
      j = JSON.parse(text);
    } catch {
      // JSON이 아님
    }
    if (!r.ok) {
      // 403 = 서버 접속 코드가 틀림 (계정 문제는 401·409·429)
      const msg = r.status === 403 ? "서버 접속 코드가 맞지 않아요. 설정을 확인해 주세요." : (j.error as string) || `서버 오류 (${r.status})`;
      throw new SyncHttpError(msg, r.status);
    }
    return j as T;
  }

  /** 가입 1단계: 이메일 확인 코드 메일. verify가 false면 이 서버는 확인 없이 가입 (메일 서버 없음) */
  signupStart(email: string) {
    return this.call<{ verify: boolean }>("signup/start", { email });
  }
  /** 가입 2단계 (code: 메일로 받은 확인 코드, linkCode: 계정으로 옮길 동기화 코드) */
  signup(email: string, password: string, opts: { linkCode?: string; code?: string } = {}) {
    return this.call<{ token: string; email: string }>("signup", {
      email,
      password,
      device: deviceName(),
      ...(opts.linkCode ? { link_code: opts.linkCode } : {}),
      ...(opts.code ? { code: opts.code } : {}),
    });
  }
  login(email: string, password: string) {
    return this.call<{ token: string; email: string }>("login", { email, password, device: deviceName() });
  }
  /** Google 로그인 (없으면 가입). linkCode: 지금 쓰는 동기화 코드를 새 계정으로 옮기기 */
  google(idToken: string, linkCode?: string) {
    return this.call<{ token: string; email: string; created: boolean }>("google", { id_token: idToken, device: deviceName(), ...(linkCode ? { link_code: linkCode } : {}) });
  }
  /** 비밀번호 찾기 코드 메일 (가입되지 않은 이메일이어도 같은 답) */
  forgot(email: string) {
    return this.call<{ ok: true }>("forgot", { email });
  }
  /** 메일로 받은 코드로 새 비밀번호 → 로그인 */
  reset(email: string, code: string, password: string) {
    return this.call<{ token: string; email: string }>("reset", { email, code, password, device: deviceName() });
  }
  logout(session: string) {
    return this.call<{ ok: true }>("logout", {}, session);
  }
  me(session: string) {
    return this.call<AccountInfo>("me", null, session);
  }
  changePassword(session: string, old: string, next: string) {
    return this.call<{ ok: true }>("password", { old, new: next }, session);
  }
  deleteAccount(session: string, password: string) {
    return this.call<{ ok: true }>("delete", { password }, session);
  }
  async sessions(session: string): Promise<AccountSession[]> {
    return (await this.call<{ sessions: AccountSession[] }>("sessions", null, session)).sessions;
  }
  revoke(session: string, id: string) {
    return this.call<{ ok: true }>("sessions/revoke", { id }, session);
  }
}
