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

// 기기 안(IndexedDB)의 노트 파일
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
        out[c.key] = typeof c.value === "string" ? c.value : null;
        c.continue();
      };
    };
    req.onerror = () => reject(req.error);
  }));
}
/** 지금 노트들의 모든 획 */
async function allStrokes(page) {
  const files = await idb(page);
  return Object.entries(files).filter(([k, v]) => /\/ink\//.test(k) && v).flatMap(([, v]) => JSON.parse(v));
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
  if (process.env.E2E_DEBUG) page.on("console", (m) => m.type() !== "warning" && console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`));
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
    await page.getByLabel(/한 번 더 누르면 지우개 설정/).click();
    await page.mouse.move(x0 + 100, y0 - 30);
    await page.mouse.down();
    await page.mouse.move(x0 + 100, y0 + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.getByLabel("되돌리기").click(); // 지운 것 되살리기
    await page.waitForTimeout(400);

    // ── 도구 설정: 붓펜·파선 / 영역 지우개 / S펜 단추 지우개 ──
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click(); // 펜 고르기
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click(); // 한 번 더 → 설정 창
    const panel = page.getByLabel("펜 설정", { exact: true });
    await panel.waitFor({ timeout: 5000 });
    // 설정 창은 도구 모음을 가리지 않고 바로 밑에, 누른 도구 단추의 왼쪽 끝에 맞춰 뜬다
    const penBox = await page.getByLabel(/한 번 더 누르면 펜 설정/).boundingBox(); // 펜 단추
    const panelBox = await panel.boundingBox();
    if (panelBox.y < penBox.y + penBox.height) fail(`펜 설정 창이 도구 모음을 가림 (창 위 ${panelBox.y}, 단추 아래 ${penBox.y + penBox.height})`);
    if (panelBox.y > penBox.y + penBox.height + 24) fail(`펜 설정 창이 도구 모음에서 너무 떨어져 뜸 (창 위 ${panelBox.y})`);
    if (Math.abs(panelBox.x - penBox.x) > 2) fail(`펜 설정 창이 펜 단추 밑에 맞춰 뜨지 않음 (창 ${panelBox.x}, 단추 ${penBox.x})`);
    await panel.getByLabel("붓펜", { exact: true }).click();
    await panel.getByLabel("파선", { exact: true }).click();
    await panel.getByLabel("닫기", { exact: true }).click();
    const y3 = y0 + 420;
    await page.mouse.move(x0, y3);
    await page.mouse.down();
    await page.mouse.move(x0 + 260, y3, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1300);
    let all = await allStrokes(page);
    const fancy = all.find((st) => st.brush === "calligraphy" && st.dash === "dash");
    if (!fancy) fail("붓펜·파선으로 그은 획이 그 설정으로 저장되지 않음: " + JSON.stringify(all.map((x) => [x.brush, x.dash])));
    const before = all.length;
    await page.getByLabel(/한 번 더 누르면 지우개 설정/).click();
    await page.getByLabel(/한 번 더 누르면 지우개 설정/).click();
    const ep = page.getByLabel("지우개 설정", { exact: true });
    await ep.waitFor({ timeout: 5000 });
    await ep.getByLabel("영역 지우개", { exact: true }).click();
    await ep.getByLabel("닫기", { exact: true }).click();
    await page.mouse.move(x0 + 130, y3 - 25);
    await page.mouse.down();
    await page.mouse.move(x0 + 130, y3 + 25, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1300);
    all = await allStrokes(page);
    if (all.length !== before + 1) fail(`영역 지우개가 획을 둘로 나누지 않음 (${before} → ${all.length})`);
    await page.getByLabel("되돌리기").click();
    await page.waitForTimeout(1300);
    if ((await allStrokes(page)).length !== before) fail("영역 지우개를 되돌리기로 한 번에 되살리지 못함");
    // S펜(웹: 펜) 단추를 누른 채 문지르면 펜 도구여도 지우개 — 붓펜 획을 가로질러
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    // 진짜(신뢰된) 펜 입력(크롬 개발자 도구 입력): 펜을 대고 긋다가 옆 단추(buttons 2)를 누르면 그때부터 지우개.
    // (단추를 누른 채 떠 있다가 닿는 경우는 웹 브라우저가 '오른쪽 단추 누름'으로 보내 그리기 자체가 시작되지 않는다 —
    //  태블릿 앱은 네이티브 S펜 감싸개로 떠 있을 때부터 단추를 안다)
    const cdp = await ctx.newCDPSession(page);
    const pen = (type, x, y, button, buttons) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, pointerType: "pen", force: buttons & 1 ? 0.5 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    const px = x0 + 60;
    await pen("mouseMoved", px, y3 - 60, "none", 0);
    await pen("mousePressed", px, y3 - 50, "left", 1);
    await pen("mouseMoved", px, y3 - 46, "left", 1);
    await pen("mouseMoved", px, y3 - 42, "left", 3); // 단추 누름
    await page.waitForTimeout(150);
    for (let i = 1; i <= 16; i++) await pen("mouseMoved", px, y3 - 42 + i * 5, "left", 3);
    await pen("mouseReleased", px, y3 + 40, "left", 2);
    await pen("mouseMoved", px, y3 + 60, "none", 0);
    await page.waitForTimeout(1300);
    all = await allStrokes(page);
    // 지우개(지금은 영역 지우개)였다면 가로 붓펜 획이 두 조각, 그냥 펜이었다면 세로 붓펜 획이 새로 생긴다
    const cal = all.filter((st) => st.brush === "calligraphy");
    const tall = (st) => {
      const ys = st.pts.filter((_, i) => i % 3 === 1);
      return Math.max(...ys) - Math.min(...ys) > 30;
    };
    if (cal.some(tall)) fail("펜 단추를 누른 채 문질렀는데 지우지 않고 새로 그어짐");
    if (cal.length !== 2) fail(`펜 단추 지우개가 획을 나누지 않음 (붓펜 획 ${cal.length}개)`);
    console.log("✓ 도구 설정: 붓펜·파선 저장, 영역 지우개로 획 나누기·한 번에 되돌리기, 펜 단추 누르고 문지르면 지우개");
    // 이미 고른 펜을 빠르게 두 번 눌러도 설정 창이 떴다가 바로 닫히지 않는다
    await page.getByLabel(/한 번 더 누르면 펜 설정/).dblclick();
    const pp = page.getByLabel("펜 설정", { exact: true });
    await page.waitForTimeout(600);
    if (!(await pp.isVisible())) fail("펜 단추를 빠르게 두 번 누르면 설정 창이 바로 닫힘");
    await pp.getByLabel("만년필", { exact: true }).click();
    await pp.getByLabel("실선", { exact: true }).click();
    await pp.getByLabel("닫기", { exact: true }).click();
    // S펜 옆 단추를 펜을 띄운 채 빠르게 두 번 누르면 형광펜으로, 다시 두 번 누르면 원래 펜으로 (기본 설정)
    const penHover = (buttons) => canvas.dispatchEvent("pointermove", { pointerType: "pen", buttons, bubbles: true, clientX: x0 + 300, clientY: y0 + 300 });
    const doublePress = async () => {
      for (const b of [2, 0, 2, 0]) {
        await penHover(b);
        await page.waitForTimeout(60);
      }
    };
    // 도구 모음에서 형광펜일 때만 '직선', 펜일 때만 '도형 펴기'가 보인다
    // 도구 모음이 아이콘이라 글이 없다 → 그 도구에만 보이는 단추의 이름표로 확인
    const selected = async (name) => page.getByLabel(name === "형광펜" ? /^직선/ : /^도형 펴기/).isVisible();
    await doublePress();
    await page.getByText("형광펜으로 바꿨어요").waitFor({ timeout: 3000 });
    if (!(await selected("형광펜"))) fail("S펜 단추를 두 번 눌렀는데 형광펜이 골라지지 않음");
    await page.waitForTimeout(600);
    await doublePress();
    await page.getByText("만년필로 돌아왔어요").waitFor({ timeout: 3000 });
    if (!(await selected("만년필"))) fail("다시 두 번 눌렀는데 원래 펜으로 돌아오지 않음");
    // 한 번만 누르면(또는 천천히 두 번) 바뀌지 않는다
    await page.waitForTimeout(600);
    await penHover(2);
    await page.waitForTimeout(60);
    await penHover(0);
    await page.waitForTimeout(700);
    await penHover(2);
    await page.waitForTimeout(60);
    await penHover(0);
    await page.waitForTimeout(300);
    if (!(await selected("만년필"))) fail("천천히 두 번 눌렀는데 도구가 바뀜");
    console.log("✓ S펜 단추 두 번: 형광펜으로 바꾸고 다시 두 번이면 원래 펜으로 (천천히 누르면 그대로)");
    await page.getByLabel(/한 번 더 누르면 지우개 설정/).click();
    await page.getByLabel(/한 번 더 누르면 지우개 설정/).click();
    await page.getByLabel("지우개 설정", { exact: true }).getByLabel("획 지우개", { exact: true }).click();
    await page.getByLabel("지우개 설정", { exact: true }).getByLabel("닫기", { exact: true }).click();
    // 올가미로 그 획을 골라 아래로 250px 옮긴다
    await page.getByLabel(/둘러싸서 고르고 옮기기/).click();
    const lasso = [[x0 - 30, y0 - 30], [x0 + 230, y0 - 30], [x0 + 230, y0 + 50], [x0 - 30, y0 + 50], [x0 - 29, y0 - 29]];
    await page.mouse.move(lasso[0][0], lasso[0][1]);
    await page.mouse.down();
    for (const [x, y] of lasso.slice(1)) await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.up();
    await page.getByText(/1개 고름/).waitFor({ timeout: 5000 });
    await page.mouse.move(x0 + 100, y0 + 8);
    await page.mouse.down();
    await page.mouse.move(x0 + 100, y0 + 258, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    // 글상자
    await page.getByLabel(/쪽을 누르면 글을 써 넣어요/).click();
    await page.mouse.click(x0 + 400, y0 + 120);
    await page.getByLabel("글상자 내용").fill("메모 시험: 효소는 촉매");
    await page.getByText("넣기", { exact: true }).click();
    await canvas.getByText("메모 시험: 효소는 촉매").waitFor({ timeout: 5000 });
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    await page.getByLabel("노트 목록으로").click();
    await page.getByLabel("시험 노트 열기").click();
    await canvas.waitFor();
    await page.waitForTimeout(1000);
    await page.getByLabel("더 보기").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByText("PDF로 내보내기 (필기 포함)").click()]);
    const out = path.join(TMP, "export.pdf");
    await dl.saveAs(out);
    // 쪽 좌표로: 빈 A4(595pt)가 화면 폭에 맞춰져 있다
    const sc = Math.min((box.width - 24) / 595.28, 6);
    const pg = (sx, sy) => [(sx - box.x - 12) / sc, (sy - box.y - 12) / sc];
    const probe = JSON.stringify([pg(x0 + 100, y0 + 8), pg(x0 + 100, y0 + 258)]);
    const dark = JSON.parse(execFileSync("python3", ["-c", `
import sys, json, pymupdf
p = pymupdf.open(sys.argv[1])[0]; pix = p.get_pixmap(dpi=72, alpha=False)
def dark(x, y):
    return any(sum(pix.pixel(min(max(int(x)+dx,0),pix.width-1), min(max(int(y)+dy,0),pix.height-1))) < 450 for dx in range(-12,13,2) for dy in range(-12,13,2))
print(json.dumps([dark(*q) for q in json.loads(sys.argv[2])]))`, out, probe], { encoding: "utf8" }));
    const words = execFileSync("python3", ["-c", "import sys, pymupdf; print(pymupdf.open(sys.argv[1])[0].get_text())", out], { encoding: "utf8" });
    if (!words.includes("메모 시험")) fail("내보낸 PDF에 글상자 글이 없음");
    if (dark[0] || !dark[1]) fail(`올가미로 옮긴 획이 내보낸 PDF의 새 자리에 없음 (원래 자리 ${dark[0]}, 새 자리 ${dark[1]})`);
    console.log("✓ 빈 노트: 쓰기·지우기·되돌리기·올가미로 옮기기·글상자·저장·PDF 내보내기(한글 글꼴)");
    await page.getByLabel("쪽 모아보기").click();
    await page.getByLabel("1쪽으로").waitFor({ timeout: 10000 });
    await page.getByLabel("쪽 모아보기 닫기").click();
    await page.getByLabel("노트 목록으로").click();

    // ── 폴더 ──
    await page.getByText("＋ 폴더").click();
    await page.getByLabel("새 폴더").fill("수학");
    await page.getByText("만들기", { exact: true }).click();
    await page.getByText("이 폴더에 노트가 없어요", { exact: false }).waitFor();
    await page.getByText(/^전체/).click();
    await page.getByLabel("시험 노트 더 보기").click();
    await page.getByText("폴더로 옮기기").click();
    await page.getByText("수학", { exact: true }).click();
    await page.getByText("수학 1").waitFor({ timeout: 5000 });
    console.log("✓ 폴더 만들기·노트 옮기기, 쪽 모아보기");

    // ── 노트 파일로 내보냈다가 다시 가져오기 (다른 기기로 옮기기) ──
    await page.getByLabel("시험 노트 더 보기").click();
    const [pk] = await Promise.all([page.waitForEvent("download"), page.getByText("다른 기기로 보내기 (노트 파일)").click()]);
    // (자동화 도구로 고를 때는 영문 파일 이름이어야 한다. 실제 파일 고르기 창에서는 한글 이름도 된다)
    const packPath = path.join(TMP, "test-note.pnote");
    await pk.saveAs(packPath);
    const [fc0] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("노트 파일 가져오기").click()]);
    await fc0.setFiles(packPath);
    await canvas.waitFor({ timeout: 15000 });
    await canvas.getByText("메모 시험: 효소는 촉매").waitFor({ timeout: 10000 });
    await page.getByLabel("노트 목록으로").click();
    // 목록을 다 불러올 때까지 기다린다 (불러오는 중에 세면 0개)
    await page.getByLabel("시험 노트 열기").nth(1).waitFor({ timeout: 10000 }).catch(() => fail("가져온 노트가 목록에 없음"));
    console.log("✓ 노트 파일(.pnote)로 내보내기 → 가져오기 (필기·글상자 그대로)");

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
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("PDF 가져오기").click()]);
    await fc.setFiles(book);
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const b2 = await canvas.boundingBox();
    const s = Math.min((b2.width - 24) / info.w, 6);
    const tx = 12 + Math.max(0, (b2.width - 24 - info.w * s) / 2), ty = 12;
    const [rx0, ry0, rx1, ry1] = info.r;
    // 글줄 가운데에서 조금 아래로 비껴 그어도 '글자 크기에 맞춰'가 글줄 높이·글자 끝에 맞춘다
    const lineH = ry1 - ry0;
    const yy = b2.y + ty + ((ry0 + ry1) / 2 + lineH * 0.3) * s;
    await page.getByLabel(/한 번 더 누르면 형광펜 설정/).click();
    await page.waitForTimeout(800); // 쪽 글자 상자를 읽을 시간
    await page.mouse.move(b2.x + tx + (rx0 + 1) * s, yy);
    await page.mouse.down();
    await page.mouse.move(b2.x + tx + (rx1 - 1) * s, yy + 1, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1300);
    const hl = (await allStrokes(page)).filter((st) => st.tool === "highlighter").pop();
    const cy = (ry0 + ry1) / 2;
    if (!hl || Math.abs(hl.pts[1] - cy) > 2 || hl.width < lineH * 0.8 || hl.width > lineH * 1.9) {
      fail(`형광펜이 글줄에 맞춰지지 않음: y ${hl && hl.pts[1]} (글줄 가운데 ${cy.toFixed(1)}), 굵기 ${hl && hl.width} (글자 높이 ${lineH.toFixed(1)})`);
    }
    console.log(`✓ 형광펜 글자 크기에 맞춤: 글줄 가운데 ${hl.pts[1]} (기대 ${cy.toFixed(1)}), 굵기 ${hl.width} (글자 높이 ${lineH.toFixed(1)})`);

    // ── 쪽을 끼우고 넘긴 뒤: 다른 쪽의 필기 되돌리기, 요약에서 보던 쪽으로 돌아오기 ──
    const pageNo = async () => (await page.getByLabel("쪽 모아보기").innerText()).replace(/\s+/g, " ").trim();
    await page.getByLabel("더 보기").click();
    await page.getByText("＋ 뒤에 빈 쪽 (같은 속지)").click();
    await page.waitForTimeout(900); // 메뉴가 닫힌 바로 뒤에 끝난 획은 버려진다 (빠르게 두 번 누른 둘째 누름 막기)
    if (!/^2 \/ \d+$/.test(await pageNo())) fail("빈 쪽을 끼운 뒤 그 쪽으로 가지 않음: " + (await pageNo()));
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    await page.mouse.move(b2.x + 200, b2.y + 200);
    await page.mouse.down();
    await page.mouse.move(b2.x + 400, b2.y + 220, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const onNew = (await allStrokes(page)).filter((st) => st.tool === "pen").length;
    await page.getByLabel("이전 쪽").click();
    await page.waitForTimeout(400);
    await page.getByLabel("되돌리기").click(); // 방금 쓴 획은 2쪽에 있다
    await page.getByText(/되돌린 필기가 2쪽에 있어서/).waitFor({ timeout: 5000 });
    if (!/^2 \//.test(await pageNo())) fail("다른 쪽의 필기를 되돌렸는데 그 쪽을 보여 주지 않음: " + (await pageNo()));
    await page.waitForTimeout(800);
    if ((await allStrokes(page)).filter((st) => st.tool === "pen").length !== onNew - 1) fail("다른 쪽의 필기가 되돌려지지 않음");
    await page.getByLabel("요약 만들기").click();
    await page.getByText("서버로 자세히", { exact: true }).waitFor({ timeout: 20000 });
    await page.getByText("‹ 노트로").click();
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    if (!/^2 \//.test(await pageNo())) fail("요약을 보고 돌아오니 보던 쪽이 아님: " + (await pageNo()));
    await page.getByLabel("이전 쪽").click();
    await page.waitForTimeout(600);
    console.log("✓ 빈 쪽 끼우기 → 다른 쪽의 필기를 되돌리면 그 쪽으로, 요약에서 보던 쪽으로 돌아오기");

    await page.getByLabel("요약 만들기").click();
    // 먼저 기기에서 바로 만든 요약 (서버 없이): PDF 글자층에서 칠한 글자를 읽는다
    await page.getByText("서버로 자세히", { exact: true }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    let quick = "";
    for (const f of page.frames()) {
      try {
        quick += await f.content();
      } catch {}
    }
    if (!quick.includes("경쟁적 저해제")) fail("기기에서 만든 요약에 칠한 글자가 없음");
    if (!/<mark[^>]*>경쟁적 저해제<\/mark>/.test(quick)) fail("기기 요약에서 칠한 부분이 강조되지 않음");
    if (!quick.includes("기질과 구조가 비슷하여")) fail("기기 요약에 앞뒤 문장이 없음");
    console.log("✓ 기기에서 바로 요약: 칠한 글자와 그 문장");
    await page.getByText("서버로 자세히", { exact: true }).click();
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

    // ── 나만의 노트: 기기 요약을 다듬어 새 노트로 ──
    await page.getByText("노트로", { exact: true }).click();
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.getByLabel("요약 만들기").click();
    // 요약을 다 만들 때까지 꺼져 있다 (click이 켜질 때까지 기다린다)
    await page.getByRole("button", { name: "나만의 노트", exact: true }).click({ timeout: 30000 });
    await page.getByLabel("노트로 만들기").waitFor({ timeout: 10000 });
    await page.getByText("경쟁적 저해제", { exact: true }).waitFor({ timeout: 5000 });
    // AI 설명(프리미엄)은 로그인해야 쓸 수 있다고 알려 준다 (이 시험 서버에는 로그인하지 않았다)
    await page.getByText(/AI 설명은 로그인한 계정으로 쓸 수 있어요/).waitFor({ timeout: 10000 });
    const meaning = page.getByLabel(/형광펜의 뜻$/).first();
    if (!(await meaning.inputValue()).trim()) fail("형광펜 색의 뜻이 비어 있음");
    await meaning.fill("개념");
    await page.getByLabel("경쟁적 저해제에 메모 더하기").click();
    await page.getByLabel("경쟁적 저해제 메모").fill("시험에 꼭 나옴");
    // 띄어쓰기 없는 긴 제목 (갤럭시탭에서 이런 제목이 어림보다 줄이 늘어 아래 글과 겹쳤다)
    const myTitle = "2025_9급_국가직_컴퓨터일반(나)_2025년_04월_05일_효소_단원_정리_노트";
    await page.getByLabel("나만의 노트 이름").fill(myTitle);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "mynote-maker.png") }); // 화면 확인용 (선택)
    await page.getByLabel("노트로 만들기").click();
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const files = await idb(page);
    const made = Object.entries(files).find(([k, v]) => /notebook\.json$/.test(k) && v && JSON.parse(v).title === myTitle);
    if (!made) fail("나만의 노트가 저장되지 않음");
    const dir = made[0].replace(/notebook\.json$/, "");
    const boxes = Object.entries(files)
      .filter(([k, v]) => k.startsWith(dir + "ink/") && v)
      .flatMap(([, v]) => JSON.parse(v))
      .filter((st) => st.tool === "text");
    const texts = boxes.map((st) => st.text);
    // 화면에 실제로 그려진 글 높이가 저장된 상자 높이 안에 드는지 (넘치면 아래 글과 겹친다)
    const spill = await page.evaluate((bs) => {
      const out = [];
      const divs = [...document.querySelectorAll("div")];
      for (const b of bs) {
        const w = b.pts[3] - b.pts[0];
        const el = divs.find((d) => d.textContent === b.text && Math.abs(parseFloat(d.style.width) - w) < 0.01);
        if (!el) {
          out.push(`${b.text}: 화면에 없음`);
          continue;
        }
        const r = el.getBoundingClientRect();
        const k = r.width / w; // 화면 배율
        const h = r.height / k;
        if (h > b.pts[4] - b.pts[1] + 0.5) out.push(`${b.text}: 그린 높이 ${h.toFixed(1)} > 상자 ${(b.pts[4] - b.pts[1]).toFixed(1)}`);
      }
      return out;
    }, boxes);
    if (spill.length) fail("나만의 노트 글이 상자를 넘침: " + spill.join(" | "));
    for (const want of [myTitle, "1쪽", "경쟁적 저해제", "개념", "메모: 시험에 꼭 나옴"]) {
      if (!texts.includes(want)) fail(`나만의 노트에 '${want}'가 없음: ${JSON.stringify(texts)}`);
    }
    if (!texts.some((x) => x.includes("기질과 구조가 비슷하여"))) fail("나만의 노트에 칠한 문장이 없음");
    console.log("✓ 나만의 노트: 고르고 색 뜻·메모를 고쳐 새 노트로 (제목·쪽·칠한 글·문장·메모)");
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
