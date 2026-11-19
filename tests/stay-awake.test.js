import { test } from "node:test";
import assert from "node:assert/strict";
import { MODES, anyWorking, leftClick, rightClick, tick, caffeinateArgs, shouldRun, MAX_RUNS, TICK_MS, EXEC_TIMEOUT_MS } from "../mods/argus-stay-awake/stay-awake.js";

test("constants", () => {
  assert.deepEqual(MODES, ["off", "on", "agents"]);
  assert.deepEqual(caffeinateArgs(), ["-di", "-t", "120"]);
  assert.equal(TICK_MS, 60_000);
  assert.equal(EXEC_TIMEOUT_MS, 150_000);
});

test("anyWorking is true only for a working agent", () => {
  assert.equal(anyWorking([]), false);
  assert.equal(anyWorking(null), false);
  assert.equal(anyWorking(undefined), false);
  assert.equal(anyWorking([{ status: "blocked" }, { status: "idle" }, { status: "done" }]), false);
  assert.equal(anyWorking([{ status: "idle" }, { status: "working" }]), true);
});

test("leftClick toggles between off and on", () => {
  assert.equal(leftClick("off"), "on");
  assert.equal(leftClick("on"), "off");
  assert.equal(leftClick("agents"), "off");
});

test("rightClick starts agents mode only while an agent works", () => {
  assert.deepEqual(rightClick("off", true), { mode: "agents", toast: null });
  assert.deepEqual(rightClick("on", true), { mode: "agents", toast: null });
  assert.deepEqual(rightClick("off", false), { mode: "off", toast: "No agents are working" });
  assert.deepEqual(rightClick("on", false), { mode: "on", toast: "No agents are working" });
});

test("tick ends agents mode when nothing works", () => {
  assert.deepEqual(tick("agents", false), { mode: "off", toast: "Agents finished · display can sleep", keepAwake: false });
  assert.deepEqual(tick("agents", true), { mode: "agents", toast: null, keepAwake: true });
  assert.deepEqual(tick("on", false), { mode: "on", toast: null, keepAwake: true });
  assert.deepEqual(tick("on", true), { mode: "on", toast: null, keepAwake: true });
  assert.deepEqual(tick("off", true), { mode: "off", toast: null, keepAwake: false });
});

test("shouldRun starts a run only when keeping awake and under the cap", () => {
  assert.equal(MAX_RUNS, 3);
  assert.equal(shouldRun(true, 0), true);
  assert.equal(shouldRun(true, 2), true);
  assert.equal(shouldRun(true, 3), false);
  assert.equal(shouldRun(false, 0), false);
});
