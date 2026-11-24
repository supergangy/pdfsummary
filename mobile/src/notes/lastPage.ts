// 노트마다 마지막에 보던 쪽을 이 기기에 기억한다.
// (노트 파일에 넣으면 쪽을 넘길 때마다 '고친 노트'가 되어 목록 순서·동기화가 흔들린다)
import { rememberPage } from "./editor-logic";
import { deviceFs } from "./fs";

const PATH = "lastPages.json";
let cache: Record<string, string> | null = null;

async function all(): Promise<Record<string, string>> {
  if (cache) return cache;
  try {
    const t = await deviceFs.readText(PATH);
    cache = t ? (JSON.parse(t) as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** 이 노트에서 마지막에 보던 쪽 id (없으면 null) */
export async function loadLastPage(note: string): Promise<string | null> {
  return (await all())[note] ?? null;
}

export async function saveLastPage(note: string, page: string): Promise<void> {
  const m = await all();
  if (m[note] === page) return;
  cache = rememberPage(m, note, page);
  try {
    await deviceFs.writeText(PATH, JSON.stringify(cache));
  } catch {
    // 기억 못 해도 쓰는 데는 문제없음
  }
}
