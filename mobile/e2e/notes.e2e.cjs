// 필기 앱 웹판 시험 (실제 브라우저): 새 노트 → 펜·형광펜·지우개·되돌리기 → 다시 열어도 남는지 → PDF 내보내기,
// PDF 가져오기 → 형광펜 → 요약(실제 파이썬 서버) → 결과에 칠한 말이 있는지.
//   npx expo export --platform web --output-dir dist-web && node e2e/notes.e2e.cjs dist-web
// 필요: 저장소 루트에 pip install . (파이썬 서버), playwright(chromium)
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..", "..");
const WEB = path.resolve(process.argv[2] || "dist-web");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "notes-e2e-"));
const CODE = "e2e-access-code-123";
const procs = [];

function fail(msg) {
  console.error("✗ " + msg);
  process.exitCode = 1;
  throw new Error(msg);
}

function staticServer(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".ico": "image/x-icon" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port })));
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      await new Promise((ok, no) => http.get(url, (r) => (r.resume(), ok())).on("error", no));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  fail("server did not start: " + url);
}

(async () => {
  // 책 PDF와 칠할 글자 자리
  const book = path.join(TMP, "book.pdf");
  const info = JSON.parse(execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'examples'); import make_sample, pymupdf
make_sample.make_book_pair(sys.argv[1], sys.argv[1] + '.notes.pdf')
p = pymupdf.open(sys.argv[1])[0]; r = p.search_for('경쟁적 저해제')[0]
print(json.dumps({'w': p.rect.width, 'h': p.rect.height, 'r': [r.x0, r.y0, r.x1, r.y1]}))`, book], { cwd: ROOT, encoding: "utf8" }));

  const { srv, port } = await staticServer(WEB);
  const apiPort = 18800 + Math.floor(Math.random() * 500);
  const api = spawn("python3", ["-m", "pdfsummary.app", "--server", "--host", "127.0.0.1", "--port", String(apiPort), "--access-code", CODE], {
    cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: "", HOME: TMP }, stdio: "ignore",
  });
  procs.push(api);
  await waitFor(`http://127.0.0.1:${apiPort}/healthz`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}/`);

    // ── 빈 노트에 쓰기 ──
    await page.getByText("＋ 새 노트").click();
    await page.getByLabel("새 노트 이름").fill("시험 노트");
    await page.getByText("만들기", { exact: true }).click();
    const canvas = page.getByTestId("page-canvas");
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const box = await canvas.boundingBox();
    const x0 = box.x + 150, y0 = box.y + 200;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + i * 10, y0 + (i % 2 ? 15 : 0), { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    if (await page.getByLabel("되돌리기").isDisabled()) fail("펜 획이 기록되지 않음");
    await page.getByText("⌫ 지우개").click();
    await page.mouse.move(x0 + 100, y0 - 30);
    await page.mouse.down();
    await page.mouse.move(x0 + 100, y0 + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.getByLabel("되돌리기").click(); // 지운 것 되살리기
    await page.waitForTimeout(400);
    await page.getByText("✒️ 펜").click();
    await page.getByLabel("노트 목록으로").click();
    await page.getByLabel("시험 노트 열기").click();
    await canvas.waitFor();
    await page.waitForTimeout(1000);
    await page.getByLabel("더 보기").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByText("📄 PDF로 내보내기 (필기 포함)").click()]);
    const out = path.join(TMP, "export.pdf");
    await dl.saveAs(out);
    const drawn = execFileSync("python3", ["-c", "import sys, pymupdf; print(len(pymupdf.open(sys.argv[1])[0].get_drawings()))", out], { encoding: "utf8" }).trim();
    if (Number(drawn) < 1) fail("내보낸 PDF에 획이 없음 (다시 열었을 때 저장이 안 됐거나 내보내기 실패)");
    console.log("✓ 빈 노트: 쓰기·지우기·되돌리기·저장·PDF 내보내기");
    await page.getByLabel("노트 목록으로").click();

    // ── 서버 설정 ──
    await page.getByText("설정", { exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByLabel("서버 주소").fill(`http://127.0.0.1:${apiPort}`);
    await page.getByLabel("접속 코드").fill(CODE);
    await page.getByText("저장하고 연결 확인").click();
    await page.getByText(/연결됐어요/).waitFor({ timeout: 10000 });
    await page.getByText("닫기").click();
    await page.getByText("‹ 노트 목록").first().click();

    // ── PDF 가져와서 형광펜 → 요약 ──
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("📄 PDF 가져오기").click()]);
    await fc.setFiles(book);
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const b2 = await canvas.boundingBox();
    const s = Math.min((b2.width - 24) / info.w, 6);
    const tx = 12 + Math.max(0, (b2.width - 24 - info.w * s) / 2), ty = 12;
    const [rx0, ry0, rx1, ry1] = info.r;
    const yy = b2.y + ty + ((ry0 + ry1) / 2) * s;
    await page.getByText("🖍 형광펜").click();
    await page.mouse.move(b2.x + tx + rx0 * s, yy);
    await page.mouse.down();
    await page.mouse.move(b2.x + tx + rx1 * s, yy + 1, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.getByLabel("요약 만들기").click();
    await page.getByText(/“경쟁적 저해제”/).waitFor({ timeout: 30000 });
    if (await page.getByText(/기질 특이성/).count()) fail("책에 인쇄된 강조가 내 형광펜 색으로 잡힘");
    await page.getByText("요약 만들기", { exact: true }).click();
    await page.getByText("공유 (HTML)").waitFor({ timeout: 90000 });
    await page.waitForTimeout(1000);
    let found = false;
    for (const f of page.frames()) {
      try {
        if ((await f.content()).includes("경쟁적 저해제")) found = true;
      } catch {}
    }
    if (!found) fail("요약 결과에 칠한 글자가 없음");
    console.log("✓ PDF 노트: 형광펜 → 요약 결과에 '경쟁적 저해제'");
    if (errors.length) fail("페이지 오류: " + errors.join(" | "));
  } catch (e) {
    await page.screenshot({ path: path.join(TMP, "failure.png") }).catch(() => {});
    console.error(e.message, "\n(화면: " + path.join(TMP, "failure.png") + ")");
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    for (const p of procs) p.kill();
  }
})();
