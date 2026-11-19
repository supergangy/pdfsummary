// 앱 전체의 동기화 켜고 끄기·상태. 계정 로그인 또는 동기화 코드로.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Settings } from "../../api";
import { loadSettings } from "../../platform/storage";
import type { Fs } from "../store";
import { AccountApi, type AccountSession } from "./account";
import { loadSyncConfig, saveSyncConfig } from "./config";
import { SyncEngine, emptyState, type SyncStatus } from "./engine";
import type { SyncedStore } from "./syncedStore";
import { checkSpace, createSpace, httpTransport, type SyncAuth } from "./transport";

export type SyncAccount = { email: string; expired: boolean };

export type SyncApi = {
  /** 동기화가 켜져 있는지 (코드 또는 계정) */
  on: boolean;
  code: string | null;
  account: SyncAccount | null;
  status: SyncStatus;
  server: Settings | null;
  reload: () => Promise<void>; // 서버 설정을 다시 읽기
  // 코드로
  start: (code?: string) => Promise<void>; // code 없으면 새 공간 만들기
  stop: () => Promise<void>;
  // 계정으로
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  linkAccount: (email: string, password: string) => Promise<void>; // 지금 쓰는 동기화 코드를 새 계정으로 옮기기
  logout: () => Promise<void>;
  forgot: (email: string) => Promise<void>; // 비밀번호 찾기 코드 메일
  resetPassword: (email: string, code: string, password: string) => Promise<void>; // 코드로 새 비밀번호 → 로그인
  changePassword: (old: string, next: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  sessions: () => Promise<AccountSession[]>;
  revoke: (id: string) => Promise<void>;
};

const OFF: SyncStatus = { state: "off", waiting: 0 };

export function useSync(store: SyncedStore, fs: Fs): SyncApi {
  const [code, setCode] = useState<string | null>(null);
  const [account, setAccount] = useState<SyncAccount | null>(null);
  const [status, setStatus] = useState<SyncStatus>(OFF);
  const [server, setServer] = useState<Settings | null>(null);
  const engine = useRef<SyncEngine | null>(null);
  const token = useRef<string>("");
  const expired = useRef(false);

  const needServer = async () => {
    const s = await loadSettings();
    setServer(s);
    if (!s.serverUrl || !s.accessCode) throw new Error("먼저 설정에서 서버 주소와 접속 코드를 넣어 주세요.");
    return s;
  };

  /** 로그인 세션이 끝남(다른 기기에서 로그아웃시킴·비밀번호 바뀜): 멈추되, 이 기기에서 고친 것은 계속 모아 둔다 */
  const expire = useCallback((eng: SyncEngine, email: string) => {
    if (expired.current || engine.current !== eng) return;
    expired.current = true;
    eng.stop(); // store.engine은 그대로 → 다시 로그인하면 모아 둔 것을 이어서 보낸다
    setAccount({ email, expired: true });
    setStatus({ state: "offline", waiting: eng.state.outbox.length, error: "로그인이 끝났어요. 다시 로그인해 주세요." });
  }, []);

  /** resume: 이 기기의 동기화 기록을 이어서 / 아니면 서버 내용을 먼저 받고 이 기기에만 있는 것을 올린다 */
  const attach = useCallback(async (s: Settings, auth: SyncAuth, resume: boolean, email?: string) => {
    engine.current?.stop();
    expired.current = false;
    const saved = resume ? await SyncEngine.loadState(fs) : null;
    if (!saved) await fs.remove("sync"); // 예전 동기화 기록은 버리고 새로
    const onStatus = (st: SyncStatus) => {
      if (expired.current) return;
      if (email && st.httpStatus === 401) return expire(eng, email);
      setStatus(st);
    };
    const eng: SyncEngine = new SyncEngine(fs, store, httpTransport(s.serverUrl, s.accessCode, auth), saved ?? emptyState(), onStatus);
    store.engine = eng;
    engine.current = eng;
    if (!saved) {
      setStatus({ state: "syncing", waiting: 0 });
      try {
        await eng.join(() => store.snapshotWrites());
      } catch (e) {
        if (engine.current === eng) {
          engine.current = null;
          store.engine = null;
          setStatus(OFF);
        }
        throw e;
      }
    }
    eng.start();
  }, [expire, fs, store]);

  // 앱을 켤 때: 켜 두었던 동기화를 이어서
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setServer(s);
      const cfg = await loadSyncConfig();
      if (!s.serverUrl || !s.accessCode || !cfg) return;
      if (cfg.token && cfg.email) {
        token.current = cfg.token;
        setAccount({ email: cfg.email, expired: false });
        await attach(s, { session: cfg.token }, true, cfg.email);
      } else if (cfg.code) {
        setCode(cfg.code);
        await attach(s, { code: cfg.code }, true);
      }
    })().catch(() => undefined);
    return () => engine.current?.stop();
  }, [attach]);

  const off = useCallback(async () => {
    engine.current?.stop();
    engine.current = null;
    store.engine = null;
    token.current = "";
    expired.current = false;
    await saveSyncConfig(null);
    await fs.remove("sync");
    setCode(null);
    setAccount(null);
    setStatus(OFF);
  }, [fs, store]);

  // ── 코드로 ──
  const start = useCallback(async (given?: string) => {
    const s = await needServer();
    let c = given?.trim().toUpperCase();
    if (c) {
      if (!(await checkSpace(s.serverUrl, s.accessCode, c))) throw new Error("동기화 코드가 맞지 않아요. 다른 기기에 보이는 코드를 그대로 넣어 주세요.");
    } else {
      c = await createSpace(s.serverUrl, s.accessCode);
    }
    await attach(s, { code: c }, false);
    await saveSyncConfig({ code: c });
    token.current = "";
    setAccount(null);
    setCode(c);
  }, [attach]);

  // ── 계정으로 ──
  const signedIn = useCallback(async (s: Settings, r: { token: string; email: string }, resume: boolean) => {
    await attach(s, { session: r.token }, resume, r.email);
    await saveSyncConfig({ token: r.token, email: r.email });
    token.current = r.token;
    setCode(null);
    setAccount({ email: r.email, expired: false });
  }, [attach]);

  /** 로그인 성공 뒤: 같은 계정으로 다시 로그인(세션이 끝났던 경우)이면 모아 둔 것을 이어서 보낸다 */
  const afterLogin = useCallback(async (s: Settings, r: { token: string; email: string }) => {
    const cfg = await loadSyncConfig();
    const same = !!cfg?.email && cfg.email === r.email && !cfg.code;
    await signedIn(s, r, same);
  }, [signedIn]);

  const login = useCallback(async (email: string, password: string) => {
    const s = await needServer();
    await afterLogin(s, await new AccountApi(s.serverUrl, s.accessCode).login(email, password));
  }, [afterLogin]);

  const forgot = useCallback(async (email: string) => {
    const s = await needServer();
    await new AccountApi(s.serverUrl, s.accessCode).forgot(email);
  }, []);

  const resetPassword = useCallback(async (email: string, code: string, password: string) => {
    const s = await needServer();
    await afterLogin(s, await new AccountApi(s.serverUrl, s.accessCode).reset(email, code, password));
  }, [afterLogin]);

  const signup = useCallback(async (email: string, password: string) => {
    const s = await needServer();
    const r = await new AccountApi(s.serverUrl, s.accessCode).signup(email, password);
    await signedIn(s, r, false);
  }, [signedIn]);

  const linkAccount = useCallback(async (email: string, password: string) => {
    const s = await needServer();
    if (!code) throw new Error("동기화 코드로 쓰고 있을 때만 옮길 수 있어요.");
    const r = await new AccountApi(s.serverUrl, s.accessCode).signup(email, password, code);
    await signedIn(s, r, true); // 같은 공간이라 동기화 기록을 그대로 잇는다
  }, [code, signedIn]);

  const api = useCallback(async () => {
    const s = await needServer();
    if (!token.current) throw new Error("로그인되어 있지 않아요.");
    return new AccountApi(s.serverUrl, s.accessCode);
  }, []);

  const logout = useCallback(async () => {
    const t = token.current;
    if (t) await (await api()).logout(t).catch(() => undefined);
    await off();
  }, [api, off]);

  const deleteAccount = useCallback(async (password: string) => {
    await (await api()).deleteAccount(token.current, password);
    await off();
  }, [api, off]);

  const changePassword = useCallback(async (old: string, next: string) => {
    await (await api()).changePassword(token.current, old, next);
  }, [api]);

  const sessions = useCallback(async () => (await api()).sessions(token.current), [api]);
  const revoke = useCallback(async (id: string) => {
    await (await api()).revoke(token.current, id);
  }, [api]);

  const reload = useCallback(async () => setServer(await loadSettings()), []);

  return {
    on: !!code || !!account,
    code,
    account,
    status,
    server,
    reload,
    start,
    stop: off,
    signup,
    login,
    linkAccount,
    logout,
    forgot,
    resetPassword,
    changePassword,
    deleteAccount,
    sessions,
    revoke,
  };
}
