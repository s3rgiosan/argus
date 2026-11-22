import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReply, mergeEntry, pace, paceText, SESSION_MS } from "../mods/argus-claude-usage/usage.js";

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const line = (inner) =>
  JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "argus-claude-usage", response: inner } });

// 3h 12m before the fixtures' session reset.
const NOW = Date.parse("2026-01-01T11:48:00+00:00");

test("parseReply full", () => {
  const r = parseReply(read("reply-full.json"));
  assert.equal(r.state, "ok");
  assert.equal(r.plan, "Team");
  assert.deepEqual(r.windows.map((w) => [w.kind, w.label, w.used]), [["session", "Session", 40], ["weekly", "Weekly", 55], ["scoped", "Fable", 12]]);
  assert.deepEqual(r.surfaces.map((s) => s.label), ["Claude Code", "Chats", "Cowork"]);
  assert.deepEqual(r.extra, { enabled: true, used: "0.00 USD", limit: "20.00 USD" });
});

test("parseReply signed out", () => {
  assert.equal(parseReply(read("reply-signed-out.json")).state, "signed-out");
});

test("parseReply no-limits", () => {
  assert.equal(parseReply(line({ rate_limits_available: false, rate_limits: null })).state, "no-limits");
});

test("parseReply error subtype keeps Claude's reason", () => {
  const text = JSON.stringify({ type: "control_response", response: { subtype: "error", error: "Not signed in" } });
  const r = parseReply(text);
  assert.equal(r.state, "error");
  assert.equal(r.reason, "Claude Code: Not signed in");
});

test("parseReply finds the reply after noise with braces on the same line", () => {
  assert.equal(parseReply("{noise} " + read("reply-full.json")).state, "ok");
});

test("parseReply empty and noise", () => {
  assert.equal(parseReply("").state, "error");
  assert.equal(parseReply("warning: something\n" + read("reply-full.json")).state, "ok");
});

test("parseReply fallback windows", () => {
  const r = parseReply(line({
    rate_limits_available: true,
    rate_limits: { limits: [], five_hour: { utilization: 40, resets_at: "2026-01-01T15:00:00Z" }, seven_day: { utilization: 10, resets_at: null } },
  }));
  assert.deepEqual(r.windows.map((w) => [w.kind, w.used, w.resetsAt === null]), [["session", 40, false], ["weekly", 10, true]]);
});

test("clamps percent", () => {
  const r = parseReply(line({
    rate_limits_available: true,
    rate_limits: { limits: [
      { kind: "session", percent: 140, resets_at: "2026-01-01T15:00:00Z" },
      { kind: "weekly_all", percent: -3, resets_at: "2026-01-03T00:00:00Z" },
    ] },
  }));
  assert.deepEqual(r.windows.map((w) => w.used), [100, 0]);
  assert.equal(paceText(pace(r.windows[0], NOW)), "Ran out");
});

test("pace matches the reference panel", () => {
  const w = { kind: "session", label: "Session", used: 10, resetsAt: NOW + (3 * 60 + 12) * 60_000, lengthMs: SESSION_MS };
  assert.equal(paceText(pace(w, NOW)), "26% in reserve · Lasts until reset");
});

test("pace deficit runs out", () => {
  const w = { kind: "session", label: "Session", used: 90, resetsAt: NOW + 4 * 3_600_000, lengthMs: SESSION_MS };
  const p = pace(w, NOW);
  assert.equal(p.standing, "deficit");
  assert.equal(p.outlook, "runs-out");
  assert.match(paceText(p), /^70% in deficit · Runs out in \d+m$/);
});

test("pace null for past or unknown reset", () => {
  assert.equal(pace({ kind: "session", label: "S", used: 5, resetsAt: NOW - 1, lengthMs: SESSION_MS }, NOW), null);
  assert.equal(pace({ kind: "session", label: "S", used: 5, resetsAt: null, lengthMs: SESSION_MS }, NOW), null);
});

test("parseReply sorts scoped windows by name, ignoring case", () => {
  const scoped = (name) => ({ kind: "weekly_scoped", percent: 5, resets_at: "2026-01-03T07:00:00+00:00", scope: { model: { display_name: name } } });
  const limits = [scoped("beta"), scoped("Zed"), scoped("alpha"), scoped("Alpha"), scoped("Beta")];
  const r = parseReply(line({ subscription_type: "team", rate_limits_available: true, rate_limits: { limits } }));
  assert.deepEqual(r.windows.map((w) => w.label), ["Alpha", "alpha", "Beta", "beta", "Zed"]);
});

test("mergeEntry keeps a good reply when a fetch fails", () => {
  const good = { state: "ok", windows: [] };
  const err = { state: "error", reason: "No usage reply" };
  const previous = { reply: good, updatedAt: 1000 };
  assert.deepEqual(mergeEntry(previous, err, 2000, 5000), {
    reply: good,
    updatedAt: 1000,
    lastError: { message: "No usage reply", at: 2000 },
  });
  // A second error keeps the same good reply.
  const again = mergeEntry(mergeEntry(previous, err, 2000, 5000), err, 3000, 5000);
  assert.equal(again.updatedAt, 1000);
  assert.equal(again.lastError.at, 3000);
});

test("mergeEntry drops lastError after a good reply", () => {
  const fresh = { state: "ok", windows: [] };
  const previous = { reply: fresh, updatedAt: 1000, lastError: { message: "x", at: 1500 } };
  assert.deepEqual(mergeEntry(previous, fresh, 2000, 5000), { reply: fresh, updatedAt: 2000 });
});

test("mergeEntry uses the error when there is no usable good reply", () => {
  const err = { state: "error", reason: null };
  assert.deepEqual(mergeEntry(undefined, err, 2000, 5000), { reply: err, updatedAt: 2000 });
  assert.deepEqual(mergeEntry({ reply: { state: "ok" }, updatedAt: 1000 }, err, 9000, 5000), { reply: err, updatedAt: 9000 });
  assert.deepEqual(mergeEntry({ reply: { state: "signed-out" }, updatedAt: 1000 }, err, 2000, 5000), { reply: err, updatedAt: 2000 });
});
