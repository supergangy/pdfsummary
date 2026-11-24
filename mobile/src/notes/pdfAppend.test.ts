// 큰 PDF 내보내기(원본 그대로 + 필기를 덧붙여 저장): PyMuPDF로 열어 쪽·필기·원래 글이 맞는지 확인
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { pdfNotebook, makeImage, type Notebook, type Stroke } from "./model.ts";
import { appendInk, bytesReader } from "./pdfAppend.ts";

const dir = mkdtempSync(join(tmpdir(), "append-"));
let n = 0;
const save = (b: Uint8Array) => {
  const f = join(dir, `x${n++}.pdf`);
  writeFileSync(f, b);
  return f;
};

/** 원본 + 덧붙인 것 → PyMuPDF가 본 쪽마다 [글, 크기, 점들이 칠해졌는지] */
function inspect(pdf: Uint8Array, probes: [number, number, number][] = []) {
  const py = `
import sys, json, pymupdf
doc = pymupdf.open(sys.argv[1])
pages = []
for p in doc:
    pages.append([p.get_text().strip(), [round(p.rect.width), round(p.rect.height)]])
hits = []
for i, x, y in json.loads(sys.argv[2]):
    pix = doc[i].get_pixmap(dpi=72, alpha=False)
    dark = False
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            c = pix.pixel(min(max(int(x)+dx,0),pix.width-1), min(max(int(y)+dy,0),pix.height-1))
            if sum(c) < 600: dark = True
    hits.append(dark)
print(json.dumps([pages, hits, doc.is_repaired]))
`;
  const out = execFileSync("python3", ["-c", py, save(pdf), JSON.stringify(probes)], { encoding: "utf8" });
  const [pages, hits, repaired] = JSON.parse(out) as [[string, number[]][], boolean[], boolean];
  return { pages, hits, repaired };
}

const line = (id: string, x0: number, y0: number, x1: number, y1: number): Stroke => ({
  id, tool: "pen", color: "#000000", width: 3, pts: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5],
});

async function source(objectStreams: boolean, rotateSecond = false): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([400, 600]);
    p.drawText(`page ${i + 1} text`, { x: 40, y: 540, size: 18, font: f });
    if (rotateSecond && i === 1) p.setRotation(degrees(90));
  }
  return d.save({ useObjectStreams: objectStreams });
}

async function joined(src: Uint8Array, nb: Notebook, ink: Record<string, Stroke[]>) {
  const { tail, bytesRead } = await appendInk(bytesReader(src), nb, ink);
  const out = new Uint8Array(src.length + tail.length);
  out.set(src, 0);
  out.set(tail, src.length);
  // 원본 바이트는 하나도 바뀌지 않는다
  assert.deepEqual(out.subarray(0, src.length), src);
  return { out, bytesRead };
}

for (const objectStreams of [false, true]) {
  test(`덧붙여 저장 (${objectStreams ? "압축 목차·개체 묶음" : "옛 방식 목차"}): 필기한 쪽에만 필기, 원래 글은 그대로`, async () => {
    const src = await source(objectStreams);
    const nb = pdfNotebook("책", [{ w: 400, h: 600 }, { w: 400, h: 600 }, { w: 400, h: 600 }]);
    // 필기한 쪽이 여럿 (2쪽·3쪽)
    const { out } = await joined(src, nb, { [nb.pages[1].id]: [line("a", 50, 300, 350, 300)], [nb.pages[2].id]: [line("b", 50, 200, 350, 200)] });
    const r = inspect(out, [[1, 200, 300], [1, 200, 400], [0, 200, 300], [2, 200, 200]]);
    assert.equal(r.repaired, false, "고칠 필요 없이 바로 열린다");
    assert.deepEqual(r.pages.map((p) => p[0]), ["page 1 text", "page 2 text", "page 3 text"]);
    assert.deepEqual(r.hits, [true, false, false, true]);
  });
}

test("덧붙여 저장: 돌린 원본 쪽에도 화면에서 그은 자리에", async () => {
  const src = await source(true, true);
  const nb = pdfNotebook("책", [{ w: 400, h: 600 }, { w: 600, h: 400 }, { w: 400, h: 600 }]);
  const { out } = await joined(src, nb, { [nb.pages[1].id]: [line("a", 50, 50, 250, 50)] });
  const r = inspect(out, [[1, 150, 50], [1, 150, 300], [1, 500, 50]]);
  assert.deepEqual(r.pages[1][1], [600, 400]);
  assert.deepEqual(r.hits, [true, false, false]);
});

test("덧붙여 저장: 노트에서 쪽 순서를 바꾸고 빈 쪽을 끼우고 같은 쪽을 두 번 써도 그 차례로", async () => {
  const src = await source(false);
  const nb = pdfNotebook("책", [{ w: 400, h: 600 }, { w: 400, h: 600 }, { w: 400, h: 600 }]);
  const [p1, , p3] = nb.pages;
  const blank = { id: "blank", w: 300, h: 300, paper: "lined" as const };
  const again = { ...p1, id: "again" };
  nb.pages = [p3, blank, p1, again]; // 2쪽은 뺐다
  const { out } = await joined(src, nb, { blank: [line("b", 50, 150, 250, 150)], [p1.id]: [line("c", 50, 300, 350, 300)] });
  const r = inspect(out, [[1, 150, 150], [2, 200, 300], [3, 200, 300]]);
  assert.deepEqual(r.pages.map((p) => p[0]), ["page 3 text", "", "page 1 text", "page 1 text"]);
  assert.deepEqual(r.pages[1][1], [300, 300]);
  assert.deepEqual(r.hits, [true, true, false], "필기는 그 노트 쪽에만 (같은 원본 쪽을 다시 쓴 쪽에는 없다)");
});

test("덧붙여 저장: 쪽이 물려받는 속성(크기·자원)이 쪽 목록에만 있어도", async () => {
  // 손으로 만든 PDF: MediaBox·Resources가 Pages에만 있다
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const streams = ["BT /F1 14 Tf 30 350 Td (first) Tj ET", "BT /F1 14 Tf 30 350 Td (second) Tj ET"];
  let s = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  streams.forEach((t, i) => {
    offs.push(s.length);
    s += `${objs.length + i + 1} 0 obj\n<< /Length ${t.length} >>\nstream\n${t}\nendstream\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${offs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  s += `trailer\n<< /Size ${offs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const src = new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const nb = pdfNotebook("손", [{ w: 300, h: 400 }, { w: 300, h: 400 }]);
  nb.pages = [nb.pages[1], nb.pages[0]]; // 순서를 바꿔 쪽 목록을 새로 만들게
  const { out } = await joined(src, nb, { [nb.pages[0].id]: [line("a", 30, 200, 270, 200)] });
  const r = inspect(out, [[0, 150, 200], [1, 150, 200]]);
  assert.deepEqual(r.pages.map((p) => p[0]), ["second", "first"], "물려받던 글꼴로 원래 글이 그대로 보인다");
  assert.deepEqual(r.pages.map((p) => p[1]), [[300, 400], [300, 400]]);
  assert.deepEqual(r.hits, [true, false]);
});

test("덧붙여 저장: 큰 원본도 조금만 읽는다 (사진·글상자·형광펜 포함)", async () => {
  const d = await PDFDocument.create();
  // 무작위 그림이 든 쪽 4개 → 원본이 수 MB
  for (let i = 0; i < 4; i++) {
    const p = d.addPage([500, 700]);
    const px = new Uint8Array(500 * 500 * 3);
    for (let k = 0; k < px.length; k++) px[k] = (k * 2654435761 + i) >>> 24;
    const png = await import("node:zlib");
    void png;
    p.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  }
  const big = new Uint8Array(4 * 1024 * 1024);
  for (let k = 0; k < big.length; k++) big[k] = (k * 2654435761) >>> 24;
  // 큰 덩어리를 실제 개체로 넣는다 (쪽에서는 쓰지 않는 그림 스트림)
  d.context.register(d.context.stream(big));
  const src = await d.save({ useObjectStreams: true });
  const font = new Uint8Array(readFileSync(new URL("../../assets/fonts/NanumGothic-Regular.ttf", import.meta.url)));
  const nb = pdfNotebook("큰 책", [0, 1, 2, 3].map(() => ({ w: 500, h: 700 })));
  const pid = nb.pages[2].id;
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAADklEQVR4nGNgGAUMJAMAATYAAayrjKgAAAAASUVORK5CYII=";
  const ink = {
    [pid]: [
      line("a", 50, 400, 450, 400),
      { id: "h", tool: "highlighter", color: "#FFE14D", width: 14, pts: [50, 500, 0.5, 450, 500, 0.5] } as Stroke,
      { id: "t", tool: "text", color: "#1F2328", width: 16, pts: [60, 100, 0, 400, 140, 0], text: "덧붙인 글상자" } as Stroke,
      { ...makeImage("i", 300, 200, 60, 60, PNG), rot: 45 },
    ],
  };
  const { tail, bytesRead } = await appendInk(bytesReader(src), nb, ink, font);
  assert.ok(bytesRead < 300_000, `원본 ${src.length}바이트 중 ${bytesRead}바이트만 읽는다`);
  const out = new Uint8Array(src.length + tail.length);
  out.set(src, 0);
  out.set(tail, src.length);
  const r = inspect(out, [[2, 250, 400], [2, 330, 230], [1, 250, 400]]);
  assert.equal(r.pages.length, 4);
  assert.match(r.pages[2][0], /덧붙인 글상자/);
  assert.deepEqual(r.hits, [true, true, false]);
});
