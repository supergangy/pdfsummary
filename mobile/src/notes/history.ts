// 되돌리기·다시 하기. 획을 더하고 지우는 일을 '작업'으로 쌓아 두고 거꾸로 적용한다.
import type { Ink, Stroke } from "./model.ts";

export type Op =
  | { kind: "add"; page: string; strokes: Stroke[] }
  | { kind: "remove"; page: string; strokes: Stroke[]; at: number[] } // at: 지우기 전 자리
  | { kind: "replace"; page: string; before: Stroke[]; after: Stroke[] }; // 같은 id의 획을 바꿔 끼움 (옮기기·색 바꾸기)

function swap(ink: Ink, page: string, to: Stroke[]): Ink {
  const by = new Map(to.map((s) => [s.id, s]));
  return { ...ink, [page]: (ink[page] ?? []).map((s) => by.get(s.id) ?? s) };
}

export function apply(ink: Ink, op: Op): Ink {
  const cur = ink[op.page] ?? [];
  if (op.kind === "replace") return swap(ink, op.page, op.after);
  if (op.kind === "add") return { ...ink, [op.page]: [...cur, ...op.strokes] };
  const gone = new Set(op.strokes.map((s) => s.id));
  return { ...ink, [op.page]: cur.filter((s) => !gone.has(s.id)) };
}

/** 지운 획을 원래 자리(겹침 순서)에 되살린다. */
export function restore(ink: Ink, page: string, strokes: Stroke[], at: number[]): Ink {
  const cur = [...(ink[page] ?? [])];
  const pairs = strokes.map((s, i) => [at[i] ?? cur.length, s] as const).sort((a, b) => a[0] - b[0]);
  for (const [i, s] of pairs) cur.splice(Math.min(i, cur.length), 0, s);
  return { ...ink, [page]: cur };
}

export class History {
  private undos: Op[] = [];
  private redos: Op[] = [];
  private limit: number;
  constructor(limit = 200) {
    this.limit = limit;
  }

  get canUndo() {
    return this.undos.length > 0;
  }
  get canRedo() {
    return this.redos.length > 0;
  }

  /** 새 작업을 적용하고 기록한다. */
  run(ink: Ink, op: Op): Ink {
    this.undos.push(op);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
    return apply(ink, op);
  }

  undo(ink: Ink): { ink: Ink; page?: string } {
    const op = this.undos.pop();
    if (!op) return { ink };
    this.redos.push(op);
    if (op.kind === "replace") return { ink: swap(ink, op.page, op.before), page: op.page };
    if (op.kind === "add") return { ink: apply(ink, { kind: "remove", page: op.page, strokes: op.strokes, at: [] }), page: op.page };
    return { ink: restore(ink, op.page, op.strokes, op.at), page: op.page };
  }

  redo(ink: Ink): { ink: Ink; page?: string } {
    const op = this.redos.pop();
    if (!op) return { ink };
    this.undos.push(op);
    return { ink: apply(ink, op), page: op.page };
  }

  clear() {
    this.undos = [];
    this.redos = [];
  }
}

/** 지우기 작업 만들기: 지울 획들과 지금 자리. */
export function removal(ink: Ink, page: string, ids: Set<string>): Op | null {
  const cur = ink[page] ?? [];
  const strokes: Stroke[] = [];
  const at: number[] = [];
  cur.forEach((s, i) => {
    if (ids.has(s.id)) {
      strokes.push(s);
      at.push(i);
    }
  });
  return strokes.length ? { kind: "remove", page, strokes, at } : null;
}
