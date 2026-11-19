// 앱 전체의 동기화 켜고 끄기·상태
import { useCallback, useEffect, useRef, useState } from "react";

import type { Settings } from "../../api";
import { loadSettings } from "../../platform/storage";
import type { Fs } from "../store";
import { loadSyncConfig, saveSyncConfig } from "./config";
import { SyncEngine, emptyState, type SyncStatus } from "./engine";
import type { SyncedStore } from "./syncedStore";
import { checkSpace, createSpace, httpTransport } from "./transport";

export type SyncApi = {
  code: string | null;
  status: SyncStatus;
  start: (code?: string) => Promise<void>; // code 없으면 새 공간 만들기
  stop: () => Promise<void>;
  server: Settings | null;
  reload: () => Promise<void>; // 서버 설정을 다시 읽기
};

export function useSync(store: SyncedStore, fs: Fs): SyncApi {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: "off", waiting: 0 });
  const [server, setServer] = useState<Settings | null>(null);
  const engine = useRef<SyncEngine | null>(null);

  const attach = useCallback(async (s: Settings, c: string, fresh: boolean) => {
    engine.current?.stop();
    const saved = fresh ? null : await SyncEngine.loadState(fs);
    const eng = new SyncEngine(fs, store, httpTransport(s.serverUrl, s.accessCode, c), saved ?? emptyState(), setStatus);
    store.engine = eng;
    engine.current = eng;
    if (!saved) {
      // 이 기기에 있던 노트를 모두 올린다 (다른 기기에서 받은 노트와 합쳐짐)
      const snap = await store.snapshotWrites();
      await eng.record(snap.writes, snap.blobs);
    }
    eng.start();
    setCode(c);
  }, [fs, store]);

  // 앱을 켤 때: 켜 두었던 동기화를 이어서
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      setServer(s);
      const cfg = await loadSyncConfig();
      if (cfg?.code && s.serverUrl && s.accessCode) await attach(s, cfg.code, false);
    })().catch(() => undefined);
    return () => engine.current?.stop();
  }, [attach]);

  const start = useCallback(async (given?: string) => {
    const s = await loadSettings();
    setServer(s);
    if (!s.serverUrl || !s.accessCode) throw new Error("먼저 설정에서 서버 주소와 접속 코드를 넣어 주세요.");
    let c = given?.trim().toUpperCase();
    if (c) {
      if (!(await checkSpace(s.serverUrl, s.accessCode, c))) throw new Error("동기화 코드가 맞지 않아요. 다른 기기에 보이는 코드를 그대로 넣어 주세요.");
    } else {
      c = await createSpace(s.serverUrl, s.accessCode);
    }
    await saveSyncConfig({ code: c });
    await fs.remove("sync"); // 예전 동기화 기록은 버리고 새로
    await attach(s, c, true);
  }, [attach, fs]);

  const stop = useCallback(async () => {
    engine.current?.stop();
    engine.current = null;
    store.engine = null;
    await saveSyncConfig(null);
    await fs.remove("sync");
    setCode(null);
    setStatus({ state: "off", waiting: 0 });
  }, [fs, store]);

  const reload = useCallback(async () => setServer(await loadSettings()), []);

  return { code, status, start, stop, server, reload };
}
