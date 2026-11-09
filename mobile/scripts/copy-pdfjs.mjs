// 웹판에서 PDF를 그릴 pdf.js를 public/pdfjs 로 복사한다 (번들에 넣지 않고 그대로 불러 씀).
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "legacy", "build");
const dst = join(root, "public", "pdfjs");
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) copyFileSync(join(src, f), join(dst, f));
  // 글꼴을 넣지 않은 한글 PDF(교재에 흔함)를 그리려면 CMap과 기본 글꼴 자료가 필요하다
  const base = join(root, "node_modules", "pdfjs-dist");
  for (const d of ["cmaps", "standard_fonts"]) cpSync(join(base, d), join(dst, d), { recursive: true });
}
