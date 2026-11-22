// 기기(iOS·Android) 파일 저장의 실제 동작. expo-file-system의 File·Directory를 받아 쓰므로 시험에서는 가짜를 끼운다.
//
// 주의: expo-file-system(SDK 58)의 write·move·copy는 비동기(Promise)다. 기다리지 않으면
// 다 쓰기 전에 옮기거나, 앞 저장이 뒤 저장보다 늦게 끝나 필기가 사라진다 (예전에 실제로 있었던 문제).
import type { Fs } from "./store.ts";

export type FileLike = {
  readonly uri: string;
  readonly exists: boolean;
  readonly size?: number | null; // 바이트 (expo File)
  readonly parentDirectory: DirLike;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
  write(content: string | Uint8Array): Promise<void>;
  move(to: FileLike, options?: { overwrite?: boolean }): Promise<void>;
  copy(to: FileLike, options?: { overwrite?: boolean }): Promise<void>;
  delete(): void;
};

export type DirLike = {
  readonly exists: boolean;
  readonly name: string;
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
  delete(): void;
  list(): (FileLike | DirLike)[];
};

export type FileApi = {
  File: new (...parts: (string | DirLike | object)[]) => FileLike;
  Directory: new (...parts: (string | DirLike | object)[]) => DirLike;
  root: object; // Paths.document
};

/** 예전(잘못된) 저장이 남긴 임시 파일 이름 — 거기에 마지막 필기가 남아 있을 수 있다 */
export const LEGACY_TMP = ".tmp";

export function makeFileFs(api: FileApi): Fs {
  const file = (path: string) => new api.File(api.root, ...path.split("/"));
  const folder = (path: string) => new api.Directory(api.root, ...path.split("/"));
  const ensureParent = (f: FileLike) => {
    const d = f.parentDirectory;
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  };
  // 같은 파일에 대한 쓰기는 차례대로 (앞 저장이 뒤 저장보다 늦게 끝나 덮어쓰지 않게)
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(path) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    queues.set(path, tail);
    void tail.then(() => {
      if (queues.get(path) === tail) queues.delete(path);
    });
    return run;
  };
  let n = 0;
  /** 임시 파일에 다 쓴 뒤 한 번에 바꿔 넣는다 (쓰다가 앱이 꺼져도 앞의 내용이 깨지지 않게) */
  const atomicWrite = (path: string, content: string | Uint8Array) =>
    serial(path, async () => {
      const f = file(path);
      ensureParent(f);
      const tmp = file(`${path}.${Date.now().toString(36)}${(n++).toString(36)}.part`);
      await tmp.write(content);
      await tmp.move(f, { overwrite: true });
      const legacy = file(path + LEGACY_TMP);
      if (legacy.exists) legacy.delete();
    });

  return {
    async readText(path) {
      await queues.get(path); // 쓰는 중이면 끝난 뒤에 읽는다
      const f = file(path);
      if (f.exists) return f.text();
      // 예전 저장 방식이 원래 파일을 지운 채 임시 파일만 남겼을 수 있다 → 되살린다
      const legacy = file(path + LEGACY_TMP);
      if (!legacy.exists) return null;
      const t = await legacy.text();
      if (!t) return null;
      await serial(path, async () => {
        if (!file(path).exists) await legacy.move(file(path), { overwrite: true });
      });
      return t;
    },
    writeText: (path, text) => atomicWrite(path, text),
    async readBytes(path) {
      await queues.get(path);
      const f = file(path);
      return f.exists ? f.bytes() : null;
    },
    async fileSize(path) {
      await queues.get(path);
      const f = file(path);
      return f.exists ? f.size ?? null : null;
    },
    writeBytes: (path, bytes) => atomicWrite(path, bytes),
    importFile: (from, path) =>
      serial(path, async () => {
        const f = file(path);
        ensureParent(f);
        await new api.File(from.uri).copy(f, { overwrite: true });
      }),
    async remove(path) {
      const d = folder(path);
      if (d.exists) d.delete();
    },
    async listDirs(path) {
      const d = folder(path);
      if (!d.exists) return [];
      return d.list().filter((x): x is DirLike => x instanceof api.Directory).map((x) => x.name);
    },
    async uri(path) {
      return file(path).uri;
    },
  };
}
