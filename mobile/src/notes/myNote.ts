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
};

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

/** 요약 → 고르기 전의 초안 (교재 쪽마다 위에서 아래 차례) */
export function buildDraft(q: QuickSummary): MyNoteDraft {
  const sections: NoteSection[] = [];
  for (const p of q.pages) {
    type Placed = { e: NoteEntry; box: Box; ctx: string };
    const marks: Placed[] = [];
    for (const it of p.items) {
      if (it.kind !== "highlight" && it.kind !== "underline" && it.kind !== "circle") continue;
      const text = flat(it.text);
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
      if ((it.kind === "handwriting" && text) || it.kind === "memo") {
        if (!text) continue;
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
  return { title: `${q.title} 정리`, source: q.title, sections, withContext: true, glossary: sections.some((s) => s.entries.some((e) => e.kind === "term")) };
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

/** 글에 맞춘 폭(많아야 maxW)의 글상자. 높이는 실제 줄바꿈(낱말 단위)보다 넉넉하게 어림한다 */
function textBox(x: number, y: number, text: string, size: number, color: string, maxW: number): Stroke {
  let need = size * 2;
  for (const line of text.split("\n")) need = Math.max(need, textLineWidth(line, size) + size * 0.6);
  const w = Math.min(maxW, Math.ceil(need));
  const h = w < maxW ? textBoxHeight(text, size, w) : textBoxHeight(text, size, w * 0.88);
  return { id: newId(), tool: "text", color, width: size, pts: [x, y, 0, x + w, y + h, 0], text };
}

const bottomOf = (s: Stroke) => s.pts[4];

function rule(x0: number, x1: number, y: number): Stroke {
  return { id: newId(), tool: "pen", color: RULE, width: 0.8, brush: "ballpoint", pts: [x0, y, 0.5, x1, y, 0.5] };
}

function bar(color: string, x: number, y0: number, y1: number, opacity: number): Stroke {
  return { id: newId(), tool: "highlighter", color, width: 4, opacity, pts: [x, y0, 0.5, x, Math.max(y0 + 1, y1), 0.5] };
}

function barColor(e: NoteEntry): { color: string; opacity: number } {
  if (e.kind === "memo") return { color: MEMO_BAR, opacity: 0.7 };
  if (e.kind === "ink") return { color: INK_BAR, opacity: 0.7 };
  if (e.source === "highlight") return { color: e.color, opacity: 0.75 };
  return { color: e.color, opacity: 0.3 }; // 펜으로 친 밑줄·동그라미는 펜 색을 옅게
}

function shift(ss: Stroke[], dy: number): Stroke[] {
  return ss.map((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 3 === 1 ? v + dy : v)) }));
}

/** 손글씨 그림을 폭 w·높이 maxH 안에 (키우지는 않는다) */
function placeInk(strokes: Stroke[], x: number, y: number, w: number, maxH = 140): { ss: Stroke[]; h: number } {
  const bs = strokes.map(bounds);
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
  const bw = Math.max(1, Math.max(...bs.map((b) => b[2])) - x0), bh = Math.max(1, Math.max(...bs.map((b) => b[3])) - y0);
  const k = Math.min(1, w / bw, maxH / bh);
  const ss = strokes.map((s) => ({
    ...s,
    id: newId(),
    width: Math.max(0.6, s.width * k),
    pts: s.pts.map((v, i) => (i % 3 === 0 ? x + (v - x0) * k : i % 3 === 1 ? y + (v - y0) * k : v)),
  }));
  return { ss, h: bh * k };
}

/** 항목 하나를 y=0에서부터 그린다 (쪽에 놓을 때 옮긴다) */
function entryBlock(e: NoteEntry, meanings: Meanings, withContext: boolean, glossary = false): { ss: Stroke[]; h: number } {
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
  const b = barColor(e);
  return { ss: [bar(b.color, LEFT + 3, 2, y - 2, b.opacity), ...ss], h: y };
}

function dateLabel(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 초안 → 새 노트 (빈 A4 쪽들에 글상자·색 막대·구분선) */
export function layoutNote(d: MyNoteDraft, meanings: Meanings, now = Date.now()): { nb: Notebook; ink: Ink } {
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
    const blocks = s.entries.map((e) => entryBlock(e, meanings, d.withContext));
    heading(s.title.trim() || `${s.page + 1}쪽`, blocks[0].h);
    blocks.forEach(place);
  });

  const terms = all.filter((e) => e.kind === "term");
  if (d.glossary && terms.length) {
    y += 10;
    const blocks = terms.map((e) => entryBlock(e, meanings, d.withContext, true));
    heading("용어 모음", blocks[0].h);
    blocks.forEach(place);
  }

  return {
    nb: { v: 1, id: newId(), title: d.title.trim() || "나만의 노트", created: now, updated: now, hasPdf: false, pages },
    ink,
  };
}
