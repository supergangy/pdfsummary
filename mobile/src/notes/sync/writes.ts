// 동기화의 기본 단위 '쓰기': 노트 정보 하나, 쪽 하나, 획 하나, 폴더 하나가 각각 값 칸(레지스터)이다.
// 저장할 때 이전 내용과 비교해 바뀐 칸만 쓰기로 만들고, 다른 기기의 쓰기는 같은 규칙으로 적용한다.
import type { Ink, Notebook, Page, Stroke } from "../model.ts";

export type NbMeta = { title: string; created: number; updated: number; hasPdf: boolean; pdf?: string; folder?: string; fav?: boolean; trashed?: number; pos?: number };

export type Write =
  | { t: "nb"; nb: string; v: NbMeta | null } // null = 노트 지움
  | { t: "page"; nb: string; id: string; v: Page | null }
  | { t: "stroke"; nb: string; page: string; id: string; v: Stroke | null }
  | { t: "folder"; id: string; v: true | null };

export function wkey(w: Write): string {
  switch (w.t) {
    case "nb":
      return `n|${w.nb}`;
    case "page":
      return `p|${w.nb}|${w.id}`;
    case "stroke":
      return `s|${w.nb}|${w.page}|${w.id}`;
    default:
      return `f|${w.id}`;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function metaOf(nb: Notebook, pdf?: string): NbMeta {
  return {
    title: nb.title,
    created: nb.created,
    updated: nb.updated,
    hasPdf: nb.hasPdf,
    ...(pdf ? { pdf } : {}),
    ...(nb.folder ? { folder: nb.folder } : {}),
    ...(nb.fav ? { fav: true } : {}),
    ...(nb.trashed ? { trashed: nb.trashed } : {}),
    ...(nb.pos !== undefined ? { pos: nb.pos } : {}),
  };
}

const metaCore = (m: NbMeta) => ({ ...m, updated: 0 }); // 고친 시각만 바뀐 것은 보내지 않는다

/**
 * 쪽 순서 값(o): 앞에서 뒤로 점점 커지게. 이미 순서가 맞는 값은 그대로 두고,
 * 새로 끼운 쪽이나 옮긴 쪽만 앞뒤 사이 값을 준다 (다른 기기가 동시에 쪽을 끼워도 섞이지 않게).
 */
export function assignOrder(pages: Page[]): Page[] {
  const out = pages.map((p) => ({ ...p }));
  let prev = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const o = out[i].o;
    if (typeof o === "number" && o > prev) {
      // 뒤에 이보다 작은 값이 줄줄이 있으면(쪽을 앞으로 옮긴 경우) 이 값을 다시 매기는 편이 나을 수도 있지만,
      // 그대로 두고 뒤쪽 값을 고친다 — 결과 순서는 같다.
      prev = o;
      continue;
    }
    let next: number | undefined;
    for (let j = i + 1; j < out.length; j++) {
      const oj = out[j].o;
      if (typeof oj === "number" && oj > prev) {
        next = oj;
        break;
      }
    }
    let v: number;
    if (prev === -Infinity && next === undefined) v = i;
    else if (prev === -Infinity) v = next! - 1;
    else if (next === undefined) v = prev + 1;
    else v = (prev + next) / 2;
    out[i].o = v;
    prev = v;
  }
  return out;
}

export function sortPages(pages: Page[]): Page[] {
  return [...pages].sort((a, b) => (a.o ?? 0) - (b.o ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 노트 정보·쪽 목록이 바뀐 만큼의 쓰기 (prev가 없으면 새 노트) */
export function diffNotebook(prev: Notebook | null, next: Notebook, pdf?: string, prevPdf?: string): Write[] {
  const out: Write[] = [];
  const nm = metaOf(next, pdf);
  if (!prev || !same(metaCore(metaOf(prev, prevPdf)), metaCore(nm))) out.push({ t: "nb", nb: next.id, v: nm });
  const before = new Map((prev?.pages ?? []).map((p) => [p.id, p]));
  for (const p of next.pages) {
    if (!same(before.get(p.id), p)) out.push({ t: "page", nb: next.id, id: p.id, v: p });
    before.delete(p.id);
  }
  for (const id of before.keys()) out.push({ t: "page", nb: next.id, id, v: null });
  return out;
}

/** 한 쪽의 획이 바뀐 만큼의 쓰기 (새 획·바뀐 획은 내용, 지운 획은 null) */
export function diffPage(nb: string, page: string, prev: Stroke[], next: Stroke[]): Write[] {
  const out: Write[] = [];
  const before = new Map(prev.map((s) => [s.id, s]));
  for (const s of next) {
    if (!same(before.get(s.id), s)) out.push({ t: "stroke", nb, page, id: s.id, v: s });
    before.delete(s.id);
  }
  for (const id of before.keys()) out.push({ t: "stroke", nb, page, id, v: null });
  return out;
}

export function diffFolders(prev: string[], next: string[]): Write[] {
  const a = new Set(prev), b = new Set(next);
  return [
    ...[...b].filter((f) => !a.has(f)).map((id): Write => ({ t: "folder", id, v: true })),
    ...[...a].filter((f) => !b.has(f)).map((id): Write => ({ t: "folder", id, v: null })),
  ];
}

// ── 쓰기 적용 (기기 안 노트·필기 화면에 같은 함수로) ─────────────────────

/** 노트 정보·쪽 쓰기 적용. 노트가 아직 없으면 새로 만든다. 노트를 지우는 쓰기면 null. */
export function applyToNotebook(nb: Notebook | null, id: string, writes: Write[]): Notebook | null {
  let cur: Notebook | null = nb;
  for (const w of writes) {
    if (w.t === "nb" && w.nb === id) {
      if (w.v === null) return null;
      const m = w.v;
      cur = {
        v: 1,
        id,
        pages: cur?.pages ?? [],
        title: m.title,
        created: m.created,
        updated: Math.max(m.updated, cur?.updated ?? 0),
        hasPdf: m.hasPdf,
        ...(m.folder ? { folder: m.folder } : {}),
        ...(m.fav ? { fav: true } : {}),
        ...(m.trashed ? { trashed: m.trashed } : {}),
        ...(typeof m.pos === "number" ? { pos: m.pos } : {}),
      };
    } else if (w.t === "page" && w.nb === id) {
      cur ??= { v: 1, id, title: "동기화 중…", created: Date.now(), updated: Date.now(), hasPdf: false, pages: [] };
      const rest = cur.pages.filter((p) => p.id !== w.id);
      cur = { ...cur, pages: sortPages(w.v ? [...rest, w.v] : rest) };
    }
  }
  return cur;
}

/** 획 쓰기 적용: 새 획은 쪽 끝에, 바뀐 획은 제자리에서 바꾸고, 지운 획은 뺀다. */
export function applyToInk(ink: Ink, nb: string, writes: Write[]): Ink {
  let out = ink;
  for (const w of writes) {
    if (w.t !== "stroke" || w.nb !== nb) continue;
    const cur = out[w.page] ?? [];
    const i = cur.findIndex((s) => s.id === w.id);
    let next: Stroke[];
    if (w.v === null) next = i < 0 ? cur : cur.filter((s) => s.id !== w.id);
    else if (i < 0) next = [...cur, w.v];
    else next = cur.map((s, k) => (k === i ? (w.v as Stroke) : s));
    if (next !== cur) out = { ...out, [w.page]: next };
  }
  return out;
}
