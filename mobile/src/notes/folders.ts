// 폴더 안의 폴더: 폴더는 '공부/NCS'처럼 / 로 이은 경로 글자로 저장한다 (폴더 목록·노트의 folder 칸 그대로,
// 예전 폴더는 맨 위 폴더가 되고 동기화도 그대로 된다). 여기는 계산만 (시험: folders.test.ts)

export const SEP = "/";
/** 목록 화면에서 '모든 노트'(폴더와 관계없이 전부)를 고른 상태. 폴더 이름과 겹치지 않는 값 */
export const ALL_NOTES = "\u0000all";

/** 폴더 이름: 앞뒤 빈칸을 없애고, / 는 경로 나눔표라 - 로 */
export function cleanName(name: string): string {
  return name.trim().replace(/\//g, "-");
}

export function joinPath(parent: string | null, name: string): string {
  return parent ? `${parent}${SEP}${name}` : name;
}

export function parentOf(path: string): string | null {
  const i = path.lastIndexOf(SEP);
  return i < 0 ? null : path.slice(0, i);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf(SEP) + 1);
}

/** path가 under 자신이거나 그 아래 폴더인지 */
export function isWithin(path: string | undefined | null, under: string): boolean {
  return !!path && (path === under || path.startsWith(under + SEP));
}

/** 저장된 폴더 목록 + 노트가 들어 있는 폴더 + 그 윗 폴더들까지 (윗 폴더가 목록에서 빠져 있어도 나무가 끊기지 않게) */
export function allFolders(saved: readonly string[], noteFolders: readonly (string | undefined)[] = []): string[] {
  const set = new Set<string>();
  for (const f of [...saved, ...noteFolders]) {
    if (!f) continue;
    let p: string | null = f;
    while (p) {
      set.add(p);
      p = parentOf(p);
    }
  }
  return [...set];
}

/** 폴더 이름 순서: 한글 이름 먼저, 그다음 영어·숫자 (기기·브라우저마다 정렬이 달라지지 않게 글자 값으로) */
function byName(a: string, b: string): number {
  const ka = a.charCodeAt(0) < 128 ? 1 : 0, kb = b.charCodeAt(0) < 128 ? 1 : 0;
  if (ka !== kb) return ka - kb;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 바로 아래 폴더들 (이름 순) */
export function childrenOf(folders: readonly string[], parent: string | null): string[] {
  return folders.filter((f) => parentOf(f) === parent).sort((a, b) => byName(nameOf(a), nameOf(b)));
}

/** 왼쪽 폴더 나무에 보일 줄들: 펼친 폴더의 아래만, 위에서부터 차례로 */
export function treeRows(folders: readonly string[], open: ReadonlySet<string>): { path: string; depth: number; hasKids: boolean }[] {
  const out: { path: string; depth: number; hasKids: boolean }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of childrenOf(folders, parent)) {
      const kids = childrenOf(folders, f).length > 0;
      out.push({ path: f, depth, hasKids: kids });
      if (kids && open.has(f)) walk(f, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** 위 경로 단추들: '공부/NCS' → [공부, 공부/NCS] */
export function crumbs(path: string | null): { name: string; path: string }[] {
  if (!path) return [];
  const parts = path.split(SEP);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join(SEP) }));
}

/** 폴더 이름 바꾸기·옮기기: from 과 그 아래 경로를 to 아래로. 상관없는 경로는 그대로 */
export function renamePath(path: string, from: string, to: string): string {
  return isWithin(path, from) ? to + path.slice(from.length) : path;
}
