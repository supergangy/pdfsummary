// 실시간 동기화 시험 (실제 브라우저 두 개 = 기기 두 대, 실제 파이썬 서버):
//  A에서 동기화 시작 → B에서 코드로 연결 → A가 만든 노트·필기가 B에 → B가 쓴 필기가 열려 있는 A 화면에 바로
//  → A가 가져온 PDF 교재도 B로.
//   npx expo export --platform web --output-dir dist-web && node e2e/sync.e2e.cjs dist-web
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..", "..");
const WEB = path.resolve(process.argv[2] || "dist-web");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sync-e2e-"));
const CODE = "e2e-access-code-123";

function fail(msg) {
  throw new Error(msg);
}

function staticServer(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".ttf": "font/ttf" };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
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

// 기기 안(IndexedDB)의 노트 파일 들여다보기
async function idb(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("pdfsummary-notes", 1);
    req.onsuccess = () => {
      const tx = req.result.transaction("files", "readonly").objectStore("files");
      const out = {};
      const cur = tx.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        out[c.key] = typeof c.value === "string" ? c.value : `<blob ${c.value.size}>`;
        c.continue();
      };
    };
    req.onerror = () => reject(req.error);
  }));
}

const strokesOf = (files) => Object.entries(files).filter(([k]) => /\/ink\//.test(k)).reduce((n, [, v]) => n + JSON.parse(v).length, 0);

async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${ms / 1000}초 안에 안 됨: ${what}`);
}

(async () => {
  const book = path.join(TMP, "book.pdf");
  execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'examples'); import make_sample as m; m.make_book_pair(sys.argv[1], sys.argv[1] + '.n.pdf')", book], { cwd: ROOT });
  const { srv, port } = await staticServer(WEB);
  const apiPort = 19300 + Math.floor(Math.random() * 500);
  const api = spawn("python3", ["-m", "pdfsummary.app", "--server", "--host", "127.0.0.1", "--port", String(apiPort), "--access-code", CODE], {
    cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: "", HOME: TMP, PDFSUMMARY_SYNC_DIR: path.join(TMP, "sync") }, stdio: "ignore",
  });
  await waitFor(`http://127.0.0.1:${apiPort}/healthz`);
  const browser = await chromium.launch();
  const errors = [];
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByText("설정", { exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByLabel("서버 주소").fill(`http://127.0.0.1:${apiPort}`);
    await page.getByLabel("접속 코드").fill(CODE);
    await page.getByText("저장하고 연결 확인").click();
    await page.getByText(/연결됐어요/).waitFor({ timeout: 10000 });
    await page.getByText("닫기").click();
    await page.getByText("‹ 노트 목록").first().click();
    return page;
  };
  let A, B;
  try {
    A = await open();
    B = await open();

    // A: 동기화 시작 → 코드
    await A.getByLabel("동기화 켜기").click();
    await A.getByText("새로 동기화 시작").click();
    const codeEl = A.getByLabel("동기화 코드", { exact: true });
    await codeEl.waitFor({ timeout: 10000 });
    const syncCode = (await codeEl.innerText()).trim();
    if (!/^[A-Z2-7]{5}(-[A-Z2-7]{5}){4}$/.test(syncCode)) fail("동기화 코드 모양이 이상함: " + syncCode);
    await A.getByText("닫기").click();
    // B: 코드로 연결
    await B.getByLabel("동기화 켜기").click();
    await B.getByLabel("동기화 코드 넣기").fill(syncCode.toLowerCase());
    await B.getByText("코드로 연결").click();
    await B.getByText(/상태:/).waitFor({ timeout: 10000 });
    await B.getByText("닫기").click();
    console.log("✓ A에서 동기화 시작, B는 코드로 연결");

    // A: 새 노트 + 필기
    await A.getByText("＋ 새 노트").click();
    await A.getByLabel("새 노트 이름").fill("동기화 노트");
    await A.getByText("만들기", { exact: true }).click();
    const canvasA = A.getByTestId("page-canvas");
    await canvasA.waitFor({ timeout: 15000 });
    await A.waitForTimeout(1200);
    const bxA = await canvasA.boundingBox();
    await A.mouse.move(bxA.x + 150, bxA.y + 200);
    await A.mouse.down();
    for (let i = 1; i <= 20; i++) await A.mouse.move(bxA.x + 150 + i * 10, bxA.y + 200 + (i % 2 ? 12 : 0), { steps: 2 });
    await A.mouse.up();
    const ms1 = await until(async () => (await B.getByLabel("동기화 노트 열기").count()) > 0 && strokesOf(await idb(B)) >= 1, 15000, "A의 노트·필기가 B에");
    console.log(`✓ A가 만든 노트와 필기가 B에 (${(ms1 / 1000).toFixed(1)}초)`);

    // B: 열어서 다른 자리에 쓰기 → 열려 있는 A 화면에 바로
    await B.getByLabel("동기화 노트 열기").click();
    const canvasB = B.getByTestId("page-canvas");
    await canvasB.waitFor({ timeout: 15000 });
    await B.waitForTimeout(1200);
    const bxB = await canvasB.boundingBox();
    await B.mouse.move(bxB.x + 150, bxB.y + 420);
    await B.mouse.down();
    for (let i = 1; i <= 20; i++) await B.mouse.move(bxB.x + 150 + i * 12, bxB.y + 420 + (i % 2 ? 14 : 0), { steps: 2 });
    await B.mouse.up();
    const ms2 = await until(async () => strokesOf(await idb(A)) >= 2, 15000, "B의 필기가 A에");
    await A.waitForTimeout(600);
    // A 화면(그림판)에 B가 쓴 자리가 실제로 그려졌는지 픽셀로
    const shot = path.join(TMP, "a.png");
    await A.screenshot({ path: shot, clip: { x: bxA.x + 140, y: bxA.y + 405, width: 260, height: 50 } });
    const dark = execFileSync("python3", ["-c", "import sys, pymupdf; p = pymupdf.Pixmap(sys.argv[1]); print(sum(1 for y in range(p.height) for x in range(p.width) if sum(p.pixel(x, y)[:3]) < 200))", shot], { encoding: "utf8" }).trim();
    if (Number(dark) < 30) fail("B가 쓴 필기가 열려 있는 A 화면에 그려지지 않음");
    console.log(`✓ B가 쓴 필기가 열려 있는 A 화면에 바로 (${(ms2 / 1000).toFixed(1)}초)`);

    // A: PDF 교재 가져오기 → B에 노트와 원본 PDF가
    await A.getByLabel("노트 목록으로").click();
    const [fc] = await Promise.all([A.waitForEvent("filechooser"), A.getByText("📄 PDF 가져오기").click()]);
    await fc.setFiles(book);
    await canvasA.waitFor({ timeout: 15000 });
    await B.getByLabel("노트 목록으로").click();
    const ms3 = await until(async () => {
      const files = await idb(B);
      return Object.entries(files).some(([k, v]) => k.endsWith("/source.pdf") && /^<blob [1-9]/.test(v));
    }, 20000, "A가 가져온 PDF가 B에");
    await B.getByLabel("book 열기").waitFor({ timeout: 5000 });
    console.log(`✓ A가 가져온 PDF 교재가 원본 파일째 B에 (${(ms3 / 1000).toFixed(1)}초)`);
    if (errors.length) fail("페이지 오류: " + errors.join(" | "));
  } catch (e) {
    for (const [n, p] of [["A", A], ["B", B]]) if (p) await p.screenshot({ path: path.join(TMP, `failure-${n}.png`) }).catch(() => {});
    console.error("✗ " + e.message, `\n(화면: ${TMP}/failure-A.png, failure-B.png)`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    api.kill();
  }
})();
