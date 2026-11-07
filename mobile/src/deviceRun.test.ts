// 기기 안 AI 일감 처리: 길면 짧은 판으로, 바쁘면 한 번 더, 못 쓰게 되면 멈춤.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDeviceTasks, type DeviceTask } from "./deviceRun.ts";

const T = (id: string): DeviceTask => ({ id, title: id, instructions: "지시", prompt: `긴 ${id}`, fallback: `짧은 ${id}` });
const err = (code: string) => Object.assign(new Error(code), { code });
const noWait = { wait: async () => {} };

test("answers every task and reports progress", async () => {
  const seen: number[] = [];
  const r = await runDeviceTasks([T("a"), T("b")], async (_i, p) => `1: ${p}`, (d) => seen.push(d), noWait);
  assert.deepEqual(r.answers, { a: "1: 긴 a", b: "1: 긴 b" });
  assert.equal(r.done, 2);
  assert.deepEqual(seen, [0, 1, 2]);
});

test("too long → retries with the short version; refusal → skips only that task", async () => {
  const r = await runDeviceTasks([T("a"), T("b"), T("c")], async (_i, p) => {
    if (p === "긴 a") throw err("ERR_CONTEXT");
    if (p === "긴 b") throw err("ERR_REFUSED");
    return `ok ${p}`;
  }, undefined, noWait);
  assert.deepEqual(r.answers, { a: "ok 짧은 a", c: "ok 긴 c" });
  assert.equal(r.skipped, 1);
  assert.equal(r.stopped, undefined);
});

test("busy → waits and retries once", async () => {
  let n = 0;
  const r = await runDeviceTasks([T("a")], async () => {
    n++;
    if (n === 1) throw err("ERR_BUSY");
    return "ok";
  }, undefined, noWait);
  assert.equal(r.done, 1);
  assert.equal(n, 2);
});

test("device AI becomes unusable → stops and keeps earlier answers", async () => {
  const r = await runDeviceTasks([T("a"), T("b"), T("c")], async (_i, p) => {
    if (p === "긴 b") throw err("ERR_BACKGROUND");
    return "ok";
  }, undefined, noWait);
  assert.deepEqual(Object.keys(r.answers), ["a"]);
  assert.match(r.stopped ?? "", /화면/);
});

test("user stop", async () => {
  let calls = 0;
  const r = await runDeviceTasks([T("a"), T("b")], async () => (calls++, "ok"), undefined, { ...noWait, shouldStop: () => calls >= 1 });
  assert.equal(r.done, 1);
  assert.ok(r.stopped);
});
