// 큰 PDF도 내보내기: 원본 PDF는 한 바이트도 바꾸지 않고, 필기를 'PDF 덧붙여 저장'(incremental update)으로 끝에 붙인다.
// 원본을 통째로 메모리에 올리지 않는다 — 끝의 목차(xref)와 쪽 정보만 조금씩 읽는다 (다른 필기 앱처럼).
// 결과 = 원본 파일 그대로 + appendInk가 돌려준 바이트. 파일 복사·덧붙이기는 플랫폼 쪽(exportNote.ts)이 한다.
//
// 덧붙이는 것: 필기를 그린 내용(그림·글꼴·사진 포함)을 새 개체로, 필기가 있는 쪽은 같은 번호로 새로 써서
// 원래 내용 뒤에 필기 내용을 더한다. 노트에서 쪽 순서를 바꾸거나 빈 쪽을 끼웠으면 쪽 목록(Pages)도 새로 만든다.
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectParser,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFContext,
  type PDFFont,
  type PDFObject,
} from "pdf-lib";
import { drawInkOnPage, drawPaper, embedImages, needsKoreanFont } from "./exportPdf.ts";
import type { Ink, Notebook } from "./model.ts";

/** 원본 PDF를 조금씩 읽는 법 (기기: 파일 손잡이, 웹: Blob.slice, 시험: 메모리) */
export type RandomReader = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

type Entry = { t: "n"; off: number; gen: number } | { t: "c"; stm: number; idx: number } | { t: "f" };

const N = (s: string) => PDFName.of(s);
const INHERIT = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;

/** 바이트 → 글자 하나씩 (offset이 그대로 맞게, latin1) */
function latin(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 8192)));
  return s;
}

const ascii = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
};

const isWs = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";

/** s[i]가 '<<'일 때 짝이 맞는 '>>' 바로 뒤 자리. 이 조각 안에서 못 찾으면 -1 (글 묶음 (…)·<16진>·% 주석은 건너뛴다) */
function dictEnd(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "%") {
      while (k < s.length && s[k] !== "\n" && s[k] !== "\r") k++;
    } else if (c === "(") {
      let d = 0;
      for (; k < s.length; k++) {
        if (s[k] === "\\") k++;
        else if (s[k] === "(") d++;
        else if (s[k] === ")" && --d === 0) break;
      }
    } else if (c === "<") {
      if (s[k + 1] === "<") {
        depth++;
        k++;
      } else {
        while (k < s.length && s[k] !== ">") k++;
      }
    } else if (c === ">" && s[k + 1] === ">") {
      depth--;
      k++;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

/** PNG 예측기(Predictor 10~15)를 되돌린다 (목차 줄(xref stream)이 흔히 쓴다) */
function unpredict(data: Uint8Array, parms: PDFDict | undefined): Uint8Array {
  const num = (k: string, d: number) => {
    const v = parms?.get(N(k));
    return v instanceof PDFNumber ? v.asNumber() : d;
  };
  const pred = num("Predictor", 1);
  if (pred < 10) {
    if (pred === 1) return data;
    throw new Error(`지원하지 않는 예측기 ${pred}`);
  }
  const bpp = Math.max(1, Math.ceil((num("Colors", 1) * num("BitsPerComponent", 8)) / 8));
  const row = Math.ceil((num("Colors", 1) * num("BitsPerComponent", 8) * num("Columns", 1)) / 8);
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (row + 1)];
    const src = r * (row + 1) + 1, dst = r * row;
    for (let i = 0; i < row; i++) {
      const x = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - row + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - row + i - bpp] : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

/** 원본 PDF를 필요한 만큼만 읽는다 */
class SourcePdf {
  readonly xref = new Map<number, Entry>();
  trailer!: PDFDict;
  startxref = 0;
  lastIsStream = false;
  bytesRead = 0;
  private cache = new Map<number, PDFObject>();
  private stms = new Map<number, { first: number; offs: Map<number, number>; data: Uint8Array }>();

  private r: RandomReader;
  private ctx: PDFContext;
  constructor(r: RandomReader, ctx: PDFContext) {
    this.r = r;
    this.ctx = ctx;
  }

  private async read(off: number, len: number): Promise<Uint8Array> {
    const n = Math.max(0, Math.min(len, this.r.size - off));
    this.bytesRead += n;
    return n ? this.r.read(off, n) : new Uint8Array(0);
  }

  private parse(bytes: Uint8Array): PDFObject {
    return PDFObjectParser.forBytes(bytes, this.ctx).parseObject();
  }

  /** off 자리의 'n g obj …'. 사전이면 끝까지 읽고, 뒤에 stream이 오면 그 내용이 시작하는 자리도 */
  private async objectAt(off: number): Promise<{ obj: PDFObject; dataAt?: number }> {
    for (let len = 4096; ; len *= 4) {
      const b = await this.read(off, len);
      const s = latin(b);
      const m = /^\s*\d+\s+\d+\s+obj\b/.exec(s);
      if (!m) throw new Error(`PDF 목차가 가리키는 자리에 개체가 없어요 (${off})`);
      let i = m[0].length;
      while (i < s.length && isWs(s[i])) i++;
      const whole = off + len >= this.r.size;
      if (s.startsWith("<<", i)) {
        const e = dictEnd(s, i);
        if (e < 0) {
          if (whole || len > 64 << 20) throw new Error("PDF 사전이 끝나지 않아요");
          continue;
        }
        const obj = this.parse(b.subarray(i, e));
        let k = e;
        while (k < s.length && isWs(s[k])) k++;
        if (s.startsWith("stream", k)) {
          k += 6;
          if (s[k] === "\r") k++;
          if (s[k] === "\n") k++;
          return { obj, dataAt: off + k };
        }
        if (k >= s.length && !whole) continue; // stream인지 보려면 더 읽어야
        return { obj };
      }
      try {
        return { obj: this.parse(b.subarray(i)) };
      } catch (e) {
        if (whole || len > 64 << 20) throw e;
      }
    }
  }

  private async streamData(dict: PDFDict, dataAt: number): Promise<Uint8Array> {
    let len = dict.get(N("Length"));
    if (len instanceof PDFRef) len = await this.get(len);
    if (!(len instanceof PDFNumber)) throw new Error("PDF 내용 길이를 모르겠어요");
    const raw = await this.read(dataAt, len.asNumber());
    const filtered = dict.get(N("Filter"));
    if (!filtered) return raw;
    const decoded = decodePDFRawStream(PDFRawStream.of(dict, raw)).decode();
    const parms = dict.get(N("DecodeParms"));
    return unpredict(decoded, parms instanceof PDFDict ? parms : undefined);
  }

  /** 목차(xref) 읽기: 맨 끝 startxref에서 시작해 /Prev를 따라간다. 새것이 먼저 (이미 있는 번호는 덮지 않는다) */
  async load() {
    const tail = latin(await this.read(Math.max(0, this.r.size - 2048), 2048));
    const at = tail.lastIndexOf("startxref");
    if (at < 0) throw new Error("PDF 끝에 목차 자리(startxref)가 없어요");
    this.startxref = parseInt(tail.slice(at + 9).trim(), 10);
    const seen = new Set<number>();
    let off: number | undefined = this.startxref;
    let first = true;
    while (off !== undefined && !seen.has(off)) {
      seen.add(off);
      const { trailer, isStream } = await this.section(off);
      if (first) {
        this.trailer = trailer;
        this.lastIsStream = isStream;
        first = false;
      }
      const hybrid = trailer.get(N("XRefStm"));
      if (hybrid instanceof PDFNumber && !seen.has(hybrid.asNumber())) {
        seen.add(hybrid.asNumber());
        await this.section(hybrid.asNumber());
      }
      const prev = trailer.get(N("Prev"));
      off = prev instanceof PDFNumber ? prev.asNumber() : undefined;
    }
  }

  private put(num: number, e: Entry) {
    if (!this.xref.has(num)) this.xref.set(num, e);
  }

  private async section(off: number): Promise<{ trailer: PDFDict; isStream: boolean }> {
    const head = latin(await this.read(off, 32));
    if (/^\s*xref/.test(head)) return { trailer: await this.classic(off), isStream: false };
    const { obj, dataAt } = await this.objectAt(off);
    if (!(obj instanceof PDFDict) || dataAt === undefined) throw new Error("PDF 목차를 읽지 못했어요");
    const data = await this.streamData(obj, dataAt);
    const w = (obj.get(N("W")) as PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
    const size = (obj.get(N("Size")) as PDFNumber).asNumber();
    const idxArr = obj.get(N("Index"));
    const index = idxArr instanceof PDFArray ? idxArr.asArray().map((x) => (x as PDFNumber).asNumber()) : [0, size];
    const field = (p: number, n: number, d: number) => {
      if (!n) return d;
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[p + i];
      return v;
    };
    const rec = w[0] + w[1] + w[2];
    let p = 0;
    for (let k = 0; k < index.length; k += 2) {
      for (let j = 0; j < index[k + 1]; j++, p += rec) {
        const type = field(p, w[0], 1), a = field(p + w[0], w[1], 0), b = field(p + w[0] + w[1], w[2], 0);
        const num = index[k] + j;
        if (type === 0) this.put(num, { t: "f" });
        else if (type === 1) this.put(num, { t: "n", off: a, gen: b });
        else if (type === 2) this.put(num, { t: "c", stm: a, idx: b });
      }
    }
    return { trailer: obj, isStream: true };
  }

  /** 옛 방식 목차: 'xref' 다음 '시작 개수' 묶음과 20바이트 줄들, 그다음 'trailer <<…>>' */
  private async classic(off: number): Promise<PDFDict> {
    let pos = off;
    let buf = "";
    let bufAt = off;
    const ensure = async (n: number) => {
      while (pos - bufAt + n > buf.length && bufAt + buf.length < this.r.size) {
        buf = buf.slice(pos - bufAt) + latin(await this.read(bufAt + buf.length, 1 << 16));
        bufAt = pos;
      }
    };
    const token = async (): Promise<string> => {
      await ensure(64);
      while (pos - bufAt < buf.length && isWs(buf[pos - bufAt])) {
        pos++;
        await ensure(64);
      }
      let t = "";
      while (pos - bufAt < buf.length && !isWs(buf[pos - bufAt])) {
        t += buf[pos - bufAt];
        pos++;
        await ensure(64);
      }
      return t;
    };
    if ((await token()) !== "xref") throw new Error("PDF 목차를 읽지 못했어요");
    for (;;) {
      const t = await token();
      if (t === "trailer" || t === "") break;
      const start = parseInt(t, 10), count = parseInt(await token(), 10);
      if (!Number.isFinite(start) || !Number.isFinite(count)) throw new Error("PDF 목차가 이상해요");
      for (let j = 0; j < count; j++) {
        const o = parseInt(await token(), 10), g = parseInt(await token(), 10), kind = await token();
        this.put(start + j, kind === "n" ? { t: "n", off: o, gen: g } : { t: "f" });
      }
    }
    // trailer 사전
    for (let len = 4096; ; len *= 4) {
      const b = await this.read(pos, len);
      const s = latin(b);
      const i = s.indexOf("<<");
      const e = i < 0 ? -1 : dictEnd(s, i);
      if (e > 0) return this.parse(b.subarray(i, e)) as PDFDict;
      if (pos + len >= this.r.size) throw new Error("PDF trailer를 읽지 못했어요");
    }
  }

  /** 개체 번호로 읽기 (스트림이면 사전만). 압축 개체 묶음(object stream) 안에 있으면 그 묶음을 풀어서 */
  async get(ref: PDFRef | number): Promise<PDFObject | undefined> {
    const num = typeof ref === "number" ? ref : ref.objectNumber;
    const hit = this.cache.get(num);
    if (hit) return hit;
    const e = this.xref.get(num);
    if (!e || e.t === "f") return undefined;
    let obj: PDFObject;
    if (e.t === "n") obj = (await this.objectAt(e.off)).obj;
    else {
      const stm = await this.objStm(e.stm);
      const at = stm.offs.get(num);
      if (at === undefined) return undefined;
      obj = this.parse(stm.data.subarray(stm.first + at));
    }
    this.cache.set(num, obj);
    return obj;
  }

  async resolve(o: PDFObject | undefined): Promise<PDFObject | undefined> {
    return o instanceof PDFRef ? this.get(o) : o;
  }

  private async objStm(num: number) {
    const have = this.stms.get(num);
    if (have) return have;
    const e = this.xref.get(num);
    if (!e || e.t !== "n") throw new Error("PDF 압축 개체 묶음을 찾지 못했어요");
    const { obj, dataAt } = await this.objectAt(e.off);
    if (!(obj instanceof PDFDict) || dataAt === undefined) throw new Error("PDF 압축 개체 묶음이 이상해요");
    const data = await this.streamData(obj, dataAt);
    const n = (obj.get(N("N")) as PDFNumber).asNumber(), first = (obj.get(N("First")) as PDFNumber).asNumber();
    const head = latin(data.subarray(0, first)).trim().split(/\s+/).map((x) => parseInt(x, 10));
    const offs = new Map<number, number>();
    for (let i = 0; i < n; i++) offs.set(head[i * 2], head[i * 2 + 1]);
    if (this.stms.size > 16) this.stms.clear(); // 메모리를 오래 잡지 않게
    const v = { first, offs, data };
    this.stms.set(num, v);
    return v;
  }

  /** 쪽 목록(위에서부터 차례대로) + 물려받는 속성(Resources·MediaBox·CropBox·Rotate) */
  async pages(): Promise<{ ref: PDFRef; dict: PDFDict; inh: Partial<Record<(typeof INHERIT)[number], PDFObject>> }[]> {
    const root = this.trailer.get(N("Root"));
    const cat = await this.resolve(root);
    if (!(cat instanceof PDFDict)) throw new Error("PDF 목차(Root)를 찾지 못했어요");
    const out: { ref: PDFRef; dict: PDFDict; inh: Partial<Record<(typeof INHERIT)[number], PDFObject>> }[] = [];
    const seen = new Set<number>();
    const walk = async (ref: PDFObject | undefined, inh: Partial<Record<(typeof INHERIT)[number], PDFObject>>, depth: number) => {
      if (!(ref instanceof PDFRef) || seen.has(ref.objectNumber) || depth > 64) return;
      seen.add(ref.objectNumber);
      const d = await this.get(ref);
      if (!(d instanceof PDFDict)) return;
      const next = { ...inh };
      for (const k of INHERIT) {
        const v = d.get(N(k));
        if (v !== undefined) next[k] = v;
      }
      const kids = await this.resolve(d.get(N("Kids")));
      const type = d.get(N("Type"));
      if (kids instanceof PDFArray && type !== N("Page")) {
        for (const kid of kids.asArray()) await walk(kid, next, depth + 1);
      } else out.push({ ref, dict: d, inh: next });
    };
    await walk(cat.get(N("Pages")), {}, 0);
    return out;
  }
}

/** 이 객체를 PDF 글로 */
function bytesOf(o: PDFObject): Uint8Array {
  const b = new Uint8Array(o.sizeInBytes());
  o.copyBytesInto(b, 0);
  return b;
}

/** 사전을 새 사전으로 얕게 복사 (값은 그대로) */
function copyDict(d: PDFDict, ctx: PDFContext): PDFDict {
  const out = ctx.obj({}) as PDFDict;
  for (const [k, v] of d.entries()) out.set(k, v);
  return out;
}

export type AppendResult = { tail: Uint8Array; bytesRead: number };

/**
 * 원본 PDF(reader) 뒤에 붙일 바이트. 원본 그대로 + 이 바이트 = 필기를 합친 PDF.
 * 노트의 쪽 순서·빈 쪽·같은 쪽 두 번을 따르고, 필기가 없는 쪽은 원본 그대로 둔다.
 */
export async function appendInk(reader: RandomReader, nb: Notebook, ink: Ink, fontBytes?: Uint8Array | null): Promise<AppendResult> {
  const tmp = await PDFDocument.create({ updateMetadata: false });
  const parseCtx = (await PDFDocument.create({ updateMetadata: false })).context;
  const src = new SourcePdf(reader, parseCtx);
  await src.load();
  if (src.trailer.get(N("Encrypt"))) throw new Error("암호가 걸린 PDF예요.");
  const srcPages = await src.pages();
  if (!srcPages.length) throw new Error("쪽이 없는 PDF예요.");
  const sizeObj = src.trailer.get(N("Size"));
  const size = Math.max(sizeObj instanceof PDFNumber ? sizeObj.asNumber() : 0, ...[...src.xref.keys()].map((k) => k + 1));
  // 새로 만드는 개체는 원본 번호 다음부터 (원본 개체와 겹치지 않게)
  tmp.context.largestObjectNumber = Math.max(tmp.context.largestObjectNumber, size - 1);
  const ctx = tmp.context;

  let font: PDFFont | null = null;
  if (needsKoreanFont(nb, ink) && fontBytes) {
    tmp.registerFontkit(fontkit);
    font = await tmp.embedFont(fontBytes, { subset: false });
  }
  const embedded = await embedImages(tmp, ink);

  const order = nb.pages.map((p) => (p.pdf !== undefined && p.pdf < srcPages.length ? p.pdf : -1));
  const identity = order.length === srcPages.length && order.every((v, i) => v === i);
  const newPages = identity ? null : ctx.nextRef();
  const rewrites: { num: number; gen: number; obj: PDFObject }[] = [];
  const kids: PDFRef[] = [];
  const used = new Set<number>();
  const scratch: PDFRef[] = []; // 필기를 그리려고 잠깐 만든 쪽 (다 그린 뒤에 지운다 — 도중에 지우면 다음 쪽을 넣을 때 쪽 목록이 깨진다)
  const num = async (o: PDFObject | undefined) => {
    const v = await src.resolve(o);
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };
  const box = async (o: PDFObject | undefined) => {
    const v = await src.resolve(o);
    if (!(v instanceof PDFArray) || v.size() !== 4) return undefined;
    const xs: number[] = [];
    for (const x of v.asArray()) {
      const n = await num(x);
      if (n === undefined) return undefined;
      xs.push(n);
    }
    return ctx.obj(xs);
  };

  for (let i = 0; i < nb.pages.length; i++) {
    const p = nb.pages[i];
    const strokes = ink[p.id] ?? [];
    const si = order[i];
    if (si < 0) {
      // 노트에서 끼운 빈 쪽: 새 쪽 개체
      const tp = tmp.addPage([p.w, p.h]);
      drawPaper(tp, p.paper, p.w, p.h, font);
      drawInkOnPage(tp, strokes, embedded, font);
      tp.node.set(N("Parent"), newPages!);
      kids.push(tp.ref);
      continue;
    }
    const sp = srcPages[si];
    const dict = copyDict(sp.dict, ctx);
    const media = (await box(sp.inh.MediaBox)) ?? ctx.obj([0, 0, 612, 792]);
    const crop = (await box(sp.inh.CropBox)) ?? media;
    const rotate = (await num(sp.inh.Rotate)) ?? 0;
    let changed = false;
    if (strokes.length) {
      // 원본 쪽과 같은 크기·자르기·회전의 빈 쪽에 필기를 그리고, 그 내용·자원을 원본 쪽에 더한다
      const tp = tmp.addPage();
      tp.node.set(N("MediaBox"), media);
      tp.node.set(N("CropBox"), crop);
      tp.node.set(N("Rotate"), ctx.obj(rotate));
      drawInkOnPage(tp, strokes, embedded, font);
      const add = tp.node.get(N("Contents"));
      const addRes = tp.node.get(N("Resources"));
      scratch.push(tp.ref);
      if (add) {
        const orig = dict.get(N("Contents"));
        const origArr = await src.resolve(orig);
        const items: PDFObject[] = origArr instanceof PDFArray ? origArr.asArray() : orig ? [orig] : [];
        const q = ctx.register(ctx.stream("q\n"));
        const Q = ctx.register(ctx.stream("\nQ\n"));
        const addItems = add instanceof PDFArray ? add.asArray() : [add];
        // 원래 내용을 q … Q로 감싸 그 안의 그래픽 상태(좌표 변환 등)가 필기에 번지지 않게
        dict.set(N("Contents"), ctx.obj(items.length ? [q, ...items, Q, ...addItems] : addItems));
        // 자원(글꼴·그림·투명도): 원래 것 + 필기 것 (필기 이름은 무작위 꼬리가 붙어 겹치지 않는다)
        const base = await src.resolve(dict.get(N("Resources")) ?? sp.inh.Resources);
        const res = base instanceof PDFDict ? copyDict(base, ctx) : (ctx.obj({}) as PDFDict);
        if (addRes instanceof PDFDict) {
          for (const [k, v] of addRes.entries()) {
            if (!(v instanceof PDFDict)) {
              if (!res.has(k)) res.set(k, v);
              continue;
            }
            const cur = await src.resolve(res.get(k));
            const cat = cur instanceof PDFDict ? copyDict(cur, ctx) : (ctx.obj({}) as PDFDict);
            for (const [kk, vv] of v.entries()) cat.set(kk, vv);
            res.set(k, cat);
          }
        }
        dict.set(N("Resources"), res);
        changed = true;
      }
    }
    if (identity) {
      if (changed) rewrites.push({ num: sp.ref.objectNumber, gen: sp.ref.generationNumber, obj: dict });
      continue;
    }
    // 쪽 목록을 새로 만든다: 부모가 바뀌므로 물려받던 속성을 쪽에 직접 적는다
    dict.set(N("Parent"), newPages!);
    for (const k of INHERIT) if (!dict.has(N(k)) && sp.inh[k] !== undefined) dict.set(N(k), sp.inh[k]!);
    let ref = sp.ref;
    if (used.has(si)) ref = ctx.nextRef(); // 같은 원본 쪽을 두 번 쓰면 둘째는 새 번호로
    used.add(si);
    rewrites.push({ num: ref.objectNumber, gen: ref.generationNumber, obj: dict });
    kids.push(ref);
  }

  const root = src.trailer.get(N("Root")) as PDFRef;
  if (newPages) {
    ctx.assign(newPages, ctx.obj({ Type: "Pages", Kids: kids, Count: kids.length }));
    const cat = await src.get(root);
    if (!(cat instanceof PDFDict)) throw new Error("PDF 목차(Root)를 찾지 못했어요");
    const c2 = copyDict(cat, ctx);
    c2.set(N("Pages"), newPages);
    rewrites.push({ num: root.objectNumber, gen: root.generationNumber, obj: c2 });
  }
  for (const r of scratch) ctx.delete(r);
  const info = ctx.register(ctx.obj({ Title: PDFHexString.fromText(nb.title), Producer: PDFHexString.fromText("필기 요약") }));
  await tmp.flush(); // 글꼴·그림을 실제로 넣는다

  // 쓸 개체: 바꿔 쓰는 원본 개체 + 새 개체(원본 번호 다음부터)
  const objs = [...rewrites];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (ref.objectNumber >= size) objs.push({ num: ref.objectNumber, gen: 0, obj });
  objs.sort((a, b) => a.num - b.num);

  const parts: Uint8Array[] = [];
  let at = reader.size;
  const push = (b: Uint8Array) => {
    parts.push(b);
    at += b.length;
  };
  push(ascii("\n"));
  const offsets: { num: number; gen: number; off: number }[] = [];
  for (const o of objs) {
    offsets.push({ num: o.num, gen: o.gen, off: at });
    push(ascii(`${o.num} ${o.gen} obj\n`));
    push(bytesOf(o.obj));
    push(ascii("\nendobj\n"));
  }
  const maxNum = Math.max(size - 1, ...objs.map((o) => o.num));
  const trailerEntries: Record<string, PDFObject> = { Root: root, Info: info, Prev: PDFNumber.of(src.startxref) };
  const id = src.trailer.get(N("ID"));
  if (id) trailerEntries.ID = id;

  const groups = (list: { num: number }[]) => {
    const out: [number, number][] = [];
    for (const e of list) {
      const g = out[out.length - 1];
      if (g && g[0] + g[1] === e.num) g[1]++;
      else out.push([e.num, 1]);
    }
    return out;
  };

  if (src.lastIsStream) {
    // 원본이 목차를 압축 줄(xref stream)로 쓰면 덧붙이는 목차도 같은 방식으로
    const xnum = maxNum + 1;
    const xoff = at;
    const all = [...offsets, { num: xnum, gen: 0, off: xoff }];
    const wOff = Math.max(4, Math.ceil(Math.log2(xoff + 1) / 8));
    const data = new Uint8Array(all.length * (1 + wOff + 2));
    all.forEach((e, i) => {
      const p = i * (1 + wOff + 2);
      data[p] = 1;
      for (let k = 0; k < wOff; k++) data[p + 1 + k] = Math.floor(e.off / 256 ** (wOff - 1 - k)) & 255;
      data[p + 1 + wOff] = (e.gen >> 8) & 255;
      data[p + 2 + wOff] = e.gen & 255;
    });
    const dict = ctx.obj({ Type: "XRef", Size: xnum + 1, Index: groups(all).flat(), W: [1, wOff, 2], ...trailerEntries });
    const stm = PDFRawStream.of(dict as PDFDict, data);
    push(ascii(`${xnum} 0 obj\n`));
    push(bytesOf(stm));
    push(ascii(`\nendobj\nstartxref\n${xoff}\n%%EOF\n`));
  } else {
    const xoff = at;
    let x = "xref\n";
    let k = 0;
    for (const [start, count] of groups(offsets)) {
      x += `${start} ${count}\n`;
      for (let j = 0; j < count; j++, k++) {
        const e = offsets[k];
        x += `${String(e.off).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n\r\n`;
      }
    }
    push(ascii(x));
    push(ascii("trailer\n"));
    push(bytesOf(ctx.obj({ Size: maxNum + 1, ...trailerEntries })));
    push(ascii(`\nstartxref\n${xoff}\n%%EOF\n`));
  }

  const tail = new Uint8Array(at - reader.size);
  let p = 0;
  for (const b of parts) {
    tail.set(b, p);
    p += b.length;
  }
  return { tail, bytesRead: src.bytesRead };
}

/** 시험·웹용: 메모리에 있는 바이트를 RandomReader로 */
export function bytesReader(b: Uint8Array): RandomReader {
  return { size: b.length, read: async (o, l) => b.subarray(o, o + l) };
}
