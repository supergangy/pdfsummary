// PDF 내보내기: 획이 화면에서 그은 자리에 그려지는지 (회전된 쪽 포함) — 파이썬(PyMuPDF)으로 그림을 그려 확인
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import { buildPdf, toUser } from "./exportPdf.ts";
import { blankNotebook, pdfNotebook, type Stroke } from "./model.ts";

test("toUser maps screen corners for every rotation", () => {
  const crop = { x: 10, y: 20, width: 200, height: 300 };
  assert.deepEqual(toUser(0, 0, crop, 0), [10, 320]); // 왼쪽 위
  // 90도: 화면 폭 = 300, 높이 = 200
  assert.deepEqual(toUser(0, 0, crop, 90), [10, 20]);
  assert.deepEqual(toUser(0, 0, crop, 180), [210, 20]);
  assert.deepEqual(toUser(0, 0, crop, 270), [210, 320]);
});

// PyMuPDF로 쪽을 그려 (x, y) 주변이 칠해졌는지 본다 (쪽 좌표 = 화면 좌표)
function inkAt(pdf: Uint8Array, page: number, pts: [number, number][]): boolean[] {
  const dir = mkdtempSync(join(tmpdir(), "nb-"));
  const f = join(dir, "x.pdf");
  writeFileSync(f, pdf);
  const py = `
import sys, json, pymupdf
doc = pymupdf.open(sys.argv[1]); p = doc[int(sys.argv[2])]
pix = p.get_pixmap(dpi=72, alpha=False)
out = []
for x, y in json.loads(sys.argv[3]):
    dark = False
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            c = pix.pixel(min(max(int(x)+dx,0),pix.width-1), min(max(int(y)+dy,0),pix.height-1))
            if sum(c) < 600: dark = True
    out.append(dark)
print(json.dumps([out, [p.rect.width, p.rect.height]]))
`;
  const res = execFileSync("python3", ["-c", py, f, String(page), JSON.stringify(pts)], { encoding: "utf8" });
  return JSON.parse(res)[0];
}

const line = (id: string, x0: number, y0: number, x1: number, y1: number): Stroke => ({
  id, tool: "pen", color: "#000000", width: 3, pts: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5],
});

test("blank notebook: strokes land where they were drawn", async () => {
  const nb = blankNotebook("빈 노트", "plain", 1);
  const p = nb.pages[0];
  const pdf = await buildPdf(nb, { [p.id]: [line("a", 100, 100, 300, 100)] }, null);
  const hit = inkAt(pdf, 0, [[200, 100], [200, 400]]);
  assert.deepEqual(hit, [true, false]);
});

test("rotated source page: strokes still land on the displayed spot", async () => {
  const src = await PDFDocument.create();
  const pg = src.addPage([400, 600]);
  pg.setRotation(degrees(90)); // 화면에서는 600 x 400
  const bytes = await src.save();
  const nb = pdfNotebook("돌린 쪽", [{ w: 600, h: 400 }]);
  const pid = nb.pages[0].id;
  const pdf = await buildPdf(nb, { [pid]: [line("a", 50, 50, 250, 50)] }, bytes);
  const hit = inkAt(pdf, 0, [[150, 50], [150, 300], [500, 50]]);
  assert.deepEqual(hit, [true, false, false]);
});

test("highlighter is translucent (text under it stays readable)", async () => {
  const nb = blankNotebook("형광", "plain", 1);
  const p = nb.pages[0];
  const s: Stroke = { id: "h", tool: "highlighter", color: "#FFE14D", width: 14, pts: [100, 100, 0.5, 300, 100, 0.5] };
  const pdf = await buildPdf(nb, { [p.id]: [s] }, null);
  // 노랑 반투명은 '어두운 칠'로 잡히지 않는다
  assert.deepEqual(inkAt(pdf, 0, [[200, 100]]), [false]);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
});

test("text boxes are written with the Korean font (and wrap inside the box)", async () => {
  const { readFileSync } = await import("node:fs");
  const font = new Uint8Array(readFileSync(new URL("../../assets/fonts/NanumGothic-Regular.ttf", import.meta.url)));
  const { makeTextBox } = await import("./model.ts");
  const nb = blankNotebook("글상자", "plain", 1);
  const p = nb.pages[0];
  const box = makeTextBox("t", 100, 100, "효소는 생체 촉매이다\n두 번째 줄 ABC", 16, "#1E4FD8", p.w);
  const pdf = await buildPdf(nb, { [p.id]: [box] }, null, font);
  const dir = mkdtempSync(join(tmpdir(), "nb-"));
  const f = join(dir, "t.pdf");
  writeFileSync(f, pdf);
  const out = execFileSync("python3", ["-c", `
import sys, pymupdf
p = pymupdf.open(sys.argv[1])[0]
for b in p.get_text("words"): print(round(b[0]), round(b[1]), b[4])`, f], { encoding: "utf8" });
  assert.match(out, /효소는/);
  assert.match(out, /ABC/);
  const first = out.split("\n").find((l) => l.includes("효소는"))!.split(" ").map(Number);
  assert.ok(Math.abs(first[0] - 100) < 3 && first[1] >= 99 && first[1] < 120, out);
  // 글꼴을 통째로 넣으므로 0.7MB쯤 (쓴 글자만 넣으면 글자 모양이 빠져서 그렇게 하지 않는다)
  assert.ok(pdf.length < 1_500_000, `PDF ${pdf.length}바이트`);
});

// 파이썬 없이 확인: 내보낸 PDF 안의 글꼴에서 쓴 글자의 모양이 원래 글꼴과 똑같은지.
// ('쓴 글자만 넣기'를 켜면 글자 정보는 남는데 눈에 보이는 모양이 빠져서, 글이 대부분 안 보였다)
test("text boxes keep every glyph shape in the exported PDF", async () => {
  const { readFileSync } = await import("node:fs");
  const fontBytes = new Uint8Array(readFileSync(new URL("../../assets/fonts/NanumGothic-Regular.ttf", import.meta.url)));
  const nb = blankNotebook("글상자", "plain", 1);
  const p = nb.pages[0];
  const texts = ["둘째 쪽 글상자만", "내일 시험 범위는 3단원", "Enzyme note 123"];
  const boxes: Stroke[] = texts.map((text, i) => ({ id: "t" + i, tool: "text", color: "#1F2328", width: 16, pts: [60, 100 + i * 60, 0, 380, 122 + i * 60, 0], text }));
  const pdf = await buildPdf(nb, { [p.id]: boxes }, null, fontBytes);

  // PDF 안의 글꼴 파일과 쪽 내용(그리기 명령)을 꺼낸다
  const doc = await PDFDocument.load(pdf);
  let embedded: Uint8Array | null = null;
  let content = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.has(PDFName.of("FontFile2"))) {
      embedded = decodePDFRawStream(doc.context.lookup(obj.get(PDFName.of("FontFile2")), PDFRawStream)).decode();
    }
  }
  const body = doc.getPage(0).node.Contents();
  const streams = body instanceof PDFArray ? body.asArray().map((r) => doc.context.lookup(r, PDFRawStream)) : [body as PDFRawStream];
  for (const s of streams) content += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
  assert.ok(embedded, "PDF 안에 글꼴 파일이 있어야 함");

  const orig = fontkit.create(Buffer.from(fontBytes) as never);
  const got = fontkit.create(Buffer.from(embedded) as never);
  for (const text of texts) {
    const glyphs = orig.layout(text).glyphs;
    // 쪽에는 글자가 '글꼴 안의 글자 번호'로 적힌다 → 그 번호의 모양이 넣은 글꼴에 그대로 있어야 한다
    const code = glyphs.map((g) => g.id.toString(16).toUpperCase().padStart(4, "0")).join("");
    assert.ok(content.includes(`<${code}>`), `'${text}'의 글자 번호가 쪽에 그대로 적혀 있어야 함`);
    for (const g of glyphs) {
      assert.equal(got.getGlyph(g.id).path.toSVG(), g.path.toSVG(), `'${text}'의 글자 모양(번호 ${g.id})`);
    }
    assert.ok([...text].some((c, i) => c !== " " && glyphs[i].path.commands.length > 0), "빈 모양이 아님");
  }
});
