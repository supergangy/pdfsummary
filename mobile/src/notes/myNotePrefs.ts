// '나만의 노트'에서 정한 형광펜 색의 뜻(노랑=핵심 …)을 이 기기에 기억한다.
import { deviceFs } from "./fs";
import type { Meanings } from "./myNote";

const PATH = "mynote.json";

export async function loadMeanings(): Promise<Meanings> {
  try {
    const t = await deviceFs.readText(PATH);
    const v = t ? (JSON.parse(t) as { meanings?: unknown }).meanings : null;
    if (!v || typeof v !== "object") return {};
    const out: Meanings = {};
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (typeof m === "string") out[k.toUpperCase()] = m;
    return out;
  } catch {
    return {};
  }
}

export async function saveMeanings(meanings: Meanings): Promise<void> {
  try {
    await deviceFs.writeText(PATH, JSON.stringify({ meanings }));
  } catch {
    // 기억 못 해도 이번 노트에는 그대로 쓴다
  }
}
