// 노트에서 찾기(Ctrl+F): 쪽 글에서 찾는 말이 나오는 곳과 앞뒤 글.
// 띄어쓰기·대소문자는 가리지 않는다 (PDF 글자 층은 '네트 워크'처럼 띄어 쓴 곳이 많다)

export type Hit = { before: string; mark: string; after: string };

/** text에서 query가 나오는 곳 (많아야 max개). 띄어쓰기를 빼고 비교하고, 보여 줄 때는 원래 글로 */
export function findInText(text: string, query: string, max = 3, around = 24): Hit[] {
  const q = [...query.toLowerCase()].filter((c) => !/\s/.test(c)).join("");
  if (!q || !text) return [];
  const flat = text.replace(/\s+/g, " ");
  // 띄어쓰기를 뺀 글과, 그 글자마다 원래 글의 자리
  let packed = "";
  const at: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    if (c === " ") continue;
    packed += c.toLowerCase();
    at.push(i);
  }
  const out: Hit[] = [];
  let from = 0;
  while (out.length < max) {
    const k = packed.indexOf(q, from);
    if (k < 0) break;
    const a = at[k], b = at[k + q.length - 1] + 1;
    const s = Math.max(0, a - around), e = Math.min(flat.length, b + around);
    out.push({ before: (s > 0 ? "…" : "") + flat.slice(s, a), mark: flat.slice(a, b), after: flat.slice(b, e) + (e < flat.length ? "…" : "") });
    from = k + q.length;
  }
  return out;
}

/** 한 쪽에 몇 번 나오는지 (띄어쓰기 무시) */
export function countInText(text: string, query: string): number {
  const q = [...query.toLowerCase()].filter((c) => !/\s/.test(c)).join("");
  if (!q || !text) return 0;
  const packed = text.toLowerCase().replace(/\s+/g, "");
  let n = 0, from = 0;
  for (;;) {
    const k = packed.indexOf(q, from);
    if (k < 0) return n;
    n++;
    from = k + q.length;
  }
}
