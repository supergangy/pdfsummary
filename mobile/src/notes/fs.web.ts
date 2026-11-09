// 웹(브라우저)용 저장: IndexedDB에 파일 경로를 열쇠로 넣어 둔다
import type { Fs } from "./store";

const DB = "pdfsummary-notes";
const STORE = "files";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const urls = new Map<string, string>();

export const deviceFs: Fs = {
  async readText(path) {
    const v = await tx("readonly", (s) => s.get(path));
    return typeof v === "string" ? v : null;
  },
  async writeText(path, text) {
    await tx("readwrite", (s) => s.put(text, path));
  },
  async readBytes(path) {
    const v = await tx("readonly", (s) => s.get(path));
    if (v instanceof Blob) return new Uint8Array(await v.arrayBuffer());
    return v instanceof Uint8Array ? v : null;
  },
  async writeBytes(path, bytes) {
    await tx("readwrite", (s) => s.put(new Blob([bytes as BlobPart]), path));
  },
  async importFile(from, path) {
    const blob = from.blob ?? (await (await fetch(from.uri)).blob());
    await tx("readwrite", (s) => s.put(blob, path));
  },
  async remove(dir) {
    const range = IDBKeyRange.bound(dir + "/", dir + "/￿");
    await tx("readwrite", (s) => s.delete(range));
  },
  async listDirs(dir) {
    const keys = (await tx("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(dir + "/", dir + "/￿")))) as string[];
    return [...new Set(keys.map((k) => k.slice(dir.length + 1).split("/")[0]))];
  },
  async uri(path) {
    const old = urls.get(path);
    if (old) return old;
    const v = await tx("readonly", (s) => s.get(path));
    if (!(v instanceof Blob)) return "";
    const u = URL.createObjectURL(v);
    urls.set(path, u);
    return u;
  },
};
