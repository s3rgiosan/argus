import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAlerts } from "../mods/argus-claude-usage/alerts.js";

const home = "/home/u";
const def = { folder: "/home/u/.claude", isDefault: true };
const work = { folder: "/home/u/.claude-work", isDefault: false, label: "Example Org" };
const NOW = Date.parse("2026-01-01T12:00:00Z");
const RESET = Date.parse("2026-01-01T15:00:00Z");
const ok = (session, weekly) => ({
  reply: {
    state: "ok",
    windows: [
      { kind: "session", label: "Session", used: session, resetsAt: RESET },
      { kind: "weekly", label: "Weekly", used: weekly, resetsAt: RESET + 86_400_000 },
    ],
  },
});

test("dueAlerts fires once per window at the threshold", () => {
  const byFolder = { [def.folder]: ok(70, 10), [work.folder]: ok(85, 91) };
  const first = dueAlerts([def, work], byFolder, {}, { threshold: 80, names: {}, home, now: NOW });
  assert.deepEqual(first.alerts.map((a) => a.title), ["Claude Example Org: session at 85%", "Claude Example Org: weekly at 91%"]);
  assert.match(first.alerts[0].body, /^Resets in 3h 0m$/);
  const again = dueAlerts([def, work], byFolder, first.sent, { threshold: 80, names: {}, home, now: NOW });
  assert.deepEqual(again.alerts, []);
});

test("dueAlerts forgets windows that have reset", () => {
  const { sent } = dueAlerts([work], { [work.folder]: ok(85, 10) }, {}, { threshold: 80, names: {}, home, now: NOW });
  const later = dueAlerts([work], {}, sent, { threshold: 80, names: {}, home, now: RESET + 1 });
  assert.deepEqual(later.sent, {});
});

test("dueAlerts uses the account title", () => {
  const r = dueAlerts([work], { [work.folder]: ok(85, 10) }, {}, { threshold: 80, names: { "~/.claude-work": "Job" }, home, now: NOW });
  assert.equal(r.alerts[0].title, "Claude Job: session at 85%");
});

test("dueAlerts ignores sub-minute jitter in the reset time", () => {
  const jitter = (ms) => ({ reply: { state: "ok", windows: [{ kind: "session", label: "Session", used: 85, resetsAt: RESET + ms }] } });
  const first = dueAlerts([work], { [work.folder]: jitter(225) }, {}, { threshold: 80, names: {}, home, now: NOW });
  const again = dueAlerts([work], { [work.folder]: jitter(32) }, first.sent, { threshold: 80, names: {}, home, now: NOW });
  assert.equal(first.alerts.length, 1);
  assert.deepEqual(again.alerts, []);
});
