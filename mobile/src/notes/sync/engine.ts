// 실시간 동기화 엔진.
//  - 이 기기에서 바뀐 것(쓰기)을 '보낼 함'에 넣고 서버로 보낸다 (인터넷이 끊기면 모아 두었다가 다시).
//  - 서버에서 차례 번호(seq)가 붙은 작업을 차례대로 받아 적용한다 (오래 기다리기로 거의 바로).
//  - 값 칸마다 마지막으로 적용한 번호를 기억해, 더 늦은 번호의 쓰기만 이긴다.
//    아직 서버에 닿지 않은 내 쓰기가 있는 칸은 남의 쓰기로 덮지 않는다 (내 쓰기가 더 늦은 번호를 받게 되므로).
//  → 모든 기기가 같은 작업을 같은 규칙으로 적용해 결국 같은 내용이 된다.
import { newId } from "../model.ts";
import type { Fs } from "../store.ts";
import { wkey, type Write } from "./writes.ts";

export type OutOp = { cid: string; nb?: string; w: Write[]; blobs?: { sha: string; nb: string }[] };
export type RemoteOp = { seq: number; cid: string; device: string; nb?: string; w: Write[] };

export interface Transport {
  push(device: string, ops: { cid: string; nb?: string; w: Write[] }[]): Promise<number[]>;
  pull(since: number, wait: number, signal?: AbortSignal): Promise<{ ops: RemoteOp[]; last: number; more: boolean }>;
  hasBlob(sha: string): Promise<boolean>;
  putBlob(sha: string, data: Uint8Array): Promise<void>;
  getBlob(sha: string): Promise<Uint8Array | null>;
}

/** 엔진이 다른 기기의 쓰기를 기기 안 노트에 적용할 곳 (SyncedStore) */
export interface SyncTarget {
  applyRemote(writes: Write[]): Promise<{ pdfNeeded: { nb: string; sha: string }[] }>;
  pdfBytes(nb: string): Promise<Uint8Array | null>;
  putPdf(nb: string, sha: string, data: Uint8Array): Promise<void>;
}

export type SyncState = {
  v: 1;
  device: string;
  last: number; // 받은 마지막 차례 번호
  seqs: Record<string, number>; // 값 칸 → 마지막으로 적용한 차례 번호
  pending: Record<string, number>; // 값 칸 → 아직 서버에 닿지 않은 내 쓰기 수
  outbox: OutOp[];
  gone: Record<string, true>; // 지운 노트 (뒤늦게 온 쓰기는 버림)
  pdfSha: Record<string, string>; // 노트 → 원본 PDF 내용 해시
  missingPdf: Record<string, string>; // 받아야 할 원본 PDF (노트 → 해시)
};

export type SyncStatus = { state: "off" | "syncing" | "synced" | "offline"; waiting: number; lastOk?: number; error?: string };

const STATE_PATH = "sync/state.json";
const MAX_WRITES_PER_OP = 400;

export function emptyState(): SyncState {
  return { v: 1, device: newId(), last: 0, seqs: {}, pending: {}, outbox: [], gone: {}, pdfSha: {}, missingPdf: {} };
}

export class SyncEngine {
  state: SyncState;
  status: SyncStatus = { state: "syncing", waiting: 0 };
  private fs: Fs;
  private target: SyncTarget;
  private transport: Transport;
  private onStatus?: (s: SyncStatus) => void;
  private chain: Promise<unknown> = Promise.resolve();
  private running = false;
  private wake: (() => void) | null = null;
  private abort: AbortController | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(fs: Fs, target: SyncTarget, transport: Transport, state: SyncState, onStatus?: (s: SyncStatus) => void) {
    this.fs = fs;
    this.target = target;
    this.transport = transport;
    this.state = state;
    this.onStatus = onStatus;
  }

  static async loadState(fs: Fs): Promise<SyncState | null> {
    const t = await fs.readText(STATE_PATH);
    if (!t) return null;
    try {
      const s = JSON.parse(t) as SyncState;
      return s && s.v === 1 ? { ...emptyState(), ...s } : null;
    } catch {
      return null;
    }
  }

  /** 엔진 안의 일은 한 번에 하나씩 (상태가 엉키지 않게) */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    await this.fs.writeText(STATE_PATH, JSON.stringify(this.state));
  }

  private persistSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.lock(() => this.persist());
    }, 400);
  }

  private setStatus(p: Partial<SyncStatus>) {
    this.status = { ...this.status, waiting: this.state.outbox.length, ...p };
    this.onStatus?.(this.status);
  }

  /** 이 기기에서 바뀐 것을 보낼 함에 넣는다 (바로 저장해서, 앱이 꺼져도 다음에 보낸다). */
  record(writes: Write[], blobs: { sha: string; nb: string }[] = []): Promise<void> {
    return this.lock(async () => {
      const ws = writes.filter((w) => !(w.t !== "folder" && this.state.gone[w.nb]));
      if (!ws.length) return;
      for (let i = 0; i < ws.length; i += MAX_WRITES_PER_OP) {
        const part = ws.slice(i, i + MAX_WRITES_PER_OP);
        const nb = part.find((w) => w.t !== "folder") as { nb: string } | undefined;
        this.state.outbox.push({ cid: newId(), ...(nb ? { nb: nb.nb } : {}), w: part, ...(i === 0 && blobs.length ? { blobs } : {}) });
        for (const w of part) this.state.pending[wkey(w)] = (this.state.pending[wkey(w)] ?? 0) + 1;
      }
      for (const w of ws) if (w.t === "nb" && w.v === null) this.state.gone[w.nb] = true;
      await this.persist();
      this.setStatus({ state: "syncing" });
      this.wake?.();
    });
  }

  /** 보낼 함을 서버로 (원본 PDF가 딸린 작업이면 PDF부터 올린다). 보낸 작업 수. */
  async pushOnce(max = 50): Promise<number> {
    const batch = await this.lock(async () => this.state.outbox.slice(0, max));
    if (!batch.length) return 0;
    // 네트워크를 기다리는 동안에도 이 기기의 저장은 막히지 않게 잠그지 않는다
    for (const op of batch) {
      for (const b of op.blobs ?? []) {
        if (await this.transport.hasBlob(b.sha)) continue;
        const data = await this.target.pdfBytes(b.nb);
        if (data) await this.transport.putBlob(b.sha, data);
      }
    }
    await this.transport.push(this.state.device, batch.map(({ cid, nb, w }) => ({ cid, ...(nb ? { nb } : {}), w })));
    await this.lock(async () => {
      const sent = new Set(batch.map((o) => o.cid));
      this.state.outbox = this.state.outbox.filter((o) => !sent.has(o.cid));
      await this.persist();
    });
    return batch.length;
  }

  /** 서버의 새 작업을 받아 적용한다. 받은 작업 수. */
  async pullOnce(wait = 0, signal?: AbortSignal): Promise<number> {
    const since = this.state.last;
    const r = await this.transport.pull(since, wait, signal);
    if (!r.ops.length) return 0;
    await this.lock(() => this.apply(r.ops, r.last));
    return r.ops.length + (r.more ? await this.pullOnce(0, signal) : 0);
  }

  private async apply(ops: RemoteOp[], last: number): Promise<void> {
    const st = this.state;
    const effective: Write[] = [];
    for (const op of ops) {
      if (op.seq <= st.last) continue; // 이미 받은 것
      const mine = op.device === st.device;
      for (const w of op.w ?? []) {
        const k = wkey(w);
        if (mine) {
          // 내 쓰기가 서버에 닿아 번호를 받았다 (내용은 이미 이 기기에 있음)
          if (st.pending[k]) st.pending[k] -= 1;
          if (!st.pending[k]) delete st.pending[k];
          st.seqs[k] = op.seq;
          continue;
        }
        if (st.pending[k]) continue; // 내 쓰기가 아직 가는 중 → 내 쓰기가 더 늦은 번호를 받아 이긴다
        if (op.seq <= (st.seqs[k] ?? 0)) continue;
        if (w.t !== "folder" && st.gone[w.nb]) continue;
        st.seqs[k] = op.seq;
        if (w.t === "nb" && w.v === null) st.gone[w.nb] = true;
        effective.push(w);
      }
      st.last = op.seq;
    }
    st.last = Math.max(st.last, last);
    if (effective.length) {
      const { pdfNeeded } = await this.target.applyRemote(effective);
      for (const p of pdfNeeded) st.missingPdf[p.nb] = p.sha;
    }
    this.persistSoon();
  }

  /** 받아야 할 원본 PDF 받기 */
  async fetchMissingPdfs(): Promise<void> {
    for (const [nb, sha] of Object.entries(this.state.missingPdf)) {
      const data = await this.transport.getBlob(sha);
      if (!data) continue; // 아직 올라오지 않음 → 다음에
      await this.target.putPdf(nb, sha, data);
      await this.lock(async () => {
        delete this.state.missingPdf[nb];
        this.state.pdfSha[nb] = sha;
        await this.persist();
      });
    }
  }

  /** 시험용: 보내기와 받기를 한 번씩 (보낼 것이 없어질 때까지) */
  async syncOnce(): Promise<void> {
    while ((await this.pushOnce()) > 0);
    await this.pullOnce(0);
    await this.fetchMissingPdfs();
  }

  // ── 백그라운드로 계속 ──
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pushLoop();
    void this.pullLoop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.wake?.();
    this.setStatus({ state: "off" });
  }

  /** 보낼 것이 생겼다 */
  kick(): void {
    this.wake?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(() => {
        this.wake = null;
        r();
      }, ms);
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        r();
      };
    });
  }

  private async pushLoop() {
    let backoff = 1000;
    while (this.running) {
      try {
        const n = await this.pushOnce();
        backoff = 1000;
        if (n) continue;
        this.setStatus({ state: "synced", lastOk: Date.now(), error: undefined });
        await this.sleep(30000); // 새 쓰기가 생기면 kick으로 바로 깬다
      } catch (e) {
        this.setStatus({ state: "offline", error: (e as Error).message });
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private async pullLoop() {
    let backoff = 1000;
    while (this.running) {
      try {
        this.abort = new AbortController();
        await this.pullOnce(25, this.abort.signal);
        await this.fetchMissingPdfs();
        backoff = 1000;
        if (!this.state.outbox.length) this.setStatus({ state: "synced", lastOk: Date.now(), error: undefined });
      } catch (e) {
        if (!this.running) return;
        this.setStatus({ state: "offline", error: (e as Error).message });
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
}
