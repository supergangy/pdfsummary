// AI 정리 노트 (프리미엄): 서버(pdfsummary/studynote.py)가 만든 '핵심 정리' 문서를 노트 쪽에 그린다.
// 섹션마다: 제목·소개 → 개념 → 구조(소제목·표·목록·순서·명령어·핵심 메모) → 예시 문제와 답 → 시험 포인트 표 → 고득점 전략.
// 학생이 표시한 곳과 관련된 블록은 왼쪽 여백에 그 표시의 색 막대를 그린다 (색 뜻은 맨 위 풀이).
// 모두 보통 노트의 글상자·형광펜(바탕·막대)·펜(선)이라 고쳐 쓸 수 있고, 글 높이는 만들기 직전 기기에서 잰다.
import { A4, newId, type Ink, type Notebook, type Page, type Stroke } from "./model.ts";
import {
  bar, bottomOf, boxOf, dateLabel, fill, line, measureKey, rule, shift, stepsBlock, tableBlock, tableParts,
  type HeightOf, type TextBoxFn,
} from "./myNote.ts";

export type StudyBlock = {
  type: "heading" | "paragraph" | "bullets" | "steps" | "table" | "code" | "callout" | "qa";
  level?: number;
  text?: string;
  items?: string[];
  columns?: string[];
  rows?: string[][];
  q?: string;
  a?: string;
  mark_ids?: string[];
};

export type StudySection = {
  title: string;
  intro: string;
  blocks: StudyBlock[];
  points: { topic: string; key: string; stars: number }[];
  strategy: string;
};

/** 표시 id → 막대 색, 맨 위 풀이에 쓸 뜻(꼬리표)과 색 */
export type MarkLook = { color: string; opacity: number; label: string };

const W = A4.w, H = A4.h;
const LEFT = 54, RIGHT = 48, TOP = 56, BOTTOM = 60;
const CW = W - LEFT - RIGHT;
const INK = "#212121", BODY = "#424242", MUTED = "#9E9E9E", RULE_C = "#E0E0E0", ACCENT = "#6A3DF5";
const CALLOUT_BG = "#F3EFFF", CODE_BG = "#F2F2F2", QA_BG = "#F6F6F6", ACCENT_SOFT = "#C9B8FF", STARS = "#E0A100";

type Block = { ss: Stroke[]; h: number };

/** 칠한 판 (opacity 1: 바탕색 그대로) */
const panel = (x0: number, y0: number, x1: number, y1: number, color: string) => fill(x0, y0, x1, y1, color, 1);

function blockOf(tb: TextBoxFn, b: StudyBlock): Block | null {
  const x = LEFT, w = CW;
  const ss: Stroke[] = [];
  let y = 0;
  const title = (text?: string) => {
    if (!text) return;
    const t = tb(x, y, text, 10.5, INK, w);
    ss.push(t);
    y = bottomOf(t) + 4;
  };
  switch (b.type) {
    case "heading": {
      const big = b.level !== 2;
      const t = tb(x, 0, b.text ?? "", big ? 16 : 13, INK, w);
      ss.push(t);
      y = bottomOf(t);
      if (big) {
        ss.push(line(ACCENT_SOFT, 1, [x, y + 3, x + 28, y + 3]));
        y += 6;
      }
      return { ss, h: y };
    }
    case "paragraph": {
      const t = tb(x, 0, b.text ?? "", 11, BODY, w);
      return { ss: [t], h: bottomOf(t) };
    }
    case "bullets": {
      title(b.text);
      for (const it of b.items ?? []) {
        const dot = tb(x + 2, y, "•", 11, ACCENT, 12);
        const t = tb(x + 14, y, it, 11, BODY, w - 14);
        ss.push(dot, t);
        y = bottomOf(t) + 2;
      }
      return { ss, h: y };
    }
    case "steps": {
      title(b.text);
      const r = stepsBlock(tb, b.items ?? [], x, y, w);
      ss.push(...r.ss);
      return { ss, h: r.bottom };
    }
    case "table": {
      title(b.text);
      const r = tableBlock(tb, b.columns ?? [], b.rows ?? [], x, y, w, 10);
      ss.push(...r.ss);
      return { ss, h: r.bottom };
    }
    case "code": {
      const t = tb(x + 10, 8, b.text ?? "", 10, "#37474F", w - 20);
      const h = bottomOf(t) + 8;
      return { ss: [panel(x, 0, x + w, h, CODE_BG), t], h };
    }
    case "callout": {
      const t = tb(x + 14, 8, b.text ?? "", 11, INK, w - 24);
      const h = bottomOf(t) + 8;
      return { ss: [panel(x, 0, x + w, h, CALLOUT_BG), bar(ACCENT, x + 1.5, 0, h, 1), t], h };
    }
    case "qa": {
      // AI가 앞에 "Q."·"정답:"을 이미 붙여 보내면 겹치지 않게 뺀다 ("답: 정답: ④ …")
      const q = tb(x + 12, 10, `Q. ${(b.q ?? "").replace(/^\s*(Q\.|Q:|문제\s*[:.])\s*/i, "")}`, 11, INK, w - 24);
      const a = tb(x + 12, bottomOf(q) + 6, `답: ${(b.a ?? "").replace(/^\s*(정답|답|A)\s*[:.：]\s*/i, "")}`, 11, BODY, w - 24);
      const h = bottomOf(a) + 10;
      return { ss: [panel(x, 0, x + w, h, QA_BG), q, a], h };
    }
  }
  return null;
}

/** 표시와 관련된 블록: 왼쪽 여백에 그 표시 색의 막대 */
function withMarks(bl: Block, ids: string[] | undefined, marks: Map<string, MarkLook>, inset = 1): Block {
  const look = (ids ?? []).map((id) => marks.get(id)).find(Boolean);
  if (!look) return bl;
  return { ss: [bar(look.color, LEFT - 12, inset, bl.h - inset, Math.max(0.6, look.opacity)), ...bl.ss], h: bl.h };
}

const starText = (n: number) => "★".repeat(Math.max(1, Math.min(3, n)));

/** 정리 문서 → 새 노트 (A4 빈 쪽들). heightOf: 기기에서 잰 글상자 높이 */
export function layoutStudyNote(
  title: string,
  source: string,
  sections: StudySection[],
  marks: Map<string, MarkLook>,
  now = Date.now(),
  heightOf?: HeightOf,
): { nb: Notebook; ink: Ink } {
  const tb: TextBoxFn = (x, y, text, size, color, maxW) => boxOf(x, y, text, size, color, maxW, heightOf);
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
  const room = (h: number) => {
    if (y + h > H - BOTTOM && y > TOP + 1) newPage();
  };
  const place = (b: Block, gapAfter: number, keepWith = 0) => {
    room(b.h + keepWith);
    put(shift(b.ss, y));
    y += b.h + gapAfter;
  };
  /** 표: 머리 줄과 첫 줄은 함께, 쪽이 넘어가면 다음 쪽에 머리 줄을 다시 그리고 이어서 */
  const placeTable = (titleText: string | undefined, cols: string[], rows: string[][], ids: string[] | undefined, recolor?: (s: Stroke) => Stroke) => {
    const parts = tableParts(tb, cols, rows, LEFT, CW, 10);
    const fix = (ss: Stroke[]) => (recolor ? ss.map(recolor) : ss);
    const header = withMarks({ ss: fix(parts.header.ss), h: parts.header.h }, ids, marks, 0);   // 표 조각끼리 막대가 이어지게
    const first = parts.rows[0]?.h ?? 0;
    if (titleText) {
      const t = tb(LEFT, 0, titleText, 10.5, INK, CW);
      place(withMarks({ ss: [t], h: bottomOf(t) + 4 }, ids, marks), 0, header.h + first);
    }
    room(header.h + first);
    put(shift(header.ss, y));
    y += header.h;
    for (const r of parts.rows) {
      const row = withMarks({ ss: fix(r.ss), h: r.h }, ids, marks, 0);
      if (y + row.h > H - BOTTOM && y > TOP + 1) {
        newPage();
        put(shift(header.ss, y));
        y += header.h;
      }
      put(shift(row.ss, y));
      y += row.h;
    }
    y += 10;
  };
  newPage();

  // 맨 위: 제목, 원본·날짜, 표시 색 풀이
  const t = tb(LEFT, y, title.trim() || "AI 정리 노트", 24, INK, CW);
  put([t]);
  y = bottomOf(t) + 4;
  const meta = tb(LEFT, y, `${source} · ${dateLabel(now)} · AI 정리`, 11, MUTED, CW);
  put([meta]);
  y = bottomOf(meta) + 10;
  const legend: MarkLook[] = [];
  for (const m of marks.values()) if (!legend.some((l) => l.label === m.label)) legend.push(m);
  if (legend.length) {
    const lead = tb(LEFT, y, "왼쪽 색 막대 = 내가 표시한 곳:", 10, MUTED, CW);
    put([lead]);
    let lx = LEFT + (lead.pts[3] - lead.pts[0]) + 8;
    let rowH = lead.pts[4] - lead.pts[1];
    for (const l of legend) {
      const lab = tb(0, 0, l.label, 10, BODY, CW);
      const lw = lab.pts[3] - lab.pts[0], lh = lab.pts[4] - lab.pts[1];
      if (lx + 18 + lw > W - RIGHT) {
        lx = LEFT;
        y += rowH + 4;
        rowH = 0;
      }
      put([bar(l.color, lx + 2, y + 2, y + lh - 2, Math.max(0.6, l.opacity)), { ...lab, pts: [lx + 10, y, 0, lx + 10 + lw, y + lh, 0] }]);
      lx += 10 + lw + 12;
      rowH = Math.max(rowH, lh);
    }
    y += rowH + 8;
  }
  put([rule(LEFT, W - RIGHT, y)]);
  y += 20;

  sections.forEach((s, si) => {
    if (si > 0) {
      room(80);
      if (y > TOP + 1) {
        y += 10;
        put([rule(LEFT, W - RIGHT, y)]);
        y += 22;
      }
    }
    // 섹션 제목·소개 (다음 블록과 떨어지지 않게)
    const head: Stroke[] = [];
    const st = tb(LEFT, 0, s.title, 19, INK, CW);
    head.push(st);
    let hy = bottomOf(st) + 4;
    if (s.intro) {
      const it = tb(LEFT, hy, s.intro, 11, MUTED, CW);
      head.push(it);
      hy = bottomOf(it) + 4;
    }
    head.push(line(ACCENT, 1.2, [LEFT, hy + 4, W - RIGHT, hy + 4]));
    place({ ss: head, h: hy + 4 }, 16, 60);

    const blocks = s.blocks
      .map((b) => {
        const bl = blockOf(tb, b);
        return bl ? { b, bl: withMarks(bl, b.mark_ids, marks) } : null;
      })
      .filter((x): x is { b: StudyBlock; bl: Block } => !!x);
    blocks.forEach(({ b, bl }, i) => {
      if (b.type === "table") return placeTable(b.text, b.columns ?? [], b.rows ?? [], b.mark_ids);
      const isHead = b.type === "heading";
      const before = isHead ? (b.level === 2 ? 8 : 12) : 0;
      if (y > TOP + 1) y += before;
      const next = blocks[i + 1]?.bl.h ?? 0;
      place(bl, isHead ? 8 : 10, isHead ? Math.min(next, 90) : 0);
    });

    if (s.points.length) {
      if (y > TOP + 1) y += 12;
      const ph = blockOf(tb, { type: "heading", level: 1, text: "실무 및 시험 포인트 정리" })!;
      const rows = s.points.map((p) => [p.topic, p.key, starText(p.stars)]);
      // 별은 노란색으로 (표의 마지막 칸 글)
      const stars = new Set(rows.map((r) => r[2]));
      place(ph, 8, 70);
      placeTable(undefined, ["주제", "핵심 암기", "출제 빈도"], rows, undefined, (x) => (x.tool === "text" && stars.has(x.text ?? "") ? { ...x, color: STARS } : x));
    }
    if (s.strategy) {
      const sb = blockOf(tb, { type: "callout", text: `서술형 고득점 전략: ${s.strategy}` })!;
      place(sb, 10);
    }
  });

  return {
    nb: { v: 1, id: newId(), title: title.trim() || "AI 정리 노트", created: now, updated: now, hasPdf: false, pages },
    ink,
  };
}

/** 만들기 직전에 잴 글상자들 (같은 글·크기·폭은 한 번) */
export function studyBoxesToMeasure(title: string, source: string, sections: StudySection[], marks: Map<string, MarkLook>) {
  const out = new Map<string, { key: string; text: string; size: number; w: number }>();
  for (const ss of Object.values(layoutStudyNote(title, source, sections, marks, 0).ink)) {
    for (const s of ss) {
      if (s.tool !== "text" || !s.text) continue;
      const w = s.pts[3] - s.pts[0];
      const key = measureKey(s.text, s.width, w);
      if (!out.has(key)) out.set(key, { key, text: s.text, size: s.width, w });
    }
  }
  return [...out.values()];
}

/** 쪽 글자들(PdfChar)을 글로 */
export function charsToText(chars: [string, number, number, number, number][] | null): string {
  if (!chars) return "";
  return chars.map((c) => c[0]).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

