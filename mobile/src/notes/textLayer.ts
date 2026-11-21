// 안드로이드: 글자 인식(OCR)이 준 '자리'에 PDF 글자 층의 '글자'를 입힌다.
// 안드로이드 PdfRenderer는 쪽의 글은 주지만 글자 상자를 주지 않아서, 글자 있는 PDF도 쪽을 그림으로 그려 글자 인식으로 읽는다.
// 그러면 자리는 맞지만 글자가 틀린다 (①→0, ② 빠짐, 낱말 가운데 띄어쓰기 "하드웨 어").
// 그래서 인식한 줄마다 글자 층에서 가장 비슷한 곳을 찾아, 글자와 띄어쓰기는 글자 층 것을 쓰고 상자는 인식한 것을 물려받는다.
// 줄마다 따로 찾으므로 두 단 편집처럼 읽는 차례가 달라도 되고, 못 찾은 줄은 인식한 그대로 둔다.
import type { PdfChar } from "./quick.ts";

const isSpace = (c: string) => c <= " " || /\s/.test(c);

/** 한 쪽에서 맞춰 볼 칸 수의 한도 (인식한 글자 수 × 글자 층 글자 수). 넘으면 남은 줄은 인식한 그대로 둔다 */
const MAX_CELLS = 40_000_000;
/** 줄 앞뒤에서 인식이 통째로 빠뜨린 글자(보기 번호 ② 등)를 글자 층에서 되살리는 한도.
 *  번호·기호만 되살린다: 글자(한글·영문)까지 되살리면, 같은 말이 다른 줄에도 있을 때 엉뚱한 글자가 끼어들 수 있다 */
const MAX_EDGE = 3;
const isSymbol = (c: string) => !/\p{L}/u.test(c);

type Placed = { t: number; box: [number, number, number, number] | null };

export function repairWithTextLayer(ocr: PdfChar[], layer: string): PdfChar[] {
  const T = [...layer];
  const ti: number[] = []; // 글자 층에서 공백이 아닌 글자의 번호
  T.forEach((c, i) => {
    if (!isSpace(c)) ti.push(i);
  });
  const n = ti.length;
  if (!n) return ocr;
  const spaceBetween = (a: number, b: number) => ti[b] - ti[a] > 1; // 글자 층에서 두 글자 사이에 공백·줄바꿈이 있나
  const ink = ocr.filter((c) => !isSpace(c[0]));

  let cells = 0;
  let hint = 0; // 앞줄이 맞은 자리 (같은 글이 여러 번 나오면 가까운 쪽을 고른다)

  function fixLine(line: PdfChar[]): PdfChar[] | null {
    const O = line.filter((c) => !isSpace(c[0]));
    const k = O.length;
    if (k < 3) return null; // 너무 짧으면 아무 데나 맞는다
    cells += k * n;
    if (cells > MAX_CELLS) return null;
    // 글자 층의 어느 구간과 가장 비슷한가 (구간의 시작은 자유): D[i][j] = O 앞 i글자와, j에서 끝나는 구간의 가장 작은 차이
    const W = n + 1;
    const D = new Uint16Array((k + 1) * W);
    for (let i = 1; i <= k; i++) {
      D[i * W] = i;
      const oc = O[i - 1][0];
      for (let j = 1; j <= n; j++) {
        const sub = D[(i - 1) * W + j - 1] + (oc === T[ti[j - 1]] ? 0 : 1);
        const del = D[(i - 1) * W + j] + 1, ins = D[i * W + j - 1] + 1;
        D[i * W + j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
      }
    }
    let end = -1;
    for (let j = 1; j <= n; j++) {
      const d = D[k * W + j];
      if (end < 0 || d < D[k * W + end] || (d === D[k * W + end] && Math.abs(j - hint - k) < Math.abs(end - hint - k))) end = j;
    }
    if (D[k * W + end] > Math.floor(k * 0.3)) return null;
    // 거꾸로 따라가며 짝 맞추기
    const placed: Placed[] = [];
    let i = k, j = end;
    while (i > 0) {
      const here = D[i * W + j];
      if (j > 0 && here === D[(i - 1) * W + j - 1] + (O[i - 1][0] === T[ti[j - 1]] ? 0 : 1)) {
        const o = O[i - 1];
        placed.push({ t: j - 1, box: [o[1], o[2], o[3], o[4]] }); // 같은 글자, 또는 잘못 읽은 글자(①→0): 상자를 물려받는다
        i--;
        j--;
      } else if (here === D[(i - 1) * W + j] + 1) i--; // 인식이 지어낸 글자: 버린다
      else {
        placed.push({ t: j - 1, box: null }); // 인식이 빠뜨린 글자: 자리는 아래에서 이웃 사이에
        j--;
      }
    }
    placed.reverse();
    hint = end;
    const known = placed.filter((p) => p.box);
    if (!known.length) return null;
    // 사이에 낀 빠진 글자는 앞뒤 글자 사이 틈에 고르게
    for (let a = 0; a < placed.length; ) {
      if (placed[a].box) {
        a++;
        continue;
      }
      let b = a;
      while (b < placed.length && !placed[b].box) b++;
      const L = a > 0 ? placed[a - 1].box : null, R = b < placed.length ? placed[b].box : null;
      const ref = (L ?? R)!;
      const x0 = L ? L[2] : R![0], x1 = R ? Math.max(R[0], x0) : x0;
      const w = (x1 - x0) / (b - a);
      for (let q = a; q < b; q++) placed[q].box = [x0 + w * (q - a), ref[1], x0 + w * (q - a + 1), ref[3]];
      a = b;
    }
    // 줄 처음·끝에서 통째로 빠진 글자 몇 개(보기 번호 등)는 글자 층의 같은 줄에서 되살린다 — 그 자리에 다른 글자가 없을 때만
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !ink.some((c) => !line.includes(c) && (c[1] + c[3]) / 2 > x0 && (c[1] + c[3]) / 2 < x1 && (c[2] + c[4]) / 2 > y0 && (c[2] + c[4]) / 2 < y1);
    const first = placed[0], last = placed[placed.length - 1];
    const head: number[] = [];
    for (let p = ti[first.t] - 1, q = first.t - 1; p >= 0 && T[p] !== "\n"; p--) {
      if (!isSpace(T[p])) head.unshift(q--);
    }
    const symbols = (ts: number[]) => ts.length > 0 && ts.length <= MAX_EDGE && ts.every((t) => isSymbol(T[ti[t]]));
    if (symbols(head)) {
      const b = first.box!, h = b[3] - b[1];
      const add: Placed[] = [];
      let x = b[0];
      for (let q = head.length - 1; q >= 0; q--) {
        x -= spaceBetween(head[q], q + 1 < head.length ? head[q + 1] : first.t) ? h * 0.3 : 0;
        add.unshift({ t: head[q], box: [x - h * 0.9, b[1], x, b[3]] });
        x -= h * 0.9;
      }
      if (free(x, b[1], b[0], b[3])) placed.unshift(...add);
    }
    const tail: number[] = [];
    for (let p = ti[last.t] + 1, q = last.t + 1; p < T.length && T[p] !== "\n"; p++) {
      if (!isSpace(T[p])) tail.push(q++);
    }
    if (symbols(tail)) {
      const b = last.box!, h = b[3] - b[1];
      const add: Placed[] = [];
      let x = b[2];
      for (let q = 0; q < tail.length; q++) {
        x += spaceBetween(q ? tail[q - 1] : last.t, tail[q]) ? h * 0.3 : 0;
        add.push({ t: tail[q], box: [x, b[1], x + h * 0.9, b[3]] });
        x += h * 0.9;
      }
      if (free(b[2], b[1], x, b[3])) placed.push(...add);
    }
    // 글자 층 차례대로, 띄어쓰기도 글자 층대로
    const out: PdfChar[] = [];
    placed.forEach((p, q) => {
      const b = p.box!;
      if (q && spaceBetween(placed[q - 1].t, p.t)) {
        const pr = placed[q - 1].box!;
        out.push([" ", pr[2], b[1], Math.max(pr[2], b[0]), b[3]]);
      }
      out.push([T[ti[p.t]], b[0], b[1], b[2], b[3]]);
    });
    return out;
  }

  const out: PdfChar[] = [];
  let line: PdfChar[] = [];
  const flush = (nl: PdfChar | null) => {
    if (line.length) out.push(...(fixLine(line) ?? line));
    if (nl) out.push(nl);
    line = [];
  };
  for (const c of ocr) {
    if (c[0] === "\n") flush(c);
    else line.push(c);
  }
  flush(null);
  return out;
}
