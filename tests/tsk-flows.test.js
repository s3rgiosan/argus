import { test } from "node:test";
import assert from "node:assert/strict";
import { answerBlock, applyOptimistic, retryStatus, sendBack, statusOf } from "../mods/argus-tsk/flows.js";

function fakeApi() {
  const api = {
    calls: [],
    replyFail: [],
    statusFail: [],
    async reply(number, text, send) {
      api.calls.push(["reply", number, text, send]);
      if (api.replyFail.length) throw api.replyFail.shift();
    },
    async setStatus(number, change) {
      api.calls.push(["setStatus", number, change]);
      if (api.statusFail.length) throw api.statusFail.shift();
    },
  };
  return api;
}

const names = (api, name) => api.calls.filter((c) => c[0] === name);
const detail = (over = {}) => ({ number: 1, status: "open", assignee: null, dispatch: null, ...over });
const row = (over = {}) => ({ number: 1, status: "open", title: "Example task", assignee: null, ...over });
const START_QUIET = { kind: "start", dispatch: false, again: false, force: false };
const START_LAUNCH = { kind: "start", dispatch: true, again: false, force: false };

test("answerBlock does not repeat the reply when the status call fails", async () => {
  const api = fakeApi();
  api.statusFail.push({ kind: "store", message: "x" });
  const r = await answerBlock(api, detail({ number: 4, status: "blocked" }), "use postgres");
  assert.deepEqual(r, { ok: false, replied: true, error: { kind: "store", message: "x" } });
  assert.equal(names(api, "reply").length, 1);
  await retryStatus(api, detail({ number: 4, assignee: null }));
  assert.equal(names(api, "reply").length, 1);
  assert.equal(names(api, "setStatus").length, 2);
});

test("answerBlock sends the reply to a running agent", async () => {
  const api = fakeApi();
  await answerBlock(api, detail({ number: 4, assignee: "claude", dispatch: {} }), "yes");
  assert.deepEqual(api.calls, [["reply", 4, "yes", true], ["setStatus", 4, START_QUIET]]);
});

test("answerBlock marks an unassigned task ready", async () => {
  const api = fakeApi();
  await answerBlock(api, detail({ number: 4, assignee: null }), "yes");
  assert.deepEqual(api.calls, [["reply", 4, "yes", false], ["setStatus", 4, { kind: "ready" }]]);
});

test("answerBlock relaunches an assigned task that has no dispatch record", async () => {
  const api = fakeApi();
  await answerBlock(api, detail({ number: 4, assignee: "claude" }), "yes");
  assert.deepEqual(api.calls, [["reply", 4, "yes", false], ["setStatus", 4, START_LAUNCH]]);
});

test("answerBlock skips the status call when the reply fails", async () => {
  const api = fakeApi();
  api.replyFail.push({ kind: "usage", message: "no" });
  const r = await answerBlock(api, detail({ number: 4 }), "yes");
  assert.deepEqual(r, { ok: false, replied: false, error: { kind: "usage", message: "no" } });
  assert.equal(names(api, "setStatus").length, 0);
});

test("answerBlock wraps a thrown non-error value", async () => {
  const api = fakeApi();
  api.replyFail.push("boom");
  const r = await answerBlock(api, detail(), "yes");
  assert.deepEqual(r, { ok: false, replied: false, error: { kind: "unexpected", exit: null, message: "boom" } });
});

test("sendBack restarts an unassigned task without launching", async () => {
  const api = fakeApi();
  assert.deepEqual(await sendBack(api, detail({ number: 5, assignee: null }), "fix it"), { ok: true });
  assert.deepEqual(api.calls, [["reply", 5, "fix it", false], ["setStatus", 5, START_QUIET]]);
});

test("sendBack sends feedback to a running agent", async () => {
  const api = fakeApi();
  await sendBack(api, detail({ number: 5, assignee: "claude", dispatch: {} }), "fix it");
  assert.deepEqual(api.calls, [["reply", 5, "fix it", true], ["setStatus", 5, START_QUIET]]);
});

test("sendBack launches an assigned task with no agent", async () => {
  const api = fakeApi();
  await sendBack(api, detail({ number: 5, assignee: "claude" }), "fix it");
  assert.deepEqual(names(api, "setStatus")[0], ["setStatus", 5, START_LAUNCH]);
});

test("retryStatus picks the review or block status", async () => {
  const api = fakeApi();
  await retryStatus(api, detail({ number: 6, status: "review", assignee: "claude", dispatch: {} }));
  await retryStatus(api, detail({ number: 6, status: "blocked", assignee: null }));
  assert.deepEqual(api.calls, [["setStatus", 6, START_QUIET], ["setStatus", 6, { kind: "ready" }]]);
});

test("retryStatus reports a failure as replied", async () => {
  const api = fakeApi();
  api.statusFail.push({ kind: "store", message: "x" });
  const r = await retryStatus(api, detail());
  assert.deepEqual(r, { ok: false, replied: true, error: { kind: "store", message: "x" } });
});

test("applyOptimistic patches status without mutating", () => {
  const rows = [row({ status: "ready" })];
  const out = applyOptimistic(rows, 1, { kind: "done", clean: false });
  assert.equal(out[0].status, "done");
  assert.equal(rows[0].status, "ready");
});

test("statusOf maps each status change to a status", () => {
  assert.equal(statusOf({ kind: "ready" }), "ready");
  assert.equal(statusOf({ kind: "open" }), "open");
  assert.equal(statusOf(START_QUIET), "started");
  assert.equal(statusOf({ kind: "blocked", why: null, needs: null, options: [], on: null }), "blocked");
  assert.equal(statusOf({ kind: "review", done: null, checks: [], next: null, on: null }), "review");
  assert.equal(statusOf({ kind: "done", clean: true }), "done");
});

test("applyOptimistic leaves other rows alone", () => {
  const rows = [row({ number: 1 }), row({ number: 2 })];
  const out = applyOptimistic(rows, 1, { kind: "ready" });
  assert.equal(out[0].status, "ready");
  assert.equal(out[1], rows[1]);
});
