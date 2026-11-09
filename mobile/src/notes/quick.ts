// 서버 없이 기기에서 바로 만드는 요약: 노트의 획과 PDF 글자 상자만으로
//  - 형광펜 → 그 밑의 글자(와 그 글자가 든 문장)
//  - 글자 바로 밑의 가로 펜 줄 → 밑줄 친 글자
//  - 글자를 둘러싼 닫힌 고리 → 동그라미 친 글자
//  - 나머지 펜 획 묶음 → 손글씨 (획 그림 그대로, 글자 인식이 되면 그 글도)
import { bounds, strokeSvg, type Box } from "./geometry.ts";
import type { Ink, Notebook, Stroke } from "./model.ts";

/** 글자 하나와 상자 (화면 쪽 좌표). "\n"은 줄바꿈. */
export type PdfChar = [string, number, number, number, number];

export type QuickKind = "highlight" | "underline" | "circle" | "handwriting" | "memo";

export type QuickItem = {
  page: number; // 0부터
  kind: QuickKind;
  color: string;
  text: string; // 표시한 글자 (손글씨는 인식한 글, 없으면 "")
  sentence?: { before: string; mark: string; after: string };
  box: Box;
  strokes: Stroke[]; // 손글씨 그림용
};

const isSpace = (c: string) => /\s/.test(c);

/** 형광펜(끝이 각진 선)이 이 점을 덮는지: 선분 위로 수직으로 내린 점이 선분 안에 있어야 한다 */
function coveredBy(px: number, py: number, s: Stroke): boolean {
  const pts = s.pts, half = s.width / 2 + 1;
  if (pts.length === 3) return Math.abs(px - pts[0]) <= half && Math.abs(py - pts[1]) <= half;
  for (let i = 3; i < pts.length; i += 3) {
    const ax = pts[i - 3], ay = pts[i - 2], bx = pts[i], by = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const t = ((px - ax) * dx + (py - ay) * dy) / len; // 선분 방향 거리
    if (t < -1 || t > len + 1) continue;
    const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len; // 선분에서 떨어진 거리
    if (d <= half) return true;
  }
  return false;
}

function inPolygon(x: number, y: number, pts: number[]): boolean {
  let inside = false;
  const n = pts.length / 3;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 3], yi = pts[i * 3 + 1], xj = pts[j * 3], yj = pts[j * 3 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** 글자 번호들을 이어진 덩어리로 (사이에 띄어쓰기만 있으면 이어진 것으로) */
function runs(idx: number[], chars: PdfChar[]): [number, number][] {
  const out: [number, number][] = [];
  const sorted = [...new Set(idx)].sort((a, b) => a - b);
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last) {
      let gapOk = true;
      for (let k = last[1] + 1; k < i; k++) if (!isSpace(chars[k][0])) gapOk = false;
      // 줄바꿈을 넘어 이어지는 형광펜도 한 덩어리 (두 줄에 걸친 문장)
      if (gapOk && i - last[1] <= 3) {
        last[1] = i;
        continue;
      }
    }
    out.push([i, i]);
  }
  return out;
}

const join = (chars: PdfChar[], a: number, b: number) =>
  chars.slice(a, b + 1).map((c) => (c[0] === "\n" ? " " : c[0])).join("").replace(/\s+/g, " ").trim();

/** [a, b] 글자가 든 문장 (마침표·물음표·느낌표·빈 줄에서 끊음, 너무 길면 자름) */
export function sentenceAround(chars: PdfChar[], a: number, b: number) {
  const end = (k: number) => /[.!?。]/.test(chars[k]?.[0] ?? "") && (k + 1 >= chars.length || isSpace(chars[k + 1][0]));
  let s = a;
  while (s > 0 && !end(s - 1) && a - s < 200) s--;
  let e = b;
  while (e < chars.length - 1 && !end(e) && e - b < 200) e++;
  return { before: join(chars, s, a - 1), mark: join(chars, a, b), after: join(chars, b + 1, e) };
}

function centers(chars: PdfChar[]) {
  return chars.map(([c, x0, y0, x1, y1]) => ({ c, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, y0, x1, y1 }));
}

function isFlat(s: Stroke): boolean {
  const b = bounds(s);
  return b[2] - b[0] >= 12 && b[3] - b[1] - s.width <= Math.max(6, (b[2] - b[0]) * 0.12);
}

function isLoop(s: Stroke): boolean {
  const p = s.pts;
  if (p.length < 18) return false;
  const b = bounds(s);
  const size = Math.max(b[2] - b[0], b[3] - b[1]);
  return Math.hypot(p[0] - p[p.length - 3], p[1] - p[p.length - 2]) <= size * 0.3 && size >= 10;
}

/** 펜 획을 가까운 것끼리 묶는다 (한 글자·한 낱말·한 줄 손글씨가 한 덩어리가 되게) */
export function clusterStrokes(strokes: Stroke[], gap = 14): Stroke[][] {
  const groups: { box: Box; ss: Stroke[] }[] = [];
  for (const s of strokes) {
    const b = bounds(s);
    let hit = groups.find((g) => b[0] <= g.box[2] + gap && b[2] >= g.box[0] - gap && b[1] <= g.box[3] + gap && b[3] >= g.box[1] - gap);
    if (!hit) {
      hit = { box: b, ss: [] };
      groups.push(hit);
    }
    hit.ss.push(s);
    hit.box = [Math.min(hit.box[0], b[0]), Math.min(hit.box[1], b[1]), Math.max(hit.box[2], b[2]), Math.max(hit.box[3], b[3])];
  }
  // 묶다 보니 서로 닿게 된 덩어리끼리 다시 합친다
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i].box, c = groups[j].box;
        if (c[0] <= a[2] + gap && c[2] >= a[0] - gap && c[1] <= a[3] + gap && c[3] >= a[1] - gap) {
          groups[i] = { box: [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])], ss: [...groups[i].ss, ...groups[j].ss] };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups.map((g) => g.ss);
}

const boxOf = (ss: Stroke[]): Box => {
  const bs = ss.map(bounds);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
};

/** 쪽 하나 분석. chars가 null이면(빈 속지·글자 없는 PDF) 형광펜·밑줄도 그림으로만 남는다. */
export function analyzePage(page: number, strokes: Stroke[], chars: PdfChar[] | null): QuickItem[] {
  const items: QuickItem[] = [];
  const cs = chars ? centers(chars) : [];
  const hasText = cs.some((c) => !isSpace(c.c));

  // 형광펜: 색마다, 이어진 글자끼리 묶는다
  const hl = strokes.filter((s) => s.tool === "highlighter");
  const byColor = new Map<string, Stroke[]>();
  for (const s of hl) byColor.set(s.color, [...(byColor.get(s.color) ?? []), s]);
  for (const [color, ss] of byColor) {
    if (!hasText) {
      for (const s of ss) items.push({ page, kind: "highlight", color, text: "", box: bounds(s), strokes: [s] });
      continue;
    }
    const idx: number[] = [];
    cs.forEach((c, i) => {
      if (isSpace(c.c)) return;
      if (ss.some((s) => coveredBy(c.cx, c.cy, s))) idx.push(i);
    });
    if (!idx.length) {
      for (const s of ss) items.push({ page, kind: "highlight", color, text: "", box: bounds(s), strokes: [s] });
      continue;
    }
    for (const [a, b] of runs(idx, chars!)) {
      const bx: Box = [Math.min(...cs.slice(a, b + 1).map((c) => c.x0)), Math.min(...cs.slice(a, b + 1).map((c) => c.y0)), Math.max(...cs.slice(a, b + 1).map((c) => c.x1)), Math.max(...cs.slice(a, b + 1).map((c) => c.y1))];
      items.push({ page, kind: "highlight", color, text: join(chars!, a, b), sentence: sentenceAround(chars!, a, b), box: bx, strokes: [] });
    }
  }

  // 글상자: 쓴 글 그대로 메모로
  for (const s of strokes) {
    if (s.tool === "text" && s.text?.trim()) items.push({ page, kind: "memo", color: s.color, text: s.text.trim(), box: bounds(s), strokes: [] });
  }

  // 펜: 덩어리마다 밑줄 / 동그라미 / 손글씨
  for (const group of clusterStrokes(strokes.filter((s) => s.tool === "pen"))) {
    const box = boxOf(group);
    const color = group[0].color;
    if (hasText && group.every(isFlat)) {
      const idx: number[] = [];
      const y = (box[1] + box[3]) / 2;
      cs.forEach((c, i) => {
        if (isSpace(c.c)) return;
        const h = c.y1 - c.y0;
        if (c.cx >= box[0] && c.cx <= box[2] && y >= c.y1 - h * 0.25 && y <= c.y1 + Math.max(6, h * 0.6)) idx.push(i);
      });
      if (idx.length) {
        for (const [a, b] of runs(idx, chars!)) items.push({ page, kind: "underline", color, text: join(chars!, a, b), sentence: sentenceAround(chars!, a, b), box, strokes: [] });
        continue;
      }
    }
    if (hasText && group.length === 1 && isLoop(group[0])) {
      const idx: number[] = [];
      cs.forEach((c, i) => {
        if (!isSpace(c.c) && inPolygon(c.cx, c.cy, group[0].pts)) idx.push(i);
      });
      if (idx.length) {
        for (const [a, b] of runs(idx, chars!)) items.push({ page, kind: "circle", color, text: join(chars!, a, b), sentence: sentenceAround(chars!, a, b), box, strokes: [] });
        continue;
      }
    }
    items.push({ page, kind: "handwriting", color, text: "", box, strokes: group });
  }

  return items.sort((p, q) => (Math.abs(p.box[1] - q.box[1]) < 6 ? p.box[0] - q.box[0] : p.box[1] - q.box[1]));
}

export type QuickSummary = { title: string; pages: { page: number; items: QuickItem[] }[]; overview?: string };

/** 노트 전체. getChars(쪽 번호) 는 PDF 쪽이면 글자 상자를, 아니면 null을 돌려준다. */
export async function quickSummary(
  nb: Notebook,
  ink: Ink,
  getChars: (pdfIndex: number) => Promise<PdfChar[] | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<QuickSummary> {
  const pages: QuickSummary["pages"] = [];
  const todo = nb.pages.map((p, i) => ({ p, i })).filter(({ p }) => (ink[p.id]?.length ?? 0) > 0);
  let done = 0;
  for (const { p, i } of todo) {
    let chars: PdfChar[] | null = null;
    if (p.pdf !== undefined) {
      try {
        chars = await getChars(p.pdf);
      } catch {
        chars = null;
      }
    }
    const items = analyzePage(i, ink[p.id] ?? [], chars);
    if (items.length) pages.push({ page: i, items });
    onProgress?.(++done, todo.length);
  }
  return { title: nb.title, pages };
}

/** 기기 안 AI에게 노트 전체 개요를 부탁할 글 (작은 모델이 읽을 수 있게 짧게) */
export function overviewPrompt(q: QuickSummary, limit = 1600): { instructions: string; prompt: string } | null {
  const lines: string[] = [];
  let used = 0;
  for (const { page, items } of q.pages) {
    for (const it of items) {
      const t = it.sentence ? `${it.sentence.before} [${it.sentence.mark}] ${it.sentence.after}`.trim() : it.text;
      if (!t) continue;
      const line = `- ${page + 1}쪽 ${LABEL[it.kind]}: ${t.slice(0, 160)}`;
      if (used + line.length > limit) break;
      lines.push(line);
      used += line.length;
    }
  }
  if (!lines.length) return null;
  return {
    instructions: "당신은 학생의 공부 노트 정리를 돕습니다. 한국어로 짧고 정확하게 답합니다. 주어진 내용에 근거한 것만 쓰고 지어내지 않습니다.",
    prompt: `노트: ${q.title}\n\n[학생이 표시한 부분, 대괄호가 칠한 말]\n${lines.join("\n")}\n\n이 표시들이 다루는 내용을 3문장 안으로 요약해 주세요. 요약 글만 쓰세요.`,
  };
}

// ── HTML ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const LABEL: Record<QuickKind, string> = { highlight: "형광펜", underline: "밑줄", circle: "동그라미", handwriting: "손글씨", memo: "메모" };

function inkSvg(it: QuickItem): string {
  const [x0, y0, x1, y1] = it.box;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const paths = it.strokes
    .map((s) => s.tool === "pen"
      ? `<path d="${strokeSvg(s)}" fill="${s.color}"/>`
      : `<path d="${strokeSvg(s)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-opacity="0.38"/>`)
    .join("");
  const scale = Math.min(1.6, 520 / w);
  return `<svg class="ink" viewBox="${x0 - 4} ${y0 - 4} ${w + 8} ${h + 8}" width="${Math.round((w + 8) * scale)}" height="${Math.round((h + 8) * scale)}">${paths}</svg>`;
}

export function quickHtml(q: QuickSummary): string {
  const count = (k: QuickKind) => q.pages.reduce((n, p) => n + p.items.filter((i) => i.kind === k).length, 0);
  const stats = (["highlight", "underline", "circle", "handwriting", "memo"] as QuickKind[]).filter((k) => count(k)).map((k) => `${LABEL[k]} ${count(k)}`).join(" · ");
  const body = q.pages.map(({ page, items }) => {
    const rows = items.map((it) => {
      let main: string;
      if (it.sentence && it.text) {
        const m = `<mark style="background:${it.kind === "highlight" ? it.color + "66" : "transparent"};${it.kind !== "highlight" ? `text-decoration:underline 2px ${it.color};` : ""}">${esc(it.sentence.mark)}</mark>`;
        main = `<p>${esc(it.sentence.before)} ${m} ${esc(it.sentence.after)}</p>`;
      } else if (it.text) {
        main = `<p>${it.kind === "memo" ? "📝 " : ""}${esc(it.text).replace(/\n/g, "<br>")}</p>`;
      } else {
        main = "";
      }
      const pic = it.kind === "handwriting" || (!it.text && it.kind !== "memo") ? inkSvg(it) : "";
      return `<li style="border-left-color:${it.color}">${main}${pic}<small>${LABEL[it.kind]}</small></li>`;
    }).join("");
    return `<section><h2>${page + 1}쪽</h2><ul>${rows}</ul></section>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(q.title)} 요약</title><style>
:root{--bg:#faf9f6;--card:#fff;--ink:#202328;--muted:#6a707a;--line:#e5e2da}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--card:#1e2025;--ink:#e7e8ea;--muted:#9aa0a8;--line:#31343b}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:820px;margin:0 auto;padding:28px 18px 60px}h1{margin:0 0 4px;font-size:26px}
.meta{color:var(--muted);font-size:14px;margin-bottom:18px}.ov{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin-bottom:18px}
h2{font-size:15px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:4px;margin:26px 0 10px}
ul{list-style:none;margin:0;padding:0}li{background:var(--card);border:1px solid var(--line);border-left:4px solid;border-radius:8px;padding:10px 14px;margin:8px 0}
li p{margin:0}mark{color:inherit;font-weight:700;border-radius:3px;padding:0 2px}small{display:block;color:var(--muted);font-size:12px;margin-top:4px}
svg.ink{display:block;max-width:100%;height:auto;margin-top:4px;background:#fff;border-radius:6px}
</style></head><body><main><h1>${esc(q.title)}</h1><div class="meta">기기에서 만든 요약 · ${stats || "표시 없음"}</div>
${q.overview ? `<div class="ov"><b>개요</b> ${esc(q.overview)}</div>` : ""}${body || "<p>필기한 부분이 없어요.</p>"}</main></body></html>`;
}
