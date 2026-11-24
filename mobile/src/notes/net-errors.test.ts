// 대답 없는 서버·깨진 PDF: 끝없이 기다리지 않는지, 영어 오류가 그대로 나오지 않는지 (가짜 fetch로, 서버 없이)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, Client, type Settings } from "../api.ts";
import { EXPORT_PDF_MAX, LONG_MS, NO_ANSWER, SHORT_MS, STALL_MS, bigPdfMessage, pdfOpenMessage, withTimeLimit } from "./net-errors.ts";

const S: Settings = { serverUrl: "http://192.168.0.9:8000", accessCode: "code", apiKey: "" };

/** 연결은 받지만 대답을 안 하는 서버: 멈추라는 신호가 와야 끝난다 */
function silentFetch() {
  const seen: { signal?: AbortSignal | null } = {};
  const f = ((_url: RequestInfo | URL, init?: RequestInit) => {
    seen.signal = init?.signal;
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
    });
  }) as typeof fetch;
  return { f, seen };
}

test("대답 없는 서버: 연결 확인은 12초쯤 뒤 한국어 안내로 끝난다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { f, seen } = silentFetch();
  const p = new Client(S, f).state();
  let settled = false;
  p.catch(() => (settled = true));
  t.mock.timers.tick(SHORT_MS - 1);
  await Promise.resolve();
  assert.equal(settled, false, "시간이 되기 전에는 기다린다");
  t.mock.timers.tick(1);
  await assert.rejects(p, (e: Error) => e instanceof ApiError && e.message === NO_ANSWER);
  assert.equal(seen.signal?.aborted, true, "요청도 멈춘다");
});

test("대답 없는 서버: 오래 걸리는 요청(색 찾기)은 더 기다렸다가 끝난다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const p = new Client(S, silentFetch().f).colors("abc");
  let settled = false;
  p.catch(() => (settled = true));
  t.mock.timers.tick(SHORT_MS * 2);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(LONG_MS);
  await assert.rejects(p, /대답하지 않아요/);
});

test("서버에 못 닿거나 다른 웹사이트 주소일 때: 영어 오류가 아니라 한국어 안내", async () => {
  const down = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(new Client(S, down).state(), /서버에 연결할 수 없어요/);
  await assert.rejects(new Client(S, down).resultText("job1"), /서버에 연결할 수 없어요/);
  const web = (async () => new Response("<!doctype html><title>hi</title>", { status: 200 })) as typeof fetch;
  await assert.rejects(new Client(S, web).state(), (e: Error) => e instanceof ApiError && /서버 주소/.test(e.message) && !/[a-z]{4,}/i.test(e.message));
});

test("제때 온 대답과 서버의 오류 글은 그대로", async () => {
  const good = (async () => new Response(JSON.stringify({ server: true, version: "1.2" }), { status: 200 })) as typeof fetch;
  assert.equal((await new Client(S, good).state()).version, "1.2");
  const denied = (async () => new Response("{}", { status: 403 })) as typeof fetch;
  await assert.rejects(new Client(S, denied).state(), /접속 코드가 맞지 않아요/);
});

test("올리기용 시간 제한: 진행이 있으면 다시 재고, 진행이 멈추면 끊는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let touch: (ms?: number) => void = () => {};
  let stopped = false;
  const p = withTimeLimit(STALL_MS, () => new ApiError(NO_ANSWER), ({ signal, alive }) => {
    touch = alive;
    signal.addEventListener("abort", () => (stopped = true));
    return new Promise<string>(() => {});
  });
  let settled = false;
  p.catch(() => (settled = true));
  // 20초마다 진행이 오면 2분이 지나도 끊지 않는다
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(20000);
    touch();
  }
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(stopped, false);
  // 다 보낸 뒤에는 더 긴 시간을 줄 수 있다
  touch(90000);
  t.mock.timers.tick(60000);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(30000);
  await assert.rejects(p, /대답하지 않아요/);
  assert.equal(stopped, true);
});

test("시간 제한: 제때 끝난 일의 결과·오류는 그대로 넘긴다", async () => {
  assert.equal(await withTimeLimit(1000, () => new Error("늦음"), async () => "ok"), "ok");
  await assert.rejects(withTimeLimit(1000, () => new Error("늦음"), async () => {
    throw new Error("원래 오류");
  }), /원래 오류/);
  await assert.rejects(withTimeLimit(1000, () => new Error("늦음"), () => {
    throw new Error("바로 던진 오류");
  }), /바로 던진 오류/);
});

test("PDF를 못 열 때: 영어 글을 붙이지 않고 경우에 맞는 말", () => {
  assert.equal(pdfOpenMessage("Invalid PDF structure."), "PDF 파일이 깨졌거나 PDF가 아니에요.");
  assert.equal(pdfOpenMessage("The PDF file is empty, i.e. its size is zero bytes."), "빈 파일이에요. 다른 파일을 골라 주세요.");
  assert.equal(pdfOpenMessage("No password given"), "암호가 걸린 PDF는 가져올 수 없어요.");
  assert.equal(pdfOpenMessage("Call to function 'PdfPages.infoAsync' has been rejected.\n→ Caused by: 암호가 걸린 PDF예요."), "암호가 걸린 PDF는 가져올 수 없어요.");
  assert.equal(pdfOpenMessage("쪽이 없는 PDF예요."), "PDF를 열 수 없어요. 쪽이 없는 PDF예요.");
  for (const raw of ["Unexpected server response (0)", "Call to function 'PdfPages.infoAsync' has been rejected.\n→ Caused by: PDF를 열 수 없어요.", "PDF를 열 수 없어요.", ""]) {
    const m = pdfOpenMessage(raw);
    assert.match(m, /^PDF를 열 수 없어요\. /);
    assert.doesNotMatch(m.replace(/PDF/g, ""), /[A-Za-z]/, m);
    assert.doesNotMatch(m, /열 수 없어요.*열 수 없어요/, m);
  }
});

test("아주 큰 PDF: 메모리가 모자라면 그렇다고, 내보내기는 미리 알린다", () => {
  const oom = "Call to function 'FileSystemFile.bytes' has been rejected.\n→ Caused by: java.lang.OutOfMemoryError: Failed to allocate a 261862880 byte allocation";
  assert.match(pdfOpenMessage(oom), /너무 커서/);
  assert.equal(bigPdfMessage(null), null); // 크기를 모르면 해 본다
  assert.equal(bigPdfMessage(EXPORT_PDF_MAX), null);
  assert.match(bigPdfMessage(261862877) ?? "", /^원본 PDF가 너무 커서\(250MB\) 필기를 합친 PDF로 내보낼 수 없어요/);
  assert.match(bigPdfMessage(261862877, "노트 파일") ?? "", /노트 파일로 내보낼 수 없어요/);
});
