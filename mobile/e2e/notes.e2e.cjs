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

  // 녹음 시험용 가짜 마이크 (허락 창 없이)
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true, permissions: ["microphone"] });
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
    // 그림 단추 이름표: 펜(웹은 마우스)을 단추 위에 띄우면 이름이 단추 밑에 뜨고, 벗어나면 닫힌다
    const eraserBox = await page.getByLabel(/한 번 더 누르면 지우개 설정/).boundingBox();
    await page.mouse.move(eraserBox.x + eraserBox.width / 2, eraserBox.y + eraserBox.height / 2, { steps: 3 });
    const tipEl = page.getByTestId("tool-tip");
    await tipEl.waitFor({ timeout: 3000 }).catch(() => fail("지우개 단추 위에 띄웠는데 이름표가 뜨지 않음"));
    if ((await tipEl.innerText()).trim() !== "지우개") fail("이름표 글이 '지우개'가 아님: " + (await tipEl.innerText()));
    const tipBox = await tipEl.boundingBox();
    if (tipBox.y < eraserBox.y + eraserBox.height || Math.abs(tipBox.x + tipBox.width / 2 - (eraserBox.x + eraserBox.width / 2)) > 4) fail("이름표가 단추 바로 밑 가운데에 있지 않음");
    await page.mouse.move(x0, y0, { steps: 3 });
    await tipEl.waitFor({ state: "detached", timeout: 3000 }).catch(() => fail("단추에서 벗어났는데 이름표가 닫히지 않음"));
    console.log("✓ 그림 단추 이름표: 위에 띄우면 '지우개'가 단추 밑에, 벗어나면 닫힘");
    // 화면 왼쪽 끝 가까운 펜 단추도 이름표가 단추 가운데 밑에 (예전엔 오른쪽으로 밀렸다), 색 단추는 색 이름
    const center = (b) => b.x + b.width / 2;
    const hoverOn = async (loc) => {
      const b = await loc.boundingBox();
      await page.mouse.move(center(b), b.y + b.height / 2, { steps: 3 });
      await tipEl.waitFor({ timeout: 3000 });
      await page.waitForTimeout(150);
      return b;
    };
    const penB = await hoverOn(page.getByLabel(/한 번 더 누르면 펜 설정/));
    const penTip = await tipEl.boundingBox();
    if (Math.abs(center(penTip) - center(penB)) > 4) fail(`펜 단추 이름표가 단추 가운데 밑이 아님 (어긋남 ${(center(penTip) - center(penB)).toFixed(0)}px)`);
    await hoverOn(page.getByLabel("색 #1F2328"));
    if ((await tipEl.innerText()).trim() !== "검정") fail("검정 색 단추 이름표가 '검정'이 아님: " + (await tipEl.innerText()));
    await page.mouse.move(x0, y0, { steps: 3 });
    await tipEl.waitFor({ state: "detached", timeout: 3000 });

    // ── 도구 모음 편집: 순서·숨기기·자리, 손잡이로 끌어 붙이기·띄우기 ──
    const btnOf = (re) => page.getByLabel(re);
    const eraserBtn = btnOf(/한 번 더 누르면 지우개 설정/), hlBtn = btnOf(/한 번 더 누르면 형광펜 설정/), lassoBtn = btnOf(/^올가미 \(/);
    const editBar = async () => {
      await page.getByLabel("도구 모음 편집").click();
      await page.getByText("순서와 보이기").waitFor({ timeout: 3000 });
    };
    const closeEdit = async () => {
      await page.getByText("닫기", { exact: true }).click();
      await page.getByText("순서와 보이기").waitFor({ state: "detached", timeout: 3000 });
      await page.waitForTimeout(500);
    };
    await editBar();
    await page.getByLabel("지우개 앞으로").click();
    await page.getByLabel("올가미 보이기").click();
    await page.getByLabel("도구 모음 자리: 왼쪽").click();
    await closeEdit();
    if ((await lassoBtn.count()) !== 0) fail("올가미를 숨겼는데 도구 모음에 남아 있음");
    let eB = await eraserBtn.boundingBox(), hB = await hlBtn.boundingBox();
    if (!(eB.y < hB.y)) fail("지우개를 앞으로 옮겼는데 형광펜보다 앞(위)에 있지 않음");
    if (!(eB.x < 60 && eB.y > 60)) fail(`왼쪽에 붙였는데 지우개 단추가 왼쪽 세로 줄에 있지 않음 (${eB.x.toFixed(0)}, ${eB.y.toFixed(0)})`);
    // 왼쪽에 붙이면 윗줄은 없어지고 돌아가기·쪽 번호도 왼쪽 줄로 (화면 위쪽까지 쪽이 쓴다)
    const backB = await page.getByLabel("노트 목록으로").boundingBox();
    const pageNoB = await page.getByLabel("쪽 모아보기").boundingBox();
    if (!(backB.x < 60 && pageNoB.x < 60)) fail("왼쪽에 붙였는데 돌아가기·쪽 번호가 왼쪽 줄에 있지 않음 (윗줄이 남아 있음)");
    if (!((await canvas.boundingBox()).y < 10)) fail("왼쪽에 붙였는데 쪽 화면이 맨 위까지 오지 않음");
    await hoverOn(eraserBtn);
    const sideTip = await tipEl.boundingBox();
    if (!(sideTip.x > eB.x + eB.width)) fail("왼쪽에 붙인 도구 모음의 이름표가 단추 오른쪽에 뜨지 않음");
    // 손잡이를 끌어 오른쪽 끝에 놓으면 오른쪽에 붙는다
    const vp = page.viewportSize();
    const dragGrip = async (x, y) => {
      const g = await page.getByLabel(/^도구 모음 옮기기/).boundingBox();
      await page.mouse.move(center(g), g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(700);
    };
    await dragGrip(vp.width - 20, 420);
    eB = await eraserBtn.boundingBox();
    if (!(eB.x > vp.width - 70)) fail(`손잡이를 오른쪽 끝에 놓았는데 오른쪽에 붙지 않음 (지우개 x ${eB.x.toFixed(0)})`);
    // 가운데에 놓으면 놓은 높이에 떠 있는 도구 모음 (가로는 화면 밖으로 나가지 않게 안쪽으로 당겨질 수 있다)
    await dragGrip(500, 420);
    eB = await eraserBtn.boundingBox();
    if (!(Math.abs(eB.y + eB.height / 2 - 420) < 40)) fail(`가운데에 놓았는데 그 높이에 떠 있지 않음 (지우개 ${eB.x.toFixed(0)}, ${eB.y.toFixed(0)})`);
    // 떠 있는 모양 '두 줄': 도구가 두 줄로 (되돌리기는 아랫줄)
    await editBar();
    await page.getByLabel("떠 있는 모양: 두 줄").click();
    await closeEdit();
    eB = await eraserBtn.boundingBox();
    const undoB = await page.getByLabel("되돌리기").boundingBox();
    if (!(undoB.y > eB.y + 20)) fail(`떠 있는 모양을 두 줄로 했는데 한 줄 그대로 (지우개 y ${eB.y.toFixed(0)}, 되돌리기 y ${undoB.y.toFixed(0)})`);
    // 도구 모음 빈 곳(쪽 번호)을 꾹 눌러 끌어 왼쪽 끝에 놓으면 왼쪽에 붙는다
    const pn = await page.getByLabel("쪽 모아보기").boundingBox();
    await page.mouse.move(pn.x + pn.width / 2, pn.y + pn.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.move(15, 420, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(700);
    if ((await page.getByLabel("쪽 모아보기 닫기").count())) await page.getByLabel("쪽 모아보기 닫기").click();
    eB = await eraserBtn.boundingBox();
    if (!(eB.x < 60)) fail(`도구 모음을 꾹 눌러 왼쪽 끝으로 끌었는데 왼쪽에 붙지 않음 (지우개 x ${eB.x.toFixed(0)})`);
    await editBar();
    await page.getByLabel("도구 모음 자리: 떠 있게").click();
    await page.getByLabel("떠 있는 모양: 한 줄").click();
    await closeEdit();
    // 접기: 지금 도구(펜)와 펼치기만 남고, 펼치면 다시 다 보인다
    await page.getByLabel("도구 모음 접기").click();
    await page.waitForTimeout(400);
    if ((await eraserBtn.count()) !== 0 || (await page.getByLabel(/한 번 더 누르면 펜 설정/).count()) !== 1) fail("도구 모음을 접었는데 지금 도구(펜)만 남지 않음");
    await page.getByLabel("도구 모음 펼치기").click();
    await page.waitForTimeout(400);
    if ((await eraserBtn.count()) !== 1) fail("도구 모음을 펼쳤는데 지우개가 돌아오지 않음");
    await editBar();
    await page.getByText("처음대로", { exact: true }).click();
    await closeEdit();
    eB = await eraserBtn.boundingBox(), hB = await hlBtn.boundingBox();
    if (!(eB.x > hB.x && eB.y < 60) || (await lassoBtn.count()) !== 1) fail("'처음대로'로 도구 모음이 처음 모습(위, 기본 순서, 올가미 보임)으로 돌아오지 않음");
    console.log("✓ 이름표: 펜 단추 가운데 밑·색 이름 / 도구 모음 편집: 순서·숨기기·왼쪽에 붙이기(이름표는 옆에)·손잡이로 오른쪽·떠 있게(두 줄)·꾹 눌러 옮기기·윗줄 없애기·접기·처음대로");
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
    await pp.waitFor({ state: "detached", timeout: 3000 }); // 창이 사라지는 동안(흐려지는 중)에는 창 안의 '직선' 스위치도 잡힌다
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

    // ── 폴더 (디렉터리처럼: 폴더 안의 폴더, 왼쪽 나무, 위 경로, 폴더·노트 네모 칸) ──
    await page.getByText("＋ 폴더").click();
    await page.getByLabel("새 폴더", { exact: true }).fill("수학");
    await page.getByText("만들기", { exact: true }).click();
    await page.getByText("이 폴더에 노트가 없어요", { exact: false }).waitFor();
    await page.getByText("＋ 폴더").click();
    await page.getByLabel("'수학' 안에 새 폴더").fill("미적분");
    await page.getByText("만들기", { exact: true }).click();
    await page.getByLabel("경로: 미적분").waitFor({ timeout: 5000 });
    await page.getByLabel("경로: 수학").waitFor({ timeout: 3000 });
    await page.getByLabel("모든 노트", { exact: true }).click();
    await page.getByLabel("시험 노트 더 보기").click();
    await page.getByText("폴더로 옮기기").click();
    await page.getByLabel("'수학/미적분'(으)로 옮기기").click();
    await page.getByLabel("미적분 폴더, 노트 1개").waitFor({ timeout: 5000 }).catch(() => fail("왼쪽 폴더 나무에 '미적분 1'이 없음"));
    // 맨 위 → 수학 폴더 칸 → 미적분 폴더 칸 → 노트
    await page.getByLabel("맨 위 폴더").click();
    await page.getByLabel("수학 폴더 열기").click();
    await page.getByLabel("미적분 폴더 열기").click();
    await page.getByLabel("시험 노트 열기").waitFor({ timeout: 5000 }).catch(() => fail("미적분 폴더 안에 옮긴 노트가 없음"));
    const tile = await page.getByLabel("시험 노트 열기").boundingBox();
    // 폴더 이름 바꾸기: 안의 노트도 따라간다
    await page.getByText("폴더 ⋯").click();
    await page.getByText("이름 바꾸기", { exact: true }).locator("visible=true").first().click();
    await page.getByLabel("폴더 이름 바꾸기").fill("적분");
    await page.getByText("바꾸기", { exact: true }).click();
    await page.getByLabel("경로: 적분").waitFor({ timeout: 5000 });
    await page.getByLabel("시험 노트 열기").waitFor({ timeout: 5000 }).catch(() => fail("폴더 이름을 바꾸니 안의 노트가 사라짐"));
    await page.getByLabel("모든 노트", { exact: true }).click();
    await page.waitForTimeout(500);
    console.log(`✓ 폴더: 수학 안에 미적분, 왼쪽 나무·경로·폴더 칸으로 들어가기, 이름 바꾸기 (노트 칸 ${tile.width.toFixed(0)}×${tile.height.toFixed(0)})`);

    // ── 즐겨찾기 · 꾹 눌러 끌어 옮기기 · 휴지통 ──
    const dragTo = async (from, to) => {
      const a = await from.boundingBox(), b = await to.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 3);
      await page.mouse.down();
      await page.waitForTimeout(700); // 꾹 누르기
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
      await page.waitForTimeout(250);
      if (!(await page.getByText(/에 넣기|폴더 밖으로|이 앞에 놓기|놓을 곳으로 끌어/).count())) {
        await page.mouse.up();
        fail("꾹 눌렀다 끌었는데 끌기가 시작되지 않음 (끄는 표가 안 보임)");
      }
      await page.mouse.up();
      await page.waitForTimeout(1000);
    };
    const card = (title) => page.getByLabel(`${title} 열기`, { exact: true });
    await page.getByLabel("시험 노트 즐겨찾기 넣기").click();
    await page.waitForTimeout(600);
    await page.getByLabel("즐겨찾기", { exact: true }).click();
    await card("시험 노트").waitFor({ timeout: 5000 }).catch(() => fail("별을 눌렀는데 즐겨찾기에 없음"));
    // 즐겨찾기에서 왼쪽 '폴더'(맨 위)로 끌면 폴더 밖으로
    await dragTo(card("시험 노트"), page.getByLabel("맨 위 폴더"));
    await page.getByLabel("맨 위 폴더").click();
    await card("시험 노트").waitFor({ timeout: 5000 }).catch(() => fail("왼쪽 '폴더'로 끌어 놓았는데 폴더 밖으로 나오지 않음"));
    // 맨 위에서 '수학' 폴더 칸으로 끌어 넣기
    await dragTo(card("시험 노트"), page.getByLabel("수학 폴더 열기"));
    if ((await card("시험 노트").count()) !== 0) fail("'수학' 폴더 칸에 끌어 넣었는데 그대로 있음");
    await page.getByLabel("수학 폴더 열기").click();
    await card("시험 노트").waitFor({ timeout: 5000 }).catch(() => fail("'수학' 폴더 안에 끌어 넣은 노트가 없음"));
    // 노트 둘: 뒤의 것을 앞의 것 위에 놓으면 그 앞으로
    await page.getByLabel("모든 노트", { exact: true }).click();
    await page.getByText("＋ 새 노트").click();
    await page.getByLabel("새 노트 이름").fill("둘째 노트");
    await page.getByText("만들기", { exact: true }).click();
    await canvas.waitFor({ timeout: 20000 });
    await page.getByLabel("노트 목록으로").click();
    await card("둘째 노트").waitFor({ timeout: 10000 });
    const xOf = async (title) => (await card(title).boundingBox()).x;
    if (!((await xOf("둘째 노트")) < (await xOf("시험 노트")))) fail("새로 만든 노트가 앞에 있지 않음");
    await dragTo(card("시험 노트"), card("둘째 노트"));
    if (!((await xOf("시험 노트")) < (await xOf("둘째 노트")))) fail("노트를 다른 노트 앞에 놓았는데 순서가 바뀌지 않음");
    // 이름을 누르면 이름 바꾸기
    await page.getByLabel("둘째 노트 이름 바꾸기").click();
    await page.getByLabel("노트 이름 바꾸기", { exact: true }).fill("둘째 메모");
    await page.getByText("바꾸기", { exact: true }).click();
    await card("둘째 메모").waitFor({ timeout: 5000 }).catch(() => fail("노트 이름을 눌러 바꿨는데 바뀌지 않음"));
    // 꾹 눌렀다가 움직이지 않고 떼면 메뉴
    const cb2 = await card("둘째 메모").boundingBox();
    await page.mouse.move(cb2.x + cb2.width / 2, cb2.y + cb2.height / 3);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.getByText("즐겨찾기에 넣기", { exact: true }).waitFor({ timeout: 3000 }).catch(() => fail("노트를 꾹 눌렀다 뗐는데 메뉴가 뜨지 않음"));
    await page.mouse.click(8, 8);
    await page.waitForTimeout(500);
    // 휴지통으로 끌기 → 휴지통에서 되살리기 → 다시 넣고 영원히 지우기
    await dragTo(card("둘째 메모"), page.getByLabel("휴지통", { exact: true }));
    if ((await card("둘째 메모").count()) !== 0) fail("휴지통으로 끌었는데 목록에 남아 있음");
    await page.getByLabel("휴지통", { exact: true }).click();
    await card("둘째 메모").click();
    await page.getByText("되살리기", { exact: true }).click();
    await page.getByLabel("모든 노트", { exact: true }).click();
    await card("둘째 메모").waitFor({ timeout: 5000 }).catch(() => fail("휴지통에서 되살렸는데 목록에 없음"));
    await page.getByLabel("둘째 메모 더 보기").click();
    await page.getByText("노트 지우기 (휴지통으로)").click();
    await page.getByLabel("휴지통", { exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await card("둘째 메모").click();
    await page.getByText("영원히 지우기", { exact: true }).click();
    await page.waitForTimeout(1000);
    if ((await card("둘째 메모").count()) !== 0) fail("영원히 지웠는데 휴지통에 남아 있음");
    await page.getByLabel("모든 노트", { exact: true }).click();
    await page.waitForTimeout(500);
    console.log("✓ 즐겨찾기(별), 이름 눌러 바꾸기, 꾹 눌렀다 떼면 메뉴, 꾹 눌러 끌기: 폴더 밖으로·폴더 칸 안으로·노트 앞으로, 휴지통: 끌어 넣기·되살리기·영원히 지우기");

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

    // ── 쪽 보기: 두 쪽씩 · 위아래로 이어서 / 형광펜 직선은 긋는 동안에도 곧게 ──
    const inkPer = async () => {
      const out = {};
      for (const [k, v] of Object.entries(await idb(page))) if (/\/ink\//.test(k) && v) out[k] = JSON.parse(v).length;
      return out;
    };
    const grew = (a, b) => Object.keys(b).filter((k) => (b[k] ?? 0) > (a[k] ?? 0));
    const viewOpt = async (re) => {
      await page.getByLabel("더 보기").click();
      await page.getByText(re).click();
      await page.waitForTimeout(1000); // 메뉴가 닫힌 바로 뒤의 획은 버려진다
    };
    const line = async (x0, y0, x1, y1) => {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(900);
    };
    // 펜이 이미 골라져 있으면 한 번 더 누를 때 설정 창이 열린다 → 다른 도구(글상자)를 거쳐 펜으로
    await page.getByLabel(/^글상자 \(/).click();
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    await viewOpt(/^두 쪽씩 보기/);
    // 두 쪽(1·2쪽)이 화면 폭에 나란히: 오른쪽 쪽에 쓰면 2쪽, 왼쪽 쪽에 쓰면 1쪽에 들어가고 쪽 번호도 따라간다
    const s2 = Math.min((b2.width - 24) / (2 * info.w + 24), 6);
    const rightX = b2.x + 12 + (info.w * 1.5 + 24) * s2, leftX = b2.x + 12 + info.w * 0.5 * s2, topY = b2.y + 12 + 120 * s2;
    let inkBefore = await inkPer();
    await line(rightX - 40, topY, rightX + 40, topY + 20);
    const onRight = grew(inkBefore, await inkPer());
    if (!/^2 \//.test(await pageNo())) fail("두 쪽 보기에서 오른쪽 쪽에 썼는데 지금 쪽이 2쪽이 아님: " + (await pageNo()));
    inkBefore = await inkPer();
    await line(leftX - 40, topY, leftX + 40, topY + 20);
    const onLeft = grew(inkBefore, await inkPer());
    if (!/^1 \//.test(await pageNo())) fail("두 쪽 보기에서 왼쪽 쪽에 썼는데 지금 쪽이 1쪽이 아님: " + (await pageNo()));
    if (onRight.length !== 1 || onLeft.length !== 1 || onRight[0] === onLeft[0]) fail(`두 쪽 보기: 오른쪽·왼쪽에 쓴 획이 서로 다른 쪽에 저장되지 않음 (${onRight} / ${onLeft})`);
    await page.getByLabel("되돌리기").click();
    await page.waitForTimeout(500);
    await page.getByLabel("되돌리기").click();
    await page.waitForTimeout(800);
    await viewOpt(/^두 쪽씩 보기/); // 끄기
    console.log("✓ 두 쪽씩 보기: 오른쪽 쪽에 쓰면 2쪽에, 왼쪽 쪽에 쓰면 1쪽에 (쪽 번호도 따라감)");

    await viewOpt(/^위아래로 넘기기/);
    await page.getByLabel("이전 쪽").click().catch(() => {});
    await page.waitForTimeout(400);
    await page.getByLabel("다음 쪽").click();
    await page.waitForTimeout(800);
    if (!/^2 \//.test(await pageNo())) fail("위아래 보기에서 다음 쪽으로 가지 않음: " + (await pageNo()));
    inkBefore = await inkPer();
    await line(b2.x + 200, b2.y + 200, b2.x + 400, b2.y + 220); // 2쪽 맨 위가 화면 위에 와 있다
    const onDown = grew(inkBefore, await inkPer());
    if (onDown.length !== 1 || onDown[0] !== onRight[0]) fail(`위아래 보기: 다음 쪽 단추로 간 2쪽에 쓴 획이 2쪽에 저장되지 않음 (${onDown})`);
    // 형광펜 직선(기본 켜짐): 물결치듯 그어도 손을 떼기 전부터 곧은 띠로 보인다
    await page.getByLabel(/한 번 더 누르면 형광펜 설정/).click();
    await page.waitForTimeout(300);
    const hx0 = b2.x + 150, hy = b2.y + 430;
    await page.mouse.move(hx0, hy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(hx0 + i * 25, hy + (i % 2 ? 30 : -30));
    await page.mouse.move(hx0 + 325, hy + 2);
    await page.waitForTimeout(400);
    const liveShot = path.join(TMP, "live-highlight.png");
    await page.screenshot({ path: liveShot, clip: { x: hx0 - 20, y: hy - 90, width: 370, height: 180 } });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const band = JSON.parse(execFileSync("python3", ["-c", `
import sys, json, pymupdf
p = pymupdf.Pixmap(sys.argv[1]); k = p.width / 370
ys = [y for y in range(p.height) for x in range(0, p.width, 3) if (lambda c: c[0] > 235 and c[1] > 210 and c[2] < 225)(p.pixel(x, y))]
print(json.dumps([len(ys), (max(ys) - min(ys)) / k if ys else 0]))`, liveShot], { encoding: "utf8" }));
    if (!band[0] || band[1] > 20 * s + 8) fail(`형광펜 직선: 긋는 동안 곧은 띠로 보이지 않음 (노란 부분 높이 ${band[1].toFixed(1)}px, 물결 높이 60px)`);
    const straightHl = (await allStrokes(page)).filter((st) => st.tool === "highlighter").pop();
    if (!straightHl || straightHl.pts.length !== 6 || straightHl.pts[1] !== straightHl.pts[4]) fail("형광펜 직선: 손을 뗀 뒤 곧은 선으로 저장되지 않음");
    // 처음 찍은 점 높이에 고정 (2쪽 맨 위가 화면 위 여백 12px 자리에 있다)
    const firstY = (hy - b2.y - 12) / s;
    if (Math.abs(straightHl.pts[1] - firstY) > 1.5) fail(`형광펜 직선: 처음 찍은 높이(${firstY.toFixed(1)})가 아니라 ${straightHl.pts[1]}에 그어짐`);
    await page.getByLabel("되돌리기").click();
    await page.waitForTimeout(500);
    await page.getByLabel("되돌리기").click();
    await page.waitForTimeout(800);
    console.log(`✓ 위아래로 넘기기: 다음 쪽 단추로 2쪽 맨 위로, 쓴 획은 2쪽에 / 형광펜 직선이 긋는 동안에도 곧게 (띠 높이 ${band[1].toFixed(0)}px)`);
    await viewOpt(/^좌우로 넘기기/);
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    await page.getByLabel("이전 쪽").click();
    await page.waitForTimeout(600);

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

    // ── 사진·스티커·붙여넣기 ──
    await page.reload();
    await page.getByText("＋ 새 노트").waitFor({ timeout: 20000 });
    await page.getByText("＋ 새 노트").click();
    await page.getByLabel("새 노트 이름").fill("사진 노트");
    await page.getByText("만들기", { exact: true }).click();
    await canvas.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    // 빨간 40×30 PNG (사진 대신)
    const pngPath = path.join(TMP, "red.png");
    const pngB64 = execFileSync("python3", ["-c", String.raw`
import sys, zlib, struct, base64
w, h = 40, 30
raw = b"".join(b"\x00" + b"\xe0\x20\x20" * w for _ in range(h))
def ch(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")
open(sys.argv[1], "wb").write(png); print(base64.b64encode(png).decode())`, pngPath], { encoding: "utf8" }).trim();
    const images = async () => (await allStrokes(page)).filter((st) => st.tool === "image");
    await page.getByLabel("사진·스티커 넣기").click();
    const [fcImg] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("사진 고르기 (갤러리)").click()]);
    await fcImg.setFiles(pngPath);
    await page.waitForTimeout(1500);
    let imgs = await images();
    if (imgs.length !== 1 || !String(imgs[0].img).startsWith("data:image/")) fail(`사진을 골랐는데 쪽에 붙지 않음 (${imgs.length}개)`);
    const w0 = imgs[0].pts[3] - imgs[0].pts[0];
    await page.getByLabel("고른 것 크게").click();
    await page.waitForTimeout(900);
    imgs = await images();
    const w1 = imgs[0].pts[3] - imgs[0].pts[0];
    if (Math.abs(w1 / w0 - 1.25) > 0.02) fail(`'크게'를 눌렀는데 사진이 1.25배가 아님 (${w0.toFixed(1)} → ${w1.toFixed(1)})`);
    // 스티커: 도장 '중요', 그림 '별'
    await page.getByLabel("사진·스티커 넣기").click();
    await page.getByText("스티커", { exact: true }).click();
    await page.getByLabel("도장 스티커: 중요").click();
    await page.waitForTimeout(900);
    const stamp = (await allStrokes(page)).find((st) => st.stamp);
    if (!stamp || stamp.text !== "중요") fail("도장 스티커 '중요'가 들어가지 않음");
    await canvas.getByText("중요").waitFor({ timeout: 5000 });
    await page.getByLabel("사진·스티커 넣기").click();
    await page.getByText("스티커", { exact: true }).click();
    await page.getByLabel("그림 스티커: 별").click();
    await page.waitForTimeout(900);
    imgs = await images();
    if (imgs.length !== 2 || !String(imgs[1].img).startsWith("data:image/png")) fail("그림 스티커 '별'이 PNG 그림으로 들어가지 않음");
    // 웹은 Ctrl+V(붙여넣기)로 복사한 그림도
    await page.evaluate((b64) => {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u], "copied.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, pngB64);
    await page.waitForTimeout(1500);
    if ((await images()).length !== 3) fail("복사한 그림을 붙여넣었는데 쪽에 붙지 않음");
    // PDF로 내보내면 그림과 도장 글이 들어간다
    await page.getByLabel("더 보기").click();
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByText("PDF로 내보내기 (필기 포함)").click()]);
    const out2 = path.join(TMP, "photos.pdf");
    await dl2.saveAs(out2);
    const pdfInfo = execFileSync("python3", ["-c", "import sys, pymupdf; p = pymupdf.open(sys.argv[1])[0]; print(len(set(x[0] for x in p.get_images()))); print(p.get_text())", out2], { encoding: "utf8" });
    if (Number(pdfInfo.trim().split(/\s+/)[0]) < 2 || !pdfInfo.includes("중요")) fail("내보낸 PDF에 사진·스티커가 없음: " + pdfInfo.slice(0, 80));
    console.log("✓ 사진 고르기·크게, 도장·그림 스티커, Ctrl+V 붙여넣기, PDF 내보내기에 사진·도장");

    // ── 강의 녹음: 녹음하며 쓴 필기에 녹음 시각, '필기 눌러 듣기'로 그때부터 ──
    await page.getByLabel(/^글상자 \(/).click();
    await page.getByLabel(/한 번 더 누르면 펜 설정/).click();
    await page.getByLabel("강의 녹음").click();
    await page.getByLabel(/^녹음 멈추기/).waitFor({ timeout: 8000 }).catch(() => fail("녹음이 시작되지 않음"));
    const rb = await canvas.boundingBox();
    const recLine = async (y) => {
      await page.mouse.move(rb.x + 150, rb.y + y);
      await page.mouse.down();
      await page.mouse.move(rb.x + 450, rb.y + y, { steps: 8 });
      await page.mouse.up();
    };
    await page.waitForTimeout(1200);
    await recLine(520);
    await page.waitForTimeout(3000);
    await recLine(600);
    await page.waitForTimeout(800);
    await page.getByLabel(/^녹음 멈추기/).click();
    await page.getByText(/녹음을 저장했어요/).waitFor({ timeout: 10000 }).catch(() => fail("녹음이 저장되지 않음"));
    await page.waitForTimeout(800);
    const timed = (await allStrokes(page)).filter((st) => st.rec);
    if (timed.length !== 2 || !(timed[1].rt - timed[0].rt > 2500)) fail(`녹음 중에 쓴 획에 녹음 시각이 맞게 붙지 않음: ${JSON.stringify(timed.map((x) => x.rt))}`);
    const recFiles = Object.keys(await idb(page)).filter((k) => /\/rec\/[^/]+\/audio\./.test(k));
    if (recFiles.length !== 1) fail("녹음 파일이 노트 안에 저장되지 않음");
    await page.getByLabel("녹음 듣기").click();
    await page.getByLabel("재생 시간").waitFor({ timeout: 5000 });
    await page.getByLabel("녹음 멈춤").click().catch(() => {});
    await page.getByLabel("필기 눌러 듣기").click();
    await page.mouse.click(rb.x + 300, rb.y + 600); // 두 번째 획 (녹음 4초쯤에 씀)
    await page.waitForTimeout(900);
    const shown = await page.getByLabel("재생 시간").innerText();
    const [mm, ss] = shown.split("/")[0].trim().split(":").map(Number);
    const at = mm * 60 + ss, want = timed[1].rt / 1000 - 2;
    if (Math.abs(at - want) > 1.6) fail(`필기를 눌렀는데 그 필기를 쓰던 때(${want.toFixed(1)}초쯤)로 가지 않음: ${shown}`);
    await page.getByLabel("재생 막대 닫기").click();
    console.log(`✓ 강의 녹음: 녹음하며 쓴 필기에 시각(${timed.map((x) => (x.rt / 1000).toFixed(1)).join("초, ")}초), 필기를 누르면 ${shown.split("/")[0].trim()}부터 재생`);

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
