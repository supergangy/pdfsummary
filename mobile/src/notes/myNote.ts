// '나만의 노트': 기기에서 만든 요약(칠한 글·밑줄·동그라미·메모)을 보기 좋게 다듬어 새 노트로 만든다.
//  - 교재 쪽 순서대로 묶고, 형광펜 색마다 정한 뜻(핵심·외울 것·예시…)을 꼬리표로 붙인다
//  - 칠한 곳 바로 옆(위아래)에 쓴 메모는 그 항목에 붙이고, 떨어진 메모는 따로 둔다
//  - 동그라미 친 말은 끝의 '용어 모음'에 한 번 더 모은다
// 만든 노트는 보통 노트처럼 글상자(글)와 형광펜·펜 획(색 막대·구분선)으로 되어 있어 고쳐 쓸 수 있다.
import { bounds, type Box } from "./geometry.ts";
import { A4, newId, textBoxHeight, textLineWidth, type Ink, type Notebook, type Page, type Stroke } from "./model.ts";
import type { QuickKind, QuickSummary } from "./quick.ts";

/** 형광펜 색(대문자 #RRGGBB) → 뜻 */
export type Meanings = Record<string, string>;

/** 처음 뜻 (형광펜 색 차례 그대로: 노랑·분홍·초록·하늘·주황·보라·빨강·회색) */
export const MEANING_DEFAULTS: Meanings = {
  "#FFE14D": "핵심",
  "#FF9EC7": "외울 것",
  "#8FE38F": "예시",
  "#7FD3FF": "정의",
  "#FFB86B": "시험",
  "#C9A7FF": "질문",
  "#FF7B7B": "주의",
  "#BDBDBD": "참고",
};

export function meaningOf(color: string, meanings: Meanings): string {
  const k = color.toUpperCase();
  return (meanings[k] ?? MEANING_DEFAULTS[k] ?? "").trim() || "형광펜";
}

/** point = 칠한·밑줄 친 글, term = 동그라미 친 말, memo = 따로 쓴 메모, ink = 글자로 못 읽은 손글씨(그림) */
export type EntryKind = "point" | "term" | "memo" | "ink";

export type NoteEntry = {
  id: string;
  kind: EntryKind;
  source: QuickKind;
  color: string;
  page: number; // 교재 쪽 (0부터)
  text: string; // 칠한 글 / 메모 글
  context: string; // 그 글이 든 문장 (칠한 글과 거의 같으면 "")
  memo: string; // 곁에 붙은 메모 (고칠 수 있음)
  strokes: Stroke[]; // ink: 손글씨 그림
  on: boolean; // 노트에 넣을지
  explain?: Explain; // AI 설명 (프리미엄)
};

/** AI 설명: 쉬운 설명 + 그림 하나(표·막대그래프·순서). 서버 pdfsummary/explain.py가 만든다 */
export type Explain = {
  explain: string;
  table?: { title: string; columns: string[]; rows: string[][] };
  chart?: { title: string; labels: string[]; values: number[]; unit: string };
  steps?: { title: string; items: string[] };
};

/** AI에게 보낼 항목 (켠 것 중 글이 있는 것: 칠한 말·용어·메모) */
export function explainRequest(d: MyNoteDraft, meanings: Meanings): { id: string; tag: string; text: string; sentence: string; memo: string }[] {
  const out = [];
  for (const s of d.sections) {
    for (const e of s.entries) {
      if (!e.on || e.kind === "ink" || !e.text.trim()) continue;
      out.push({ id: e.id, tag: tagOf(e, meanings), text: e.text, sentence: e.context, memo: e.memo });
    }
  }
  return out;
}

/** AI 답을 항목에 붙인다 (답이 없는 항목은 그대로) */
export function applyExplains(d: MyNoteDraft, answers: (Explain & { id: string })[]): MyNoteDraft {
  const by = new Map(answers.map((a) => [a.id, a]));
  return {
    ...d,
    sections: d.sections.map((s) => ({
      ...s,
      entries: s.entries.map((e) => {
        const a = by.get(e.id);
        if (!a) return e;
        const { id: _id, ...ex } = a;
        return { ...e, explain: ex };
      }),
    })),
  };
}

export type NoteSection = { id: string; page: number; title: string; entries: NoteEntry[] };

export type MyNoteDraft = {
  title: string;
  source: string; // 원본 노트 제목
  sections: NoteSection[];
  withContext: boolean; // 칠한 글 밑에 그 문장도
  glossary: boolean; // 끝에 용어 모음
};

export function tagOf(e: NoteEntry, meanings: Meanings): string {
  if (e.kind === "ink") return "손글씨";
  if (e.kind === "memo") return "내 메모";
  if (e.source === "highlight") return meaningOf(e.color, meanings);
  if (e.source === "underline") return "밑줄";
  if (e.source === "circle") return "용어";
  return "표시";
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** 두 상자의 세로 틈 (겹치면 0) */
function vgap(a: Box, b: Box): number {
  return Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
}

/** 메모를 이 거리(pt) 안의 칠한 곳에 붙인다 */
export const ATTACH_GAP = 40;

/** 칠한 끝 뒤에 붙은 것이 조사뿐이면 낱말을 넓히지 않는다 ("경쟁적 저해제" + "는") */
const PARTICLE = /^(은|는|이|가|을|를|의|에|에서|에게|께|도|와|과|로|으로|만|까지|부터|처럼|보다|이다|이며|이고|이나|나|라고|이라고|란|이란|라는|이라는|랑|이랑|하고|요)$/;

/**
 * 낱말 가운데서 시작하거나 끝난 칠하기를 낱말 끝까지 넓힌다.
 * "1. 사용자[가 언제 … 컴퓨팅 자]원(…)에" → "사용자가 언제 … 컴퓨팅 자원(…)에"
 */
export function wholeWords(s: { before: string; mark: string; after: string }): string {
  const m = flat(s.mark);
  if (!m) return "";
  let head = /^\S/.test(s.mark) ? (/\S+$/.exec(s.before)?.[0] ?? "") : "";
  let tail = /\S$/.test(s.mark) ? (/^\S+/.exec(s.after)?.[0] ?? "") : "";
  if (head.length > 20) head = "";
  const bare = tail.replace(/[.,?!:;)\]}"'’”]+$/, "");
  if (!bare || tail.length > 20 || PARTICLE.test(bare)) tail = "";
  return head + m + tail;
}

/** 글자나 숫자가 하나도 없는 인식 결과("~", "-")는 글로 쓰지 않고 그림으로 둔다 */
const HAS_WORD = /[\p{L}\p{N}]/u;

/** 파일 이름 같은 제목을 읽기 좋게 ("2025_9급_국가직" → "2025 9급 국가직") */
const pretty = (t: string) => flat(t.replace(/_+/g, " "));

/** 요약 → 고르기 전의 초안 (교재 쪽마다 위에서 아래 차례) */
export function buildDraft(q: QuickSummary): MyNoteDraft {
  const sections: NoteSection[] = [];
  for (const p of q.pages) {
    type Placed = { e: NoteEntry; box: Box; ctx: string };
    const marks: Placed[] = [];
    for (const it of p.items) {
      if (it.kind !== "highlight" && it.kind !== "underline" && it.kind !== "circle") continue;
      const text = (it.sentence && wholeWords(it.sentence)) || flat(it.text);
      if (!text) continue; // 글자 없는 곳에 칠한 것 (빈 속지·글자층 없는 스캔)
      const ctx = it.sentence ? flat(it.sentence.before + it.sentence.mark + it.sentence.after) : "";
      const prev = marks[marks.length - 1];
      // 한 문장 안에서 같은 색으로 띄엄띄엄 칠한 것은 한 항목으로
      if (prev && ctx && prev.ctx === ctx && prev.e.source === it.kind && prev.e.color === it.color) {
        prev.e.text += " · " + text;
        prev.box = [Math.min(prev.box[0], it.box[0]), Math.min(prev.box[1], it.box[1]), Math.max(prev.box[2], it.box[2]), Math.max(prev.box[3], it.box[3])];
        continue;
      }
      marks.push({
        e: { id: newId(), kind: it.kind === "circle" ? "term" : "point", source: it.kind, color: it.color, page: p.page, text, context: "", memo: "", strokes: [], on: true },
        box: it.box,
        ctx,
      });
    }
    for (const m of marks) if (m.ctx.length > m.e.text.length + 3) m.e.context = m.ctx;

    const loose: Placed[] = [];
    for (const it of p.items) {
      const text = flat(it.text);
      const readable = it.kind === "memo" ? !!text : it.kind === "handwriting" && HAS_WORD.test(text);
      if (readable) {
        let best: Placed | null = null;
        let score = Infinity;
        for (const m of marks) {
          const g = vgap(m.box, it.box);
          if (g > ATTACH_GAP) continue;
          const sc = g + Math.abs((m.box[1] + m.box[3]) / 2 - (it.box[1] + it.box[3]) / 2) * 0.01;
          if (sc < score) {
            score = sc;
            best = m;
          }
        }
        if (best) best.e.memo = best.e.memo ? `${best.e.memo}\n${text}` : text;
        else loose.push({ e: { id: newId(), kind: "memo", source: it.kind, color: it.color, page: p.page, text, context: "", memo: "", strokes: [], on: true }, box: it.box, ctx: "" });
      } else if (it.kind === "handwriting" && it.strokes.length) {
        loose.push({ e: { id: newId(), kind: "ink", source: it.kind, color: it.color, page: p.page, text: "", context: "", memo: "", strokes: it.strokes, on: true }, box: it.box, ctx: "" });
      }
    }
    const all = [...marks, ...loose].sort((a, b) => (Math.abs(a.box[1] - b.box[1]) < 6 ? a.box[0] - b.box[0] : a.box[1] - b.box[1]));
    if (all.length) sections.push({ id: newId(), page: p.page, title: `${p.page + 1}쪽`, entries: all.map((x) => x.e) });
  }
  return { title: `${pretty(q.title)} 정리`, source: pretty(q.title), sections, withContext: true, glossary: sections.some((s) => s.entries.some((e) => e.kind === "term")) };
}

/** 고른 항목 수 / 전체 */
export function countOn(d: MyNoteDraft): { on: number; all: number } {
  let on = 0, all = 0;
  for (const s of d.sections) {
    all += s.entries.length;
    on += s.entries.filter((e) => e.on).length;
  }
  return { on, all };
}

/** 같은 묶음 안에서 항목을 한 칸 위(-1)·아래(+1)로. 끝에서는 그대로 */
export function moveEntry(d: MyNoteDraft, id: string, dir: -1 | 1): MyNoteDraft {
  return {
    ...d,
    sections: d.sections.map((s) => {
      const i = s.entries.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.entries.length) return s;
      const entries = [...s.entries];
      [entries[i], entries[j]] = [entries[j], entries[i]];
      return { ...s, entries };
    }),
  };
}

export function patchEntry(d: MyNoteDraft, id: string, patch: Partial<NoteEntry>): MyNoteDraft {
  return { ...d, sections: d.sections.map((s) => (s.entries.some((e) => e.id === id) ? { ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : s)) };
}

/** 쓰인 형광펜 색 (처음 나온 차례) — 색 뜻을 정하는 칸에 보여 준다 */
export function usedHighlightColors(d: MyNoteDraft): string[] {
  const out: string[] = [];
  for (const s of d.sections) for (const e of s.entries) if (e.source === "highlight" && !out.includes(e.color.toUpperCase())) out.push(e.color.toUpperCase());
  return out;
}

// ── 쪽에 배치 ──

const W = A4.w, H = A4.h;
const LEFT = 56, RIGHT = 56, TOP = 60, BOTTOM = 64;
const CW = W - LEFT - RIGHT;
const INDENT = 14; // 색 막대 오른쪽부터 글
const INK = "#212121", SUB = "#616161", MUTED = "#9E9E9E", RULE = "#E0E0E0", ACCENT = "#6A3DF5";
const MEMO_BAR = "#C9A7FF", INK_BAR = "#BDBDBD";

/**
 * 기기가 실제로 그린 글상자 높이 (글, 글자 크기, 상자 폭 → 높이). 모르면 undefined.
 * 줄바꿈은 기기마다 다르다: 갤럭시탭은 낱말 단위로 줄을 바꾸고 줄 길이를 고르게 맞춰서,
 * 글자 수로 어림한 높이보다 줄이 늘어 아래 글과 겹쳤다 → 만들기 전에 화면에서 재어 넘겨준다 (MyNoteMaker)
 */
export type HeightOf = (text: string, size: number, w: number) => number | undefined;

export const measureKey = (text: string, size: number, w: number) => `${size}|${w}|${text}`;

/** 글에 맞춘 폭(많아야 maxW)의 글상자. 높이는 잰 값, 없으면 넉넉하게 어림한 값 */
export function boxOf(x: number, y: number, text: string, size: number, color: string, maxW: number, heightOf?: HeightOf): Stroke {
  let need = size * 2;
  for (const line of text.split("\n")) need = Math.max(need, textLineWidth(line, size) + size * 0.6);
  const w = Math.min(maxW, Math.ceil(need));
  const guess = w < maxW ? textBoxHeight(text, size, w) : textBoxHeight(text, size, w * 0.88);
  const h = Math.max(size * 1.4, heightOf?.(text, size, w) ?? guess);
  return { id: newId(), tool: "text", color, width: size, pts: [x, y, 0, x + w, y + h, 0], text };
}

export type TextBoxFn = (x: number, y: number, text: string, size: number, color: string, maxW: number) => Stroke;

export const bottomOf = (s: Stroke) => s.pts[4];

export function rule(x0: number, x1: number, y: number): Stroke {
  return { id: newId(), tool: "pen", color: RULE, width: 0.8, brush: "ballpoint", pts: [x0, y, 0.5, x1, y, 0.5] };
}

export function bar(color: string, x: number, y0: number, y1: number, opacity: number): Stroke {
  return { id: newId(), tool: "highlighter", color, width: 4, opacity, pts: [x, y0, 0.5, x, Math.max(y0 + 1, y1), 0.5] };
}

export function barColor(e: NoteEntry): { color: string; opacity: number } {
  if (e.kind === "memo") return { color: MEMO_BAR, opacity: 0.7 };
  if (e.kind === "ink") return { color: INK_BAR, opacity: 0.7 };
  if (e.source === "highlight") return { color: e.color, opacity: 0.75 };
  return { color: e.color, opacity: 0.3 }; // 펜으로 친 밑줄·동그라미는 펜 색을 옅게
}

export function shift(ss: Stroke[], dy: number): Stroke[] {
  return ss.map((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 3 === 1 ? v + dy : v)) }));
}

/** 손글씨 그림을 (x, y)부터 폭 w·높이 maxH 안에 옮긴다 (maxK배보다 키우지는 않는다). 미리 보기 화면도 쓴다 */
export function placeInk(strokes: Stroke[], x: number, y: number, w: number, maxH = 140, maxK = 1): { ss: Stroke[]; w: number; h: number } {
  const bs = strokes.map(bounds);
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
  const bw = Math.max(1, Math.max(...bs.map((b) => b[2])) - x0), bh = Math.max(1, Math.max(...bs.map((b) => b[3])) - y0);
  const k = Math.min(maxK, w / bw, maxH / bh);
  const ss = strokes.map((s) => ({
    ...s,
    id: newId(),
    width: Math.max(0.6, s.width * k),
    pts: s.pts.map((v, i) => (i % 3 === 0 ? x + (v - x0) * k : i % 3 === 1 ? y + (v - y0) * k : v)),
  }));
  return { ss, w: bw * k, h: bh * k };
}

/** 항목 하나를 y=0에서부터 그린다 (쪽에 놓을 때 옮긴다) */
function entryBlock(textBox: TextBoxFn, e: NoteEntry, meanings: Meanings, withContext: boolean, glossary = false): { ss: Stroke[]; h: number } {
  const x = LEFT + INDENT, w = CW - INDENT;
  const ss: Stroke[] = [];
  const tag = textBox(x, 0, glossary ? `${e.page + 1}쪽` : `${tagOf(e, meanings)} · ${e.page + 1}쪽`, 10, MUTED, w);
  ss.push(tag);
  let y = bottomOf(tag) + 1;
  if (e.kind === "ink") {
    const ink = placeInk(e.strokes, x, y + 2, w);
    ss.push(...ink.ss);
    y += ink.h + 4;
  } else {
    const main = textBox(x, y, e.text, glossary ? 13 : e.kind === "memo" ? 13 : 14, INK, w);
    ss.push(main);
    y = bottomOf(main);
    if (withContext && e.context) {
      const c = textBox(x, y + 2, e.context, 11, SUB, w);
      ss.push(c);
      y = bottomOf(c);
    }
  }
  if (!glossary && e.memo.trim()) {
    const m = textBox(x, y + 3, `메모: ${e.memo.trim()}`, 12, ACCENT, w);
    ss.push(m);
    y = bottomOf(m);
  }
  if (!glossary && e.explain) {
    const ex = explainBlock(textBox, e.explain, x, y + 8, w);
    ss.push(...ex.ss);
    y = ex.bottom;
  }
  const b = barColor(e);
  return { ss: [bar(b.color, LEFT + 3, 2, y - 2, b.opacity), ...ss], h: y };
}

// ── AI 설명 그리기: 설명 글, 표, 막대그래프, 순서 그림 ──
const GRID = "#BDBDBD", HEAD_BG = "#E0E0E0", BAR_FILL = "#C9A7FF", STEP_LINE = "#9E9E9E";

export function line(color: string, width: number, pts: number[]): Stroke {
  const p: number[] = [];
  for (let i = 0; i < pts.length; i += 2) p.push(pts[i], pts[i + 1], 0.5);
  return { id: newId(), tool: "pen", color, width, brush: "ballpoint", pts: p };
}

/** 네모: 변마다 따로 곧은 선 (한 획으로 이어 그리면 펜 다듬기가 모서리를 둥글게 비틀었다) */
export function rect(x0: number, y0: number, x1: number, y1: number, color: string, width = 0.8): Stroke[] {
  return [line(color, width, [x0, y0, x1, y0]), line(color, width, [x1, y0, x1, y1]), line(color, width, [x1, y1, x0, y1]), line(color, width, [x0, y1, x0, y0])];
}

/** 화살표: 몸통과 머리 두 갈래를 각각 곧은 선으로 */
function arrow(x0: number, y0: number, x1: number, y1: number, color: string): Stroke[] {
  const a = Math.atan2(y1 - y0, x1 - x0), L = 5;
  const h = (d: number) => [x1 - L * Math.cos(a + d), y1 - L * Math.sin(a + d), x1, y1];
  return [line(color, 1, [x0, y0, x1, y1]), line(color, 1, h(0.6)), line(color, 1, h(-0.6))];
}

/** 칠한 판 (형광펜 한 줄을 굵게 그어 네모를 채운다) */
export function fill(x0: number, y0: number, x1: number, y1: number, color: string, opacity: number): Stroke {
  const cy = (y0 + y1) / 2;
  return { id: newId(), tool: "highlighter", color, width: Math.max(1, y1 - y0), opacity, pts: [x0, cy, 0.5, x1, cy, 0.5] };
}

function explainBlock(textBox: TextBoxFn, ex: Explain, x: number, y0: number, w: number): { ss: Stroke[]; bottom: number } {
  const ss: Stroke[] = [];
  let y = y0;
  const label = textBox(x, y, "AI 설명", 10, ACCENT, w);
  ss.push(label);
  y = bottomOf(label) + 1;
  if (ex.explain) {
    const t = textBox(x, y, ex.explain, 12, SUB, w);
    ss.push(t);
    y = bottomOf(t);
  }
  const title = (s: string) => {
    if (!s) return;
    const t = textBox(x, y + 6, s, 11, INK, w);
    ss.push(t);
    y = bottomOf(t);
  };
  if (ex.table) {
    title(ex.table.title);
    const r = tableBlock(textBox, ex.table.columns, ex.table.rows, x, y + 6, w);
    ss.push(...r.ss);
    y = r.bottom;
  } else if (ex.chart) {
    title(ex.chart.title);
    const r = chartBlock(textBox, ex.chart, x, y + 6, w);
    ss.push(...r.ss);
    y = r.bottom;
  } else if (ex.steps) {
    title(ex.steps.title);
    const r = stepsBlock(textBox, ex.steps.items, x, y + 6, w);
    ss.push(...r.ss);
    y = r.bottom;
  }
  return { ss, bottom: y };
}

/** 표: 칸 폭은 글 길이에 맞춰 나누고, 줄 높이는 그 줄에서 가장 높은 칸에 맞춘다. 첫 줄(머리)은 회색 바탕 */
/**
 * 표 칸 폭. 글이 짧은 칸은 글 폭만큼 먼저 주고, 남는 폭을 긴 칸들이 글 길이에 비례해 나눠 갖는다.
 * 그래도 가장 긴 낱말보다 좁은 칸은 가장 넓은 칸에서 덜어 준다 ("passwd"가 "passw / d"로 끊기지 않게).
 */
export function columnWidths(columns: string[], rows: string[][], w: number, size: number, pad: number): number[] {
  const n = columns.length;
  const cellsOf = (i: number) => [columns[i] ?? "", ...rows.map((r) => r[i] ?? "")];
  const natural = columns.map((_, i) => Math.max(...cellsOf(i).map((t) => textLineWidth(t, size))) + pad * 2 + 2);
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= w) return natural.map((v) => (v / sum) * w);
  const widths = new Array<number>(n).fill(0);
  const fixed = new Set<number>();
  let left = w;
  for (let changed = true; changed; ) {
    changed = false;
    const share = left / Math.max(1, n - fixed.size);
    for (let i = 0; i < n; i++) {
      if (!fixed.has(i) && natural[i] <= share) {
        widths[i] = natural[i];
        fixed.add(i);
        left -= natural[i];
        changed = true;
      }
    }
  }
  const rest = natural.reduce((a, v, i) => a + (fixed.has(i) ? 0 : v), 0);
  for (let i = 0; i < n; i++) if (!fixed.has(i)) widths[i] = (natural[i] / rest) * left;
  const word = columns.map((_, i) => Math.min(w / n * 1.5, 140, Math.max(36, ...cellsOf(i).flatMap((t) => t.split(/\s+/)).map((x) => textLineWidth(x, size) + pad * 2 + 2))));
  for (let i = 0; i < n; i++) {
    const need = word[i] - widths[i];
    if (need <= 0) continue;
    const j = widths.indexOf(Math.max(...widths));
    if (j === i || widths[j] - need < word[j]) continue;
    widths[i] += need;
    widths[j] -= need;
  }
  return widths;
}

/** 표를 머리 줄과 줄마다의 조각으로 (각 조각은 y=0부터). 긴 표를 쪽마다 나눠 놓을 수 있게 */
export function tableParts(textBox: TextBoxFn, columns: string[], rows: string[][], x: number, w: number, SIZE = 11): { header: { ss: Stroke[]; h: number }; rows: { ss: Stroke[]; h: number }[] } {
  const PAD = 5;
  const n = columns.length;
  const widths = columnWidths(columns, rows, w, SIZE, PAD);
  const xs = [x];
  for (const cw of widths) xs.push(xs[xs.length - 1] + cw);
  const part = (cells: string[], head: boolean) => {
    const boxes = cells.slice(0, n).map((c, ci) => textBox(xs[ci] + PAD, PAD, c || " ", SIZE, head ? INK : SUB, widths[ci] - PAD * 2));
    const h = Math.max(SIZE * 1.4, ...boxes.map((b) => b.pts[4] - b.pts[1])) + PAD * 2;
    const ss: Stroke[] = [];
    if (head) ss.push(fill(x, 0, x + w, h, HEAD_BG, 0.6), line(GRID, 0.8, [x, 0, x + w, 0]));
    ss.push(...boxes, line(GRID, 0.8, [x, h, x + w, h]));
    for (const xx of xs) ss.push(line(GRID, 0.8, [xx, 0, xx, h]));
    return { ss, h };
  };
  return { header: part(columns, true), rows: rows.map((r) => part(r, false)) };
}

export function tableBlock(textBox: TextBoxFn, columns: string[], rows: string[][], x: number, y0: number, w: number, SIZE = 11): { ss: Stroke[]; bottom: number } {
  const t = tableParts(textBox, columns, rows, x, w, SIZE);
  const ss: Stroke[] = [];
  let y = y0;
  for (const p of [t.header, ...t.rows]) {
    ss.push(...shift(p.ss, y));
    y += p.h;
  }
  return { ss, bottom: y };
}

/** 가로 막대그래프: 이름 | 막대 | 값 */
function chartBlock(textBox: TextBoxFn, c: NonNullable<Explain["chart"]>, x: number, y0: number, w: number): { ss: Stroke[]; bottom: number } {
  const SIZE = 10;
  const max = Math.max(...c.values, 1e-9);
  const labelW = Math.min(w * 0.32, Math.max(...c.labels.map((l) => textLineWidth(l, SIZE))) + SIZE);
  const valueW = 64;
  const barX = x + labelW + 8, barMax = Math.max(40, w - labelW - 8 - valueW);
  const fmt = (v: number) => `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${c.unit}`;
  const ss: Stroke[] = [];
  let y = y0;
  c.labels.forEach((label, i) => {
    const lb = textBox(x, y, label, SIZE, SUB, labelW);
    const rowH = Math.max(16, lb.pts[4] - lb.pts[1]);
    const len = Math.max(2, (c.values[i] / max) * barMax);
    const cy = y + rowH / 2;
    ss.push(lb, { id: newId(), tool: "highlighter", color: BAR_FILL, width: 11, opacity: 0.9, pts: [barX, cy, 0.5, barX + len, cy, 0.5] });
    ss.push(textBox(barX + len + 6, y, fmt(c.values[i]), SIZE, INK, valueW));
    y += rowH + 4;
  });
  ss.push(line(GRID, 0.8, [barX, y0 - 2, barX, y - 2]));
  return { ss, bottom: y };
}

/** 순서 그림: 짧으면 가로로 네모 → 네모, 길거나 많으면 세로로 */
export function stepsBlock(textBox: TextBoxFn, items: string[], x: number, y0: number, w: number): { ss: Stroke[]; bottom: number } {
  const SIZE = 11, PAD = 6, GAP = 22;
  const ss: Stroke[] = [];
  const n = items.length;
  const boxW = (w - GAP * (n - 1)) / n;
  const across = n <= 4 && boxW >= 70 && items.every((t) => textLineWidth(t, SIZE) <= (boxW - PAD * 2) * 2);
  if (across) {
    const boxes = items.map((t, i) => textBox(x + i * (boxW + GAP) + PAD, y0 + PAD, t, SIZE, INK, boxW - PAD * 2));
    const h = Math.max(...boxes.map((b) => b.pts[4] - b.pts[1])) + PAD * 2;
    items.forEach((_, i) => {
      const bx = x + i * (boxW + GAP);
      ss.push(...rect(bx, y0, bx + boxW, y0 + h, STEP_LINE));
      if (i < n - 1) {
        const cy = y0 + h / 2;
        ss.push(...arrow(bx + boxW + 4, cy, bx + boxW + GAP - 4, cy, STEP_LINE));
      }
    });
    ss.push(...boxes);
    return { ss, bottom: y0 + h };
  }
  let y = y0;
  const bw = Math.min(w, 360);
  items.forEach((t, i) => {
    const b = textBox(x + PAD, y + PAD, t, SIZE, INK, bw - PAD * 2);
    const h = b.pts[4] - b.pts[1] + PAD * 2;
    ss.push(...rect(x, y, x + bw, y + h, STEP_LINE), b);
    y += h;
    if (i < n - 1) {
      ss.push(...arrow(x + 24, y + 3, x + 24, y + GAP - 4, STEP_LINE));
      y += GAP;
    }
  });
  return { ss, bottom: y };
}

export function dateLabel(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 초안 → 새 노트 (빈 A4 쪽들에 글상자·색 막대·구분선). heightOf: 기기에서 잰 글상자 높이 */
export function layoutNote(d: MyNoteDraft, meanings: Meanings, now = Date.now(), heightOf?: HeightOf): { nb: Notebook; ink: Ink } {
  const textBox: TextBoxFn = (x, y, text, size, color, maxW) => boxOf(x, y, text, size, color, maxW, heightOf);
  const pages: Page[] = [];
  const ink: Ink = {};
  let y = TOP;
  const newPage = () => {
    const p: Page = { id: newId(), w: W, h: H, paper: "plain" };
    pages.push(p);
    ink[p.id] = [];
    y = TOP;
  };
  const put = (ss: Stroke[]) => ink[pages[pages.length - 1].id].push(...ss);
  /** 높이 h가 남은 자리에 안 들어가면 다음 쪽으로 (쪽 맨 위면 그냥 놓는다) */
  const room = (h: number) => {
    if (y + h > H - BOTTOM && y > TOP + 1) newPage();
  };
  newPage();

  const sections = d.sections.map((s) => ({ ...s, entries: s.entries.filter((e) => e.on) })).filter((s) => s.entries.length);
  const all = sections.flatMap((s) => s.entries);

  // 맨 위: 제목, 원본·날짜·개수, 색 뜻 풀이, 구분선
  const title = textBox(LEFT, y, d.title.trim() || "나만의 노트", 24, INK, CW);
  put([title]);
  y = bottomOf(title) + 4;
  const meta = textBox(LEFT, y, `${d.source} · ${dateLabel(now)} · ${all.length}개`, 11, MUTED, CW);
  put([meta]);
  y = bottomOf(meta) + 12;

  const legend: { label: string; color: string; opacity: number }[] = [];
  for (const e of all) {
    const label = tagOf(e, meanings);
    if (!legend.some((l) => l.label === label)) legend.push({ label, ...barColor(e) });
  }
  if (legend.length) {
    let lx = LEFT;
    let rowH = 0;
    for (const l of legend) {
      const t = textBox(0, 0, l.label, 11, SUB, CW);
      const tw = t.pts[3] - t.pts[0];
      if (lx > LEFT && lx + 22 + tw > W - RIGHT) {
        lx = LEFT;
        y += rowH + 6;
        rowH = 0;
      }
      const th = t.pts[4] - t.pts[1];
      put([
        { id: newId(), tool: "highlighter", color: l.color, width: 9, opacity: l.opacity, pts: [lx, y + th / 2, 0.5, lx + 14, y + th / 2, 0.5] },
        { ...t, pts: [lx + 20, y, 0, lx + 20 + tw, y + th, 0] },
      ]);
      lx += 20 + tw + 12;
      rowH = Math.max(rowH, th);
    }
    y += rowH + 10;
  }
  put([rule(LEFT, W - RIGHT, y)]);
  y += 18;

  const heading = (text: string, firstH: number) => {
    const hb = textBox(LEFT, 0, text, 16, INK, CW);
    const hh = hb.pts[4] + 10;
    room(hh + firstH);
    put(shift([hb], y));
    y += hh;
  };
  const place = (b: { ss: Stroke[]; h: number }) => {
    room(b.h);
    put(shift(b.ss, y));
    y += b.h + 14;
  };

  sections.forEach((s, si) => {
    if (si > 0) y += 10;
    const blocks = s.entries.map((e) => entryBlock(textBox, e, meanings, d.withContext));
    heading(s.title.trim() || `${s.page + 1}쪽`, blocks[0].h);
    blocks.forEach(place);
  });

  const terms = all.filter((e) => e.kind === "term");
  if (d.glossary && terms.length) {
    y += 10;
    const blocks = terms.map((e) => entryBlock(textBox, e, meanings, d.withContext, true));
    heading("용어 모음", blocks[0].h);
    blocks.forEach(place);
  }

  return {
    nb: { v: 1, id: newId(), title: d.title.trim() || "나만의 노트", created: now, updated: now, hasPdf: false, pages },
    ink,
  };
}

/** 재어야 할 글상자들 (글·글자 크기·폭이 같으면 한 번만). 폭은 높이와 상관없이 정해지므로 어림 배치에서 뽑는다 */
export function boxesToMeasure(d: MyNoteDraft, meanings: Meanings): { key: string; text: string; size: number; w: number }[] {
  const out = new Map<string, { key: string; text: string; size: number; w: number }>();
  for (const ss of Object.values(layoutNote(d, meanings, 0).ink)) {
    for (const s of ss) {
      if (s.tool !== "text" || !s.text) continue;
      const w = s.pts[3] - s.pts[0];
      const key = measureKey(s.text, s.width, w);
      if (!out.has(key)) out.set(key, { key, text: s.text, size: s.width, w });
    }
  }
  return [...out.values()];
}
