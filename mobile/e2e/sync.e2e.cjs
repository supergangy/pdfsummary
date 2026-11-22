// 실시간 동기화 시험 (실제 브라우저 = 기기, 실제 파이썬 서버):
//  A에서 동기화 시작 → B에서 코드로 연결 → A가 만든 노트·필기가 B에 → B가 쓴 필기가 열려 있는 A 화면에 바로
//  → A가 가져온 PDF 교재도 B로.
//  계정: A가 코드를 계정으로 옮김 (가입 확인 메일 코드) → 새 기기 C가 이메일·비밀번호로 로그인 (틀린 비밀번호는 거절) → 노트·PDF를 받음
//  → C의 필기가 코드로 쓰는 B에 → A가 C를 로그아웃시킴 → 그동안 C에서 쓴 필기는 다시 로그인하면 B에.
//  비밀번호 찾기: 새 기기 D에서 메일로 받은 6자리 코드로 새 비밀번호 → 바로 로그인, 노트를 받음 (메일은 폴더로).
//  Google 로그인: 새 기기 E에서 'Google로 계속하기' → 같은 이메일의 계정에 이어져 노트를 받음
//   (Google 대신 시험용 RSA 키로 서명한 ID 토큰과, 그 공개 키를 내주는 작은 서버. 서버는 실제와 같은 방법으로 서명을 확인)
//   npx expo export --platform web --output-dir dist-web && node e2e/sync.e2e.cjs dist-web
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

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

// E2E_SHOTS=폴더 를 주면 동기화 창의 단계별 화면을 저장한다 (디자인 확인용)
async function stepShot(page, name) {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(process.env.E2E_SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`) });
}

async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${ms / 1000}초 안에 안 됨: ${what}`);
}

// 서버가 폴더에 남긴 메일(.eml) 중 n번째 이후의 마지막 것 → 그 안의 6자리 코드
const MAIL_DIR = path.join(TMP, "mail");

// ── 시험용 Google: RSA 키, 공개 키(JWKS), ID 토큰 ──
const GOOGLE_WEB = "e2e-web.apps.googleusercontent.com";
const gkey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...gkey.publicKey.export({ format: "jwk" }), kid: "e2e-key", alg: "RS256", use: "sig" }] };
function googleIdToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "RS256", kid: "e2e-key", typ: "JWT" });
  const p = b({ iss: "https://accounts.google.com", aud: GOOGLE_WEB, iat: now, exp: now + 3600, email_verified: true, ...claims });
  return `${h}.${p}.${crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), gkey.privateKey).toString("base64url")}`;
}
// 웹 앱이 불러오는 Google 로그인 스크립트 대신: 버튼을 누르면 위 토큰을 돌려준다
const FAKE_GIS = `window.google = { accounts: { id: {
  initialize(o) { window.__gis = o; },
  renderButton(el) {
    const b = document.createElement("button");
    b.textContent = "Google로 계속하기 (시험)";
    b.setAttribute("aria-label", "시험 Google 버튼");
    b.onclick = () => window.__gis.callback({ credential: window.__googleToken });
    el.appendChild(b);
  } } } };`;
async function mailCode(to, n, what) {
  let code = "";
  await until(async () => {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(".eml")).sort() : [];
    if (files.length < n) return false;
    const out = execFileSync("python3", ["-c", "import sys, email, email.policy; m = email.message_from_bytes(open(sys.argv[1], 'rb').read(), policy=email.policy.default); print(m['To']); print(m['Subject']); print(m.get_content())", path.join(MAIL_DIR, files[files.length - 1])], { encoding: "utf8" });
    if (!out.startsWith(to)) fail("메일 받는 사람이 다름: " + out.split("\n")[0]);
    if (!out.includes(what)) fail(`'${what}' 메일이 아님: ` + out.split("\n")[1]);
    code = (out.match(/코드: (\d{6})/) || [])[1] || "";
    return !!code;
  }, 10000, `${what} 메일이 옴`);
  return code;
}

(async () => {
  const book = path.join(TMP, "book.pdf");
  execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'examples'); import make_sample as m; m.make_book_pair(sys.argv[1], sys.argv[1] + '.n.pdf')", book], { cwd: ROOT });
  const { srv, port } = await staticServer(WEB);
  const jw = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" });
    res.end(JSON.stringify(jwks));
  });
  await new Promise((r) => jw.listen(0, "127.0.0.1", r));
  const apiPort = 19300 + Math.floor(Math.random() * 500);
  const api = spawn("python3", ["-m", "pdfsummary.app", "--server", "--host", "127.0.0.1", "--port", String(apiPort), "--access-code", CODE], {
    cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: "", HOME: TMP, PDFSUMMARY_SYNC_DIR: path.join(TMP, "sync"), PDFSUMMARY_MAIL_DIR: MAIL_DIR,
      PDFSUMMARY_GOOGLE_WEB_CLIENT_ID: GOOGLE_WEB, PDFSUMMARY_GOOGLE_JWKS_URL: `http://127.0.0.1:${jw.address().port}/certs` }, stdio: "ignore",
  });
  await waitFor(`http://127.0.0.1:${apiPort}/healthz`);
  const browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    // 시험 중에는 진짜 Google 스크립트를 부르지 않는다 (E만 시험용 Google)
    await ctx.route("https://accounts.google.com/**", (r) => r.abort());
    if (opts.google) await ctx.addInitScript(FAKE_GIS);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
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
  let A, B, C, D, E;
  try {
    A = await open();
    B = await open();

    // A: 동기화 시작 → 코드
    await A.getByLabel("동기화 켜기").click();
    await stepShot(A, "sync-1-start");
    await A.getByText("계정 없이 코드로").click();
    await stepShot(A, "sync-2-code-choice");
    await A.getByText("새로 동기화 시작").click();
    const codeEl = A.getByLabel("동기화 코드", { exact: true });
    await codeEl.waitFor({ timeout: 10000 });
    await stepShot(A, "sync-3-code-on");
    const syncCode = (await codeEl.innerText()).trim();
    if (!/^[A-Z2-7]{5}(-[A-Z2-7]{5}){4}$/.test(syncCode)) fail("동기화 코드 모양이 이상함: " + syncCode);
    await A.getByText("닫기").click();
    // B: 코드로 연결
    await B.getByLabel("동기화 켜기").click();
    await B.getByText("계정 없이 코드로").click();
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
    const [fc] = await Promise.all([A.waitForEvent("filechooser"), A.getByText("PDF 가져오기").click()]);
    await fc.setFiles(book);
    await canvasA.waitFor({ timeout: 15000 });
    await B.getByLabel("노트 목록으로").click();
    const ms3 = await until(async () => {
      const files = await idb(B);
      return Object.entries(files).some(([k, v]) => k.endsWith("/source.pdf") && /^<blob [1-9]/.test(v));
    }, 20000, "A가 가져온 PDF가 B에");
    await B.getByLabel("book 열기").waitFor({ timeout: 5000 });
    console.log(`✓ A가 가져온 PDF 교재가 원본 파일째 B에 (${(ms3 / 1000).toFixed(1)}초)`);

    // ── 계정 ──
    const EMAIL = "e2e@example.com", PW = "e2e-password-1";
    await A.getByLabel("노트 목록으로").click();
    await A.getByLabel(/^동기화: /).click();
    await A.getByLabel("계정 이메일").fill(EMAIL);
    await A.getByLabel("계정 비밀번호").fill(PW);
    await A.getByText("계정 만들고 옮기기").click();
    await A.getByText(/6자리 확인 코드를 보냈어요/).waitFor({ timeout: 10000 });
    await stepShot(A, "sync-4-signup-code");
    const signupCode = await mailCode(EMAIL, 1, "가입 확인");
    await A.getByLabel("메일로 받은 코드").fill(signupCode === "000000" ? "111111" : "000000");
    await A.getByText("확인하고 계정으로 옮기기").click();
    await A.getByText(/코드가 맞지 않거나/).waitFor({ timeout: 10000 });
    await A.getByLabel("메일로 받은 코드").fill(signupCode);
    await A.getByText("확인하고 계정으로 옮기기").click();
    await A.getByLabel("로그인한 계정").waitFor({ timeout: 10000 });
    await A.getByText("닫기").click();
    console.log("✓ A: 이메일 확인 코드(틀린 코드는 거절)로 가입하며 동기화 코드를 계정으로 옮김");

    C = await open();
    await C.getByLabel("동기화 켜기").click();
    await C.getByLabel("계정 이메일").fill(EMAIL);
    await C.getByLabel("계정 비밀번호").fill("wrong-password");
    await C.getByRole("button", { name: "로그인", exact: true }).click();
    await C.getByText("이메일이나 비밀번호가 맞지 않아요.").waitFor({ timeout: 10000 });
    await C.getByLabel("계정 비밀번호").fill(PW);
    await C.getByRole("button", { name: "로그인", exact: true }).click();
    await C.getByLabel("로그인한 계정").waitFor({ timeout: 15000 });
    await C.getByText("(이 기기)").waitFor({ timeout: 5000 });
    await stepShot(C, "sync-5-account");
    await C.getByText("닫기").click();
    const ms4 = await until(async () => {
      const files = await idb(C);
      return (await C.getByLabel("동기화 노트 열기").count()) > 0 && strokesOf(files) >= 2 &&
        Object.entries(files).some(([k, v]) => k.endsWith("/source.pdf") && /^<blob [1-9]/.test(v));
    }, 20000, "C가 로그인하자 노트·필기·PDF가");
    console.log(`✓ 틀린 비밀번호는 거절, 맞는 비밀번호로 C 로그인 → 노트·필기·PDF가 C에 (${(ms4 / 1000).toFixed(1)}초)`);

    const draw = async (P, y) => {
      const cv = P.getByTestId("page-canvas");
      const bx = await cv.boundingBox();
      await P.mouse.move(bx.x + 150, bx.y + y);
      await P.mouse.down();
      for (let i = 1; i <= 15; i++) await P.mouse.move(bx.x + 150 + i * 10, bx.y + y + (i % 2 ? 10 : 0), { steps: 2 });
      await P.mouse.up();
    };
    await C.getByLabel("동기화 노트 열기").click();
    await C.getByTestId("page-canvas").waitFor({ timeout: 15000 });
    await C.waitForTimeout(1200);
    await draw(C, 300);
    await until(async () => strokesOf(await idb(B)) >= 3, 15000, "계정으로 쓴 C의 필기가 코드로 쓰는 B에");
    console.log("✓ 계정으로 로그인한 C의 필기가 코드로 연결된 B에도");

    // A가 C를 로그아웃시킨다 (잃어버린 기기)
    await A.getByLabel(/^동기화: /).click();
    await A.getByLabel(/로그아웃시키기$/).click();
    await until(async () => (await A.getByLabel(/로그아웃시키기$/).count()) === 0, 10000, "C가 목록에서 사라짐");
    await A.getByText("닫기").click();
    // 그동안 C에서 쓴 필기 → 보내지 못하고 '로그인이 끝남'
    await draw(C, 520);
    await C.getByLabel("노트 목록으로").click();
    await C.getByLabel(/^동기화: /).click();
    await C.getByText(/계정의 로그인이 끝났어요/).waitFor({ timeout: 15000 });
    if (strokesOf(await idb(B)) !== 3) fail("로그아웃된 C의 필기가 서버로 감");
    await C.getByLabel("계정 비밀번호").fill(PW);
    await C.getByRole("button", { name: "다시 로그인" }).click();
    await C.getByLabel("로그인한 계정").waitFor({ timeout: 15000 });
    await until(async () => strokesOf(await idb(B)) >= 4, 15000, "다시 로그인한 C가 그동안 쓴 필기를 보냄");
    console.log("✓ A가 C를 로그아웃시키면 C는 멈추고, 다시 로그인하면 그동안 쓴 필기를 이어서 보냄");

    // 비밀번호 찾기 (새 기기 D)
    D = await open();
    await D.getByLabel("동기화 켜기").click();
    await D.getByText("비밀번호를 잊었어요").click();
    await D.getByLabel("계정 이메일").fill(EMAIL);
    await D.getByText("코드 메일 받기").click();
    await D.getByText(/6자리 코드를 보냈어요/).waitFor({ timeout: 10000 });
    const code = await mailCode(EMAIL, 2, "비밀번호 찾기");
    await D.getByLabel("메일로 받은 코드").fill(code);
    await D.getByLabel("새 비밀번호", { exact: true }).fill("e2e-new-password");
    await D.getByText("새 비밀번호로 로그인").click();
    await D.getByLabel("로그인한 계정").waitFor({ timeout: 15000 });
    await D.getByText("닫기").click();
    await until(async () => (await D.getByLabel("동기화 노트 열기").count()) > 0 && strokesOf(await idb(D)) >= 4, 20000, "비밀번호를 새로 정한 D에 노트가");
    console.log("✓ 비밀번호 찾기: 메일로 받은 코드로 새 비밀번호 → D 로그인, 노트를 받음");

    // Google 로그인 (새 기기 E): 같은 이메일(확인된 계정) → 그 계정에 Google이 이어짐
    E = await open({ google: true });
    await E.getByLabel("동기화 켜기").click();
    await E.getByLabel("시험 Google 버튼").waitFor({ timeout: 10000 });
    await E.evaluate((t) => (window.__googleToken = t), googleIdToken({ sub: "e2e-google-1", email: "E2E@example.com", aud: "someone-else" }));
    await E.getByLabel("시험 Google 버튼").click();
    await E.getByText(/이 앱용 Google 로그인이 아니에요/).waitFor({ timeout: 10000 });
    await E.evaluate((t) => (window.__googleToken = t), googleIdToken({ sub: "e2e-google-1", email: "E2E@example.com" }));
    await E.getByLabel("시험 Google 버튼").click();
    await E.getByLabel("로그인한 계정").waitFor({ timeout: 15000 });
    if ((await E.getByLabel("로그인한 계정").innerText()).indexOf(EMAIL) < 0) fail("E가 다른 계정으로 로그인됨");
    await E.getByText(/Google 계정이 이어져 있어요/).waitFor({ timeout: 10000 });
    await E.getByText("닫기").click();
    await until(async () => (await E.getByLabel("동기화 노트 열기").count()) > 0 && strokesOf(await idb(E)) >= 4, 20000, "Google로 로그인한 E에 노트가");
    // 이메일 확인을 거친 계정이라 비밀번호는 그대로 (Google만 더 이어짐)
    const r = await fetch(`http://127.0.0.1:${apiPort}/api/account/login`, { method: "POST", headers: { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "e2e-new-password" }) });
    if (r.status !== 200) fail("Google을 이은 뒤 비밀번호 로그인이 안 됨: " + r.status);
    console.log("✓ Google 로그인: 다른 앱용 토큰은 거절, 같은 이메일 계정에 Google이 이어져 E가 노트를 받음 (비밀번호도 그대로)");
    if (errors.length) fail("페이지 오류: " + errors.join(" | "));
  } catch (e) {
    for (const [n, p] of [["A", A], ["B", B], ["C", C], ["D", D], ["E", E]]) if (p) await p.screenshot({ path: path.join(TMP, `failure-${n}.png`) }).catch(() => {});
    console.error("✗ " + e.message, `\n(화면: ${TMP}/failure-A.png, failure-B.png, failure-C.png)`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
    jw.close();
    api.kill();
  }
})();
