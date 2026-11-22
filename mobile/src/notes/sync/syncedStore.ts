// 동기화되는 노트 저장소: 저장할 때마다 이전 내용과 비교해 바뀐 것만 동기화 엔진에 넘기고,
// 다른 기기에서 온 쓰기는 같은 규칙으로 기기 안 노트에 적용한 뒤 화면에 알린다.
import type { Notebook, Stroke } from "../model.ts";
import { NoteStore, type Fs } from "../store.ts";
import type { SyncEngine, SyncTarget } from "./engine.ts";
import { sha256 } from "./sha256.ts";

/** 동기화로 올리는 원본 PDF의 최대 크기. 이보다 크면 노트(필기)만 맞추고 PDF는 올리지 않는다 (통째로 읽으면 메모리가 모자람) */
export const PDF_SYNC_MAX = 200 * 1024 * 1024;
import { applyToInk, applyToNotebook, assignOrder, diffFolders, diffNotebook, diffPage, type Write } from "./writes.ts";

export type StoreEvent =
  | { kind: "remote"; nb: string; writes: Write[] } // 다른 기기에서 이 노트가 바뀜
  | { kind: "deleted"; nb: string }
  | { kind: "pdf"; nb: string } // 원본 PDF를 받아 왔음
  | { kind: "folders" };

export class SyncedStore extends NoteStore implements SyncTarget {
  engine: SyncEngine | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(e: StoreEvent) => void>();

  /** 파일(file:// 주소)의 SHA-256을 조금씩 읽어 계산하는 함수. 기기에서는 App이 네이티브 모듈(pdf-pages의 shaAsync)을 넣어 준다.
   *  없으면(웹·시험) JS로 통째로 읽되, PDF_SYNC_MAX보다 큰 PDF는 해시 없이 넘어간다 */
  streamSha: ((uri: string) => Promise<string>) | null = null;
  /** 동기화로 올릴 PDF 최대 크기 (시험에서 줄인다) */
  pdfSyncMax = PDF_SYNC_MAX;

  constructor(fs: Fs, streamSha?: (uri: string) => Promise<string>) {
    super(fs);
    this.streamSha = streamSha ?? null;
  }

  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // 화면 쪽 오류가 동기화를 멈추게 하지 않는다
      }
    }
  }

  /** 저장소 바꾸기는 한 번에 하나씩 (이 기기 저장과 다른 기기 쓰기가 엉키지 않게) */
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** 원본 PDF의 내용 해시. 기기에서는 파일을 조금씩 읽어 계산한다 (수백 MB PDF를 통째로 읽으면 메모리가 모자라 가져오기가 실패했다).
   *  웹처럼 그게 안 되면 JS로 읽되, 너무 큰 파일은 해시 없이(동기화에 PDF를 안 올림) 넘어간다 */
  private async pdfShaOf(nbId: string): Promise<string | undefined> {
    const eng = this.engine;
    if (!eng) return undefined;
    if (eng.state.pdfSha[nbId]) return eng.state.pdfSha[nbId];
    let sha: string | undefined;
    if (this.streamSha) {
      if (!(await super.hasPdf(nbId))) return undefined;
      sha = await this.streamSha(await super.pdfUri(nbId));
    } else {
      const bytes = await super.pdfBytes(nbId);
      if (!bytes) return undefined;
      if (bytes.length > this.pdfSyncMax) return undefined;
      sha = sha256(bytes);
    }
    eng.state.pdfSha[nbId] = sha;
    return sha;
  }

  // ── 이 기기의 저장 → 쓰기 ──
  override save(nb: Notebook): Promise<void> {
    return this.saveLatest(() => nb);
  }

  /** 저장 직전(잠근 뒤)의 최신 내용을 get()으로 읽어 저장 — 다른 기기 쓰기가 사이에 들어와도 덮지 않게 */
  saveLatest(get: () => Notebook): Promise<void> {
    return this.lock(async () => {
      const nb = get();
      const prev = await super.load(nb.id);
      const next = { ...nb, pages: assignOrder(nb.pages) };
      await super.save(next);
      if (!this.engine) return;
      const sha = next.hasPdf ? await this.pdfShaOf(next.id) : undefined;
      const writes = diffNotebook(prev, next, sha, prev?.hasPdf ? sha : undefined);
      const metaNew = writes.some((w) => w.t === "nb");
      await this.engine.record(writes, metaNew && sha && !prev ? [{ sha, nb: next.id }] : []);
    });
  }

  override savePage(nbId: string, pageId: string, strokes: Stroke[]): Promise<void> {
    return this.savePageLatest(nbId, pageId, () => strokes);
  }

  savePageLatest(nbId: string, pageId: string, get: () => Stroke[]): Promise<void> {
    return this.lock(async () => {
      const strokes = get();
      const prev = this.engine ? await super.loadPage(nbId, pageId) : [];
      await super.savePage(nbId, pageId, strokes);
      if (this.engine) await this.engine.record(diffPage(nbId, pageId, prev, strokes));
    });
  }

  override remove(id: string): Promise<void> {
    return this.lock(async () => {
      await super.remove(id);
      if (this.engine) await this.engine.record([{ t: "nb", nb: id, v: null }]);
    });
  }

  override saveFolders(list: string[]): Promise<void> {
    return this.lock(async () => {
      const prev = await super.folders();
      await super.saveFolders(list);
      if (this.engine) await this.engine.record(diffFolders(prev, await super.folders()));
    });
  }

  /** 동기화를 처음 켤 때: 이 기기에 있던 노트를 모두 쓰기로 (다른 기기에 올라가게) */
  async snapshotWrites(): Promise<{ writes: Write[]; blobs: { sha: string; nb: string }[] }> {
    return this.lock(async () => {
      const writes: Write[] = [];
      const blobs: { sha: string; nb: string }[] = [];
      for (const nb0 of await super.list()) {
        const nb = { ...nb0, pages: assignOrder(nb0.pages) };
        await super.save(nb);
        const sha = nb.hasPdf ? await this.pdfShaOf(nb.id) : undefined;
        if (sha) blobs.push({ sha, nb: nb.id });
        writes.push(...diffNotebook(null, nb, sha));
        const ink = await super.loadInk(nb);
        for (const p of nb.pages) writes.push(...diffPage(nb.id, p.id, [], ink[p.id] ?? []));
      }
      writes.push(...diffFolders([], await super.folders()));
      return { writes, blobs };
    });
  }

  // ── 다른 기기의 쓰기 → 이 기기 (SyncTarget) ──
  applyRemote(writes: Write[]): Promise<{ pdfNeeded: { nb: string; sha: string }[] }> {
    return this.lock(async () => {
      const pdfNeeded: { nb: string; sha: string }[] = [];
      const folderWrites = writes.filter((w) => w.t === "folder");
      if (folderWrites.length) {
        const set = new Set(await super.folders());
        for (const w of folderWrites) (w.v ? set.add(w.id) : set.delete(w.id));
        await super.saveFolders([...set]);
        this.emit({ kind: "folders" });
      }
      const byNb = new Map<string, Write[]>();
      for (const w of writes) if (w.t !== "folder") byNb.set(w.nb, [...(byNb.get(w.nb) ?? []), w]);
      for (const [id, ws] of byNb) {
        if (ws.some((w) => w.t === "nb" && w.v === null)) {
          await super.remove(id);
          this.emit({ kind: "deleted", nb: id });
          continue;
        }
        const cur = await super.load(id);
        const nbWrites = ws.filter((w) => w.t === "nb" || w.t === "page");
        if (nbWrites.length) {
          const next = applyToNotebook(cur, id, nbWrites);
          if (next) await super.save(next);
          const meta = ws.find((w) => w.t === "nb") as { v: { pdf?: string; hasPdf: boolean } } | undefined;
          if (meta?.v?.hasPdf && meta.v.pdf && this.engine?.state.pdfSha[id] !== meta.v.pdf) {
            if (!(await super.hasPdf(id)) || (await this.pdfShaOf(id)) !== meta.v.pdf) pdfNeeded.push({ nb: id, sha: meta.v.pdf });
          }
        }
        const pages = new Set(ws.filter((w) => w.t === "stroke").map((w) => (w as { page: string }).page));
        for (const pid of pages) {
          const before = await super.loadPage(id, pid);
          const after = applyToInk({ [pid]: before }, id, ws)[pid] ?? [];
          await super.savePage(id, pid, after);
        }
        this.emit({ kind: "remote", nb: id, writes: ws });
      }
      return { pdfNeeded };
    });
  }

  /** 동기화 엔진이 올릴 PDF. 너무 크면 null (안 올림) — 크기는 먼저 보고, 읽다가 메모리가 모자라도 null */
  async pdfBytes(nb: string): Promise<Uint8Array | null> {
    const size = await super.pdfSize(nb);
    if (size !== null && size > this.pdfSyncMax) return null;
    try {
      const bytes = await super.pdfBytes(nb);
      return bytes && bytes.length > this.pdfSyncMax ? null : bytes;   // 크기를 몰라 읽고 나서야 아는 경우
    } catch {
      return null;
    }
  }

  async putPdf(nb: string, _sha: string, data: Uint8Array): Promise<void> {
    await this.lock(() => super.writePdf(nb, data));
    this.emit({ kind: "pdf", nb });
  }
}
