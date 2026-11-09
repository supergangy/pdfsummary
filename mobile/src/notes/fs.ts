// 기기(iOS·Android)용 파일 저장: 앱 문서 폴더 안
import { Directory, File, Paths } from "expo-file-system";
import type { Fs } from "./store";

const file = (path: string) => new File(Paths.document, ...path.split("/"));
const folder = (path: string) => new Directory(Paths.document, ...path.split("/"));

function ensureParent(f: File) {
  const d = f.parentDirectory;
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
}

export const deviceFs: Fs = {
  async readText(path) {
    const f = file(path);
    return f.exists ? f.text() : null;
  },
  async writeText(path, text) {
    const f = file(path);
    ensureParent(f);
    // 쓰다가 앱이 꺼져도 앞의 내용이 깨지지 않게: 임시 파일에 쓰고 바꿔 넣기
    const tmp = file(path + ".tmp");
    if (tmp.exists) tmp.delete();
    tmp.write(text);
    if (f.exists) f.delete();
    tmp.move(f);
  },
  async readBytes(path) {
    const f = file(path);
    return f.exists ? f.bytes() : null;
  },
  async writeBytes(path, bytes) {
    const f = file(path);
    ensureParent(f);
    if (f.exists) f.delete();
    f.write(bytes);
  },
  async importFile(from, path) {
    const f = file(path);
    ensureParent(f);
    if (f.exists) f.delete();
    await new File(from.uri).copy(f);
  },
  async remove(path) {
    const d = folder(path);
    if (d.exists) d.delete();
  },
  async listDirs(path) {
    const d = folder(path);
    if (!d.exists) return [];
    return d.list().filter((x) => x instanceof Directory).map((x) => x.name);
  },
  async uri(path) {
    return file(path).uri;
  },
};
