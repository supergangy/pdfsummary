// 실제 파이썬 서버(--server)를 띄워 앱의 서버 대화 코드를 시험한다.
//   npm test   (저장소 루트에서 파이썬 패키지가 설치되어 있어야 함)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, colorFilters, uploadUrl, authHeaders, parseUpload, lastLine, normalizeUrl, type Settings } from "./api.ts";

const CODE = "mobile-test-code-123";
const PORT = 18000 + Math.floor(Math.random() * 1000);
const ROOT = join(import.meta.dirname, "..", "..");
let srv: ChildProcess;
const S: Settings = { serverUrl: `http://127.0.0.1:${PORT}`, accessCode: CODE, apiKey: "" };
let pdfPath = "";
let origPath = "";

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pdfs-"));
  pdfPath = join(dir, "notes.pdf");
  origPath = join(dir, "book.pdf");
  const mk = spawn("python3", ["-c", `import sys; sys.path.insert(0,'examples'); import make_sample as m; m.make_book_pair(${JSON.stringify(origPath)}, ${JSON.stringify(pdfPath)})`], { cwd: ROOT });
  await new Promise((r) => mk.on("exit", r));
  srv = spawn("python3", ["-m", "pdfsummary.app", "--server", "--host", "127.0.0.1", "--port", String(PORT), "--access-code", CODE], {
    cwd: ROOT,
    env: { ...process.env, ANTHROPIC_API_KEY: "", HOME: dir },
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/healthz`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server did not start");
});

after(() => srv?.kill());

async function upload(path: string, name: string) {
  const r = await fetch(uploadUrl(S, name), { method: "PUT", headers: authHeaders(S), body: readFileSync(path) });
  return parseUpload(r.status, await r.text());
}

test("wrong access code gives a readable error", async () => {
  const c = new Client({ ...S, accessCode: "nope-nope-nope" });
  await assert.rejects(c.state(), /접속 코드|권한/);
});

test("unreachable server gives a readable error", async () => {
  const c = new Client({ ...S, serverUrl: "http://127.0.0.1:1" });
  await assert.rejects(c.state(), /연결할 수 없어요/);
});

test("full flow: upload → colors → run → result", async () => {
  const c = new Client(S);
  const st = await c.state();
  assert.equal(st.server, true);
  const main = await upload(pdfPath, "효소 필기.pdf");
  const orig = await upload(origPath, "원본.pdf");
  assert.equal(main.name, "효소 필기.pdf");
  const colors = await c.colors(main.id, orig.id);
  assert.deepEqual(colors.map((x) => x.name), ["노랑", "분홍", "초록"]);
  const flags = colors.map((x) => ({ ...x, on: x.name !== "초록" }));
  const job = await c.run(main.id, orig.id, {
    group_by: "chapter", context: "sentence", handwriting: "image",
    colors: colorFilters(flags), labels: { yellow: "핵심" }, title: "효소",
  });
  let st2 = await c.job(job);
  for (let i = 0; i < 100 && st2.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    st2 = await c.job(job);
  }
  assert.equal(st2.status, "done", st2.error);
  assert.equal(st2.summary, "형광펜 2 · 손글씨 1");
  const html = await c.resultText(job);
  assert.match(html, /<title>효소 필기 요약<\/title>/);
  assert.match(html, /노랑 · 핵심/);
});

test("default fetch is called unbound (browsers throw 'Illegal invocation' otherwise)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return real(input, init);
  } as typeof fetch;
  try {
    const st = await new Client(S).state();
    assert.equal(st.server, true);
  } finally {
    globalThis.fetch = real;
  }
});

test("helpers", () => {
  assert.equal(normalizeUrl("example.com/"), "https://example.com");
  assert.deepEqual(colorFilters([{ on: true, filter: "#F00" } as never, { on: true, filter: "노랑" } as never]), []);
  assert.equal(lastLine(["📖 찾는 중…", "  🧠 AI로 단원 개요 만드는 중", ""]), "AI로 단원 개요 만드는 중");
  assert.equal(authHeaders({ ...S, apiKey: " sk-ant-x " }, true)["X-Anthropic-Key"], "sk-ant-x");
  assert.equal(authHeaders({ ...S, apiKey: "sk-ant-x" })["X-Anthropic-Key"], undefined);
});
