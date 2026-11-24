// 노트 저장: notebooks/<id>/notebook.json, source.pdf, ink/<쪽 id>.json
// 파일을 읽고 쓰는 방법(Fs)은 기기용(fs.ts)·웹용(fs.web.ts)·시험용으로 바꿔 끼운다.
import { parseRecordings, type Recording } from "./audioSync.ts";
import { parseNotebook, parseStrokes, type Ink, type Notebook, type Stroke } from "./model.ts";

export type Fs = {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
  fileSize?(path: string): Promise<number | null>; // 파일 크기 (읽지 않고)
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
  protected fs: Fs;
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

  /** 노트 파일(.pnote)에서 푼 노트를 저장한다 */
  async importUnpacked(u: { nb: Notebook; ink: Ink; pdf: Uint8Array | null }): Promise<Notebook> {
    if (u.pdf) await this.fs.writeBytes(`${dir(u.nb.id)}/source.pdf`, u.pdf);
    for (const [pid, ss] of Object.entries(u.ink)) await this.savePage(u.nb.id, pid, ss);
    await this.save(u.nb);
    return u.nb;
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

  async loadPage(nbId: string, pageId: string): Promise<Stroke[]> {
    const t = await this.fs.readText(`${dir(nbId)}/ink/${pageId}.json`);
    if (!t) return [];
    try {
      return parseStrokes(JSON.parse(t));
    } catch {
      return [];
    }
  }

  /** 원본 PDF가 있는지. 크기만 본다 — 파일을 통째로 읽으면 수백 MB PDF에서 메모리가 모자라 가져오기가 실패했다
   *  (262MB PDF: 가져온 뒤 저장하며 이것을 불러 OutOfMemoryError → 'PDF를 열 수 없어요') */
  async hasPdf(nbId: string): Promise<boolean> {
    const p = `${dir(nbId)}/source.pdf`;
    if (this.fs.fileSize) return (await this.fs.fileSize(p)) !== null;
    return (await this.fs.readBytes(p)) !== null;
  }

  async writePdf(nbId: string, bytes: Uint8Array): Promise<void> {
    await this.fs.writeBytes(`${dir(nbId)}/source.pdf`, bytes);
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

  /** 노트 정보만 바꾸기 (즐겨찾기·휴지통·자리·폴더). undefined면 그 칸을 뺀다. 고친 시각은 그대로 */
  async patchMeta(id: string, patch: { fav?: boolean; trashed?: number; pos?: number; folder?: string; title?: string }): Promise<void> {
    const nb = await this.load(id);
    if (!nb) return;
    const next: Notebook = { ...nb };
    for (const [k, v] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (v === undefined || v === false) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    await this.save(next);
  }

  /** 폴더 지우기: 안의 노트는 폴더 밖으로 나온다 (노트는 지우지 않음). */
  async removeFolder(name: string): Promise<void> {
    for (const nb of await this.list()) if (nb.folder === name) await this.moveTo(nb.id, undefined);
    await this.saveFolders((await this.folders()).filter((f) => f !== name));
  }

  // ── 강의 녹음 (이 기기에만: 파일이 커서 동기화하지 않는다. 획의 rec·rt는 동기화된다) ──
  async recordings(nbId: string): Promise<Recording[]> {
    try {
      const t = await this.fs.readText(`${dir(nbId)}/recordings.json`);
      return t ? parseRecordings(JSON.parse(t)) : [];
    } catch {
      return [];
    }
  }

  /** 녹음 파일을 노트 폴더 안으로 복사하고 목록에 더한다 */
  async addRecording(nbId: string, rec: Recording, from: { uri: string; blob?: Blob }): Promise<void> {
    await this.fs.importFile(from, `${dir(nbId)}/rec/${rec.id}/audio.${rec.ext}`);
    const list = (await this.recordings(nbId)).filter((r) => r.id !== rec.id);
    await this.fs.writeText(`${dir(nbId)}/recordings.json`, JSON.stringify([...list, rec]));
  }

  recordingUri(nbId: string, rec: Recording): Promise<string> {
    return this.fs.uri(`${dir(nbId)}/rec/${rec.id}/audio.${rec.ext}`);
  }

  async removeRecording(nbId: string, recId: string): Promise<void> {
    await this.fs.remove(`${dir(nbId)}/rec/${recId}`);
    const list = (await this.recordings(nbId)).filter((r) => r.id !== recId);
    await this.fs.writeText(`${dir(nbId)}/recordings.json`, JSON.stringify(list));
  }

  pdfUri(nbId: string): Promise<string> {
    return this.fs.uri(`${dir(nbId)}/source.pdf`);
  }

  pdfBytes(nbId: string): Promise<Uint8Array | null> {
    return this.fs.readBytes(`${dir(nbId)}/source.pdf`);
  }

  /** 원본 PDF 크기 (바이트). 없거나 모르면 null */
  pdfSize(nbId: string): Promise<number | null> {
    return this.fs.fileSize ? this.fs.fileSize(`${dir(nbId)}/source.pdf`) : Promise.resolve(null);
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
