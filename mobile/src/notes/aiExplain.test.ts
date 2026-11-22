import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_MAX_ITEMS, STUDY_MAX_PAGES, STUDY_PAGE_TEXT, aiAccess, planText, requestExplain, requestStudyNote, type AiConn } from "./aiExplain.ts";

const C: AiConn = { serverUrl: "srv.example.com/", accessCode: "code-123", session: "sess-1" };

/** 주소마다 답을 정한 가짜 fetch (보낸 요청은 calls에 남는다) */
function fakeFetch(routes: Record<string, { status?: number; body: unknown } | "down">) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r || r === "down") throw new TypeError("network");
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("who can use AI explanations: server, login, server key, then the plan", async () => {
  assert.equal((await aiAccess(null)).ok, false);
  const noServer = await aiAccess({ serverUrl: "", accessCode: "", session: "" });
  assert.equal(!noServer.ok && noServer.why, "no-server");
  const noLogin = await aiAccess({ ...C, session: "" });
  assert.equal(!noLogin.ok && noLogin.why, "no-login");

  const noKey = fakeFetch({ "/api/state": { body: { server: true, server_key: false } } });
  const a = await aiAccess(C, noKey.f);
  assert.equal(!a.ok && a.why, "no-ai");

  const plan = { plan: "premium", label: "프리미엄", used: 2, limit: 100 };
  const ok = fakeFetch({ "/api/state": { body: { server_key: true } }, "/api/account/ai": { body: plan } });
  const b = await aiAccess(C, ok.f);
  assert.deepEqual(b, { ok: true, plan });
  // https가 붙고 끝 / 는 빠진 주소, 접속 코드와 로그인 세션을 보낸다
  assert.equal(ok.calls[1].url, "https://srv.example.com/api/account/ai");
  const h = ok.calls[1].init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer code-123");
  assert.equal(h["X-Session"], "sess-1");
  assert.equal(planText(plan), "프리미엄 · 이번 달 2/100번 썼어요");

  const expired = fakeFetch({ "/api/state": { body: { server_key: true } }, "/api/account/ai": { status: 401, body: { error: "x" } } });
  const c = await aiAccess(C, expired.f);
  assert.equal(!c.ok && c.why, "no-login");
  const down = await aiAccess(C, fakeFetch({ "/api/state": "down" }).f);
  assert.equal(!down.ok && down.why, "offline");
});

test("asking for explanations sends the items and passes the server's reason on failure", async () => {
  const items = Array.from({ length: AI_MAX_ITEMS + 5 }, (_, i) => ({ id: String(i), tag: "핵심", text: `말 ${i}`, sentence: "", memo: "" }));
  const ok = fakeFetch({ "/api/ai/explain": { body: { items: [{ id: "0", explain: "설명" }], ai: { plan: "free", label: "무료", used: 1, limit: 3 } } } });
  const r = await requestExplain(C, "교재", items, ok.f);
  assert.deepEqual(r.items, [{ id: "0", explain: "설명" }]);
  assert.equal(r.plan.used, 1);
  const sent = JSON.parse(String(ok.calls[0].init.body));
  assert.equal(sent.book, "교재");
  assert.equal(sent.items.length, AI_MAX_ITEMS); // 서버가 받는 만큼만 (화면이 미리 알려 준다)

  const quota = fakeFetch({ "/api/ai/explain": { status: 429, body: { error: "이번 달 AI 설명을 다 썼어요 (3번)." } } });
  await assert.rejects(requestExplain(C, "교재", items.slice(0, 1), quota.f), (e: Error & { status: number }) => e.status === 429 && /다 썼어요/.test(e.message));
  const premium = fakeFetch({ "/api/ai/explain": { status: 402, body: { error: "AI 설명은 프리미엄 기능이에요." } } });
  await assert.rejects(requestExplain(C, "교재", items.slice(0, 1), premium.f), /프리미엄/);
  await assert.rejects(requestExplain(C, "교재", items.slice(0, 1), fakeFetch({}).f), /닿지 않아요/);
});

test("study note request sends the marked pages (text trimmed to what the server takes)", async () => {
  const pages = Array.from({ length: STUDY_MAX_PAGES + 3 }, (_, i) => ({ page: i + 1, text: "가".repeat(STUDY_PAGE_TEXT + 50), marks: [] }));
  const ok = fakeFetch({ "/api/ai/studynote": { body: { sections: [{ title: "S01", intro: "", blocks: [], points: [], strategy: "" }], ai: { plan: "premium", label: "프리미엄", used: 3, limit: 100 } } } });
  const r = await requestStudyNote(C, "정보기실기", pages, ok.f);
  assert.equal(r.sections[0].title, "S01");
  assert.equal(r.plan.used, 3);
  const sent = JSON.parse(String(ok.calls[0].init.body));
  assert.equal(sent.pages.length, STUDY_MAX_PAGES);
  assert.equal(sent.pages[0].text.length, STUDY_PAGE_TEXT);
  const busy = fakeFetch({ "/api/ai/studynote": { status: 503, body: { error: "Gemini 오류 (503). 잠시 뒤 다시 해 주세요." } } });
  await assert.rejects(requestStudyNote(C, "책", pages.slice(0, 1), busy.f), /503/);
});
