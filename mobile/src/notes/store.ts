// 노트 저장: notebooks/<id>/notebook.json, source.pdf, ink/<쪽 id>.json
// 파일을 읽고 쓰는 방법(Fs)은 기기용(fs.ts)·웹용(fs.web.ts)·시험용으로 바꿔 끼운다.
import { parseNotebook, parseStrokes, type Ink, type Notebook, type Stroke } from "./model.ts";

export type Fs = {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** 고른 파일(기기: file:// 주소, 웹: Blob)을 저장소 안으로 복사 */
  importFile(from: { uri: string; blob?: Blob }, path: string): Promise<void>;
  remove(dir: string): Promise<void>;
  listDirs(dir: string): Promise<string[]>;
  /** PDF 그리기 엔진에 넘길 주소 (기기: file://…, 웹: blob:…) */
  uri(path: string): Promise<string>;
};

const dir = (id: string) => `notebooks/${id}`;

export class NoteStore {
  private fs: Fs;
  constructor(fs: Fs) {
    this.fs = fs;
  }

  async list(): Promise<Notebook[]> {
    const ids = await this.fs.listDirs("notebooks");
    const out: Notebook[] = [];
    for (const id of ids) {
      const nb = await this.load(id);
      if (nb) out.push(nb);
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  async load(id: string): Promise<Notebook | null> {
    const t = await this.fs.readText(`${dir(id)}/notebook.json`);
    if (!t) return null;
    try {
      return parseNotebook(JSON.parse(t));
    } catch {
      return null;
    }
  }

  async save(nb: Notebook): Promise<void> {
    await this.fs.writeText(`${dir(nb.id)}/notebook.json`, JSON.stringify(nb));
  }

  async create(nb: Notebook, pdf?: { uri: string; blob?: Blob }): Promise<void> {
    if (pdf) await this.fs.importFile(pdf, `${dir(nb.id)}/source.pdf`);
    await this.save(nb);
  }

  /** 노트를 만들기 전에 원본 PDF부터 복사해 둔다 (쪽 크기를 읽으려고). */
  async attachPdf(id: string, src: { uri: string; blob?: Blob }): Promise<void> {
    await this.fs.importFile(src, `${dir(id)}/source.pdf`);
  }

  async remove(id: string): Promise<void> {
    await this.fs.remove(dir(id));
  }

  async loadInk(nb: Notebook): Promise<Ink> {
    const ink: Ink = {};
    for (const p of nb.pages) {
      const t = await this.fs.readText(`${dir(nb.id)}/ink/${p.id}.json`);
      if (!t) continue;
      try {
        const ss = parseStrokes(JSON.parse(t));
        if (ss.length) ink[p.id] = ss;
      } catch {
        // 깨진 쪽은 빈 쪽으로
      }
    }
    return ink;
  }

  async savePage(nbId: string, pageId: string, strokes: Stroke[]): Promise<void> {
    await this.fs.writeText(`${dir(nbId)}/ink/${pageId}.json`, JSON.stringify(strokes));
  }

  async folders(): Promise<string[]> {
    try {
      const t = await this.fs.readText("folders.json");
      const v = t ? JSON.parse(t) : [];
      return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
    } catch {
      return [];
    }
  }

  async saveFolders(list: string[]): Promise<void> {
    await this.fs.writeText("folders.json", JSON.stringify([...new Set(list.map((x) => x.trim()).filter(Boolean))]));
  }

  /** 노트를 폴더로 옮긴다 (folder가 비면 폴더 밖으로). */
  async moveTo(id: string, folder: string | undefined): Promise<void> {
    const nb = await this.load(id);
    if (!nb) return;
    const next = { ...nb };
    if (folder) next.folder = folder;
    else delete next.folder;
    await this.save(next);
  }

  /** 폴더 지우기: 안의 노트는 폴더 밖으로 나온다 (노트는 지우지 않음). */
  async removeFolder(name: string): Promise<void> {
    for (const nb of await this.list()) if (nb.folder === name) await this.moveTo(nb.id, undefined);
    await this.saveFolders((await this.folders()).filter((f) => f !== name));
  }

  pdfUri(nbId: string): Promise<string> {
    return this.fs.uri(`${dir(nbId)}/source.pdf`);
  }

  pdfBytes(nbId: string): Promise<Uint8Array | null> {
    return this.fs.readBytes(`${dir(nbId)}/source.pdf`);
  }
}

/** 시험·미리보기용: 메모리에만 두는 저장소 */
export function memoryFs(): Fs & { files: Map<string, string | Uint8Array> } {
  const files = new Map<string, string | Uint8Array>();
  return {
    files,
    async readText(p) {
      const v = files.get(p);
      return typeof v === "string" ? v : null;
    },
    async writeText(p, t) {
      files.set(p, t);
    },
    async readBytes(p) {
      const v = files.get(p);
      return v instanceof Uint8Array ? v : null;
    },
    async writeBytes(p, b) {
      files.set(p, b);
    },
    async importFile(from, p) {
      files.set(p, new TextEncoder().encode(from.uri));
    },
    async remove(d) {
      for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
    },
    async listDirs(d) {
      const names = new Set<string>();
      for (const k of files.keys()) if (k.startsWith(d + "/")) names.add(k.slice(d.length + 1).split("/")[0]);
      return [...names];
    },
    async uri(p) {
      return "mem://" + p;
    },
  };
}
