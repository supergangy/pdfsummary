// 필기 노트의 데이터 모양. 좌표는 모두 '쪽 좌표'(PDF 포인트, 1pt = 1/72인치)로 저장해서
// 화면 크기·확대와 상관없이 같고, PDF로 내보내거나 요약 서버로 보낼 때 그대로 쓴다.

export type InkTool = "pen" | "highlighter" | "text";

/** 펜 종류 (없으면 만년필 — 예전 노트 그대로) */
export type PenBrush = "ballpoint" | "fountain" | "calligraphy" | "pencil" | "brush";
/** 선 모양 (없으면 실선) */
export type LineDash = "solid" | "dash" | "dot";

export type Stroke = {
  id: string;
  tool: InkTool;
  color: string; // #RRGGBB
  width: number; // pt (글상자는 글자 크기)
  pts: number[]; // x, y, 필압(0~1) 이 차례로 반복. 글상자는 [왼쪽, 위, 0, 오른쪽, 아래, 0]
  text?: string; // 글상자의 글
  brush?: PenBrush; // 펜만
  dash?: LineDash; // 펜만
  opacity?: number; // 형광펜만 (0~1, 없으면 HIGHLIGHT_OPACITY)
};

export const PENS: { id: PenBrush; label: string; hint: string }[] = [
  { id: "ballpoint", label: "볼펜", hint: "굵기가 고른 선" },
  { id: "fountain", label: "만년필", hint: "누르는 힘에 따라 굵기가 변함" },
  { id: "calligraphy", label: "붓펜", hint: "긋는 방향에 따라 굵기가 변하는 납작한 펜촉" },
  { id: "pencil", label: "연필", hint: "얇고 옅은 선" },
  { id: "brush", label: "붓", hint: "누르면 굵어지고 끝이 가늘어짐" },
];

export const TEXT_SIZES = [12, 16, 22];

export type Paper = "plain" | "lined" | "grid" | "dotted";

export type Page = {
  id: string;
  w: number;
  h: number;
  pdf?: number; // 원본 PDF의 몇 번째 쪽인지 (0부터). 없으면 빈 속지
  paper?: Paper;
  o?: number; // 동기화용 쪽 순서 값 (작을수록 앞)
};

export type Notebook = {
  v: 1;
  id: string;
  title: string;
  created: number;
  updated: number;
  hasPdf: boolean; // 원본 PDF(source.pdf)가 있는지
  pages: Page[];
  folder?: string;
};

export type Ink = Record<string, Stroke[]>; // 쪽 id → 획들

export const A4 = { w: 595.28, h: 841.89 };

export const PEN_COLORS = ["#1F2328", "#1E4FD8", "#D7263D", "#0F8A5F", "#7A3EC8", "#E67E22", "#6B7280", "#0EA5E9", "#EC4899", "#8B5A2B", "#C9A100", "#FFFFFF"];
export const HIGHLIGHT_COLORS = ["#FFE14D", "#FF9EC7", "#8FE38F", "#7FD3FF", "#FFB86B", "#C9A7FF", "#FF7B7B", "#BDBDBD"];
export const PEN_WIDTHS = [1.2, 2, 3.2]; // 도구 모음의 빠른 고르기
export const HIGHLIGHT_WIDTHS = [10, 14, 20];
/** 설정 창의 굵기 단계 (pt) */
export const PEN_WIDTH_STEPS = [0.6, 0.9, 1.2, 1.6, 2, 2.6, 3.2, 4, 5, 6.5, 8];
export const HIGHLIGHT_WIDTH_STEPS = [6, 8, 10, 12, 14, 17, 20, 24, 28, 34];
export const HIGHLIGHT_OPACITY_STEPS = [0.2, 0.28, 0.38, 0.5, 0.62, 0.75];
export const HIGHLIGHT_OPACITY = 0.38;

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1296;
  return Date.now().toString(36) + counter.toString(36).padStart(2, "0") + Math.random().toString(36).slice(2, 6);
}

export function blankNotebook(title: string, paper: Paper = "lined", pages = 1, size = A4): Notebook {
  const now = Date.now();
  return {
    v: 1,
    id: newId(),
    title,
    created: now,
    updated: now,
    hasPdf: false,
    pages: Array.from({ length: pages }, () => ({ id: newId(), w: size.w, h: size.h, paper })),
  };
}

export function pdfNotebook(title: string, sizes: { w: number; h: number }[]): Notebook {
  const now = Date.now();
  return {
    v: 1,
    id: newId(),
    title,
    created: now,
    updated: now,
    hasPdf: true,
    pages: sizes.map((s, i) => ({ id: newId(), w: s.w, h: s.h, pdf: i })),
  };
}

/** index 뒤에 빈 속지 한 장 (크기는 옆 쪽과 같게). */
export function insertPage(nb: Notebook, after: number, paper?: Paper): Notebook {
  const ref = nb.pages[Math.max(0, Math.min(after, nb.pages.length - 1))] ?? { w: A4.w, h: A4.h };
  const page: Page = { id: newId(), w: ref.w, h: ref.h, paper: paper ?? (ref as Page).paper ?? "plain" };
  const pages = [...nb.pages];
  pages.splice(after + 1, 0, page);
  return { ...nb, pages, updated: Date.now() };
}

export function removePage(nb: Notebook, index: number): Notebook {
  if (nb.pages.length <= 1) return nb;
  const pages = nb.pages.filter((_, i) => i !== index);
  return { ...nb, pages, updated: Date.now() };
}

export function movePage(nb: Notebook, from: number, to: number): Notebook {
  const pages = [...nb.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(to, pages.length)), 0, p);
  return { ...nb, pages, updated: Date.now() };
}

/** 저장된 노트를 읽을 때: 모양이 어긋난 값은 고치거나 버린다. */
export function parseNotebook(raw: unknown): Notebook | null {
  const o = raw as Partial<Notebook> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || !Array.isArray(o.pages)) return null;
  const pages = o.pages
    .filter((p): p is Page => !!p && typeof p.id === "string" && p.w > 0 && p.h > 0)
    .map((p) => ({
      id: p.id, w: p.w, h: p.h,
      ...(Number.isInteger(p.pdf) ? { pdf: p.pdf } : {}),
      ...(p.paper ? { paper: p.paper } : {}),
      ...(typeof p.o === "number" && Number.isFinite(p.o) ? { o: p.o } : {}),
    }));
  if (!pages.length) return null;
  return {
    v: 1,
    id: o.id,
    title: typeof o.title === "string" && o.title.trim() ? o.title : "제목 없는 노트",
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Date.now(),
    hasPdf: !!o.hasPdf,
    pages,
    ...(typeof o.folder === "string" && o.folder ? { folder: o.folder } : {}),
  };
}

export function parseStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is Stroke =>
      !!s && typeof s.id === "string" && (s.tool === "pen" || s.tool === "highlighter" || (s.tool === "text" && typeof s.text === "string" && s.pts?.length === 6)) &&
      typeof s.color === "string" && s.width > 0 && Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length % 3 === 0,
  );
}

/** 글상자 크기 어림: 폭 w 안에서 줄이 몇 줄 될지 (한글·한자는 글자 폭 ≈ 글자 크기, 영문·숫자는 그 절반쯤) */
export function textBoxHeight(text: string, size: number, w: number): number {
  let lines = 0;
  for (const line of text.split("\n")) {
    let width = 0;
    for (const c of line) width += /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF]/.test(c) ? size : size * 0.55;
    lines += Math.max(1, Math.ceil(width / Math.max(size, w)));
  }
  return Math.max(1, lines) * size * 1.4;
}

export function makeTextBox(id: string, x: number, y: number, text: string, size: number, color: string, pageW: number): Stroke {
  const w = Math.max(80, Math.min(320, pageW - x - 18));
  const h = textBoxHeight(text, size, w);
  return { id, tool: "text", color, width: size, pts: [x, y, 0, x + w, y + h, 0], text };
}
