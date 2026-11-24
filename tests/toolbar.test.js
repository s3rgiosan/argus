import { test } from "node:test";
import assert from "node:assert/strict";
import { toolbarSettings, DISPLAYS } from "../lib/argus-file.js";
import { isOpen, clickCommands, touchesFile, measuredResize, waitAfter, badFileToast, SETTLE_MS, POLL_MS } from "../mods/argus-toolbar/toolbar-logic.js";

const tree = (hidden, active) => ({
  id: "root",
  children: [{ id: "argus-panel", hidden, children: [{ id: "argus-panels", active, children: [] }] }],
});
const ids = { panel: "argus-panel", stack: "argus-panels" };

test("isOpen only for the shown panel's active child", () => {
  assert.equal(isOpen(tree(false, "argus-claude-usage"), ids, "argus-claude-usage"), true);
  assert.equal(isOpen(tree(false, "ports"), ids, "argus-claude-usage"), false);
  assert.equal(isOpen(tree(true, "argus-claude-usage"), ids, "argus-claude-usage"), false);
  assert.equal(isOpen({ id: "root", children: [] }, ids, "argus-claude-usage"), false);
});

test("clicking the open button hides the panel", () => {
  assert.deepEqual(clickCommands(tree(false, "argus-claude-usage"), ids, "argus-claude-usage"), [["layout.hide", { id: "argus-panel" }]]);
});

test("clicking another button selects it and shows the panel", () => {
  const expected = [
    ["layout.select", { stack: "argus-panels", child: "argus-claude-usage" }],
    ["layout.show", { id: "argus-panel" }],
  ];
  assert.deepEqual(clickCommands(tree(false, "ports"), ids, "argus-claude-usage"), expected);
  assert.deepEqual(clickCommands(tree(true, "argus-claude-usage"), ids, "argus-claude-usage"), expected);
});

test("toolbarSettings: a missing file gives the default order and no error", () => {
  assert.deepEqual(toolbarSettings(null), { order: null, display: "both", error: null });
  assert.deepEqual(toolbarSettings(undefined), { order: null, display: "both", error: null });
});

test("toolbarSettings reads the toolbar order", () => {
  assert.deepEqual(toolbarSettings('{ "toolbar": { "order": ["argus-tsk", "argus-claude-usage"] } }'), {
    order: ["argus-tsk", "argus-claude-usage"],
    display: "both",
    error: null,
  });
});

test("toolbarSettings: a file without a toolbar order is fine", () => {
  assert.deepEqual(toolbarSettings("{}"), { order: null, display: "both", error: null });
  assert.deepEqual(toolbarSettings('{ "toolbar": {} }'), { order: null, display: "both", error: null });
});

test("toolbarSettings: invalid JSON is an error", () => {
  const result = toolbarSettings("{bad");
  assert.equal(result.order, null);
  assert.equal(result.display, "both");
  assert.equal(typeof result.error, "string");
});

test("toolbarSettings: a wrong shape is an error", () => {
  for (const text of ["[]", "3", "null", '{ "toolbar": 3 }', '{ "toolbar": [] }', '{ "toolbar": { "order": "a" } }', '{ "toolbar": { "order": null } }']) {
    const result = toolbarSettings(text);
    assert.equal(result.order, null, text);
    assert.equal(result.display, "both", text);
    assert.equal(typeof result.error, "string", text);
  }
});

test("toolbarSettings drops ids that are not non-empty strings", () => {
  assert.deepEqual(toolbarSettings('{ "toolbar": { "order": ["a", 3, "", null, "b"] } }'), { order: ["a", "b"], display: "both", error: null });
});

test("toolbarSettings: empty or blank text counts as a missing file", () => {
  assert.deepEqual(toolbarSettings(""), { order: null, display: "both", error: null });
  assert.deepEqual(toolbarSettings(" \n\t "), { order: null, display: "both", error: null });
});

test("touchesFile: only a batch with the file, the folder itself or nothing", () => {
  const dir = "/home/x/.config/herdr-app";
  assert.equal(touchesFile([], dir, "argus.json"), true);
  assert.equal(touchesFile([`${dir}/argus.json`], dir, "argus.json"), true);
  assert.equal(touchesFile([`${dir}/shared.json`, `${dir}/argus.json`], dir, "argus.json"), true);
  assert.equal(touchesFile([dir], dir, "argus.json"), true);
  assert.equal(touchesFile([`${dir}/`], dir, "argus.json"), true);
  assert.equal(touchesFile([`${dir}/shared.json`, `${dir}/data/x.json`, `${dir}/telemetry`], dir, "argus.json"), false);
  assert.equal(touchesFile([`${dir}/data/argus.json`], dir, "argus.json"), false);
});

test("toolbarSettings reads each display value", () => {
  for (const display of ["icons", "labels", "both"]) {
    assert.deepEqual(toolbarSettings(JSON.stringify({ toolbar: { display } })), { order: null, display, error: null });
  }
});

test("toolbarSettings: a missing display is both", () => {
  assert.equal(toolbarSettings("{}").display, "both");
  assert.equal(toolbarSettings('{ "toolbar": { "order": ["a"] } }').display, "both");
});

test("toolbarSettings: an unknown or wrong-type display is both with an error", () => {
  for (const value of ['"text"', '"ICONS"', "3", "null", "[]", "true"]) {
    const result = toolbarSettings(`{ "toolbar": { "display": ${value} } }`);
    assert.equal(result.display, "both", value);
    assert.equal(result.order, null, value);
    assert.equal(typeof result.error, "string", value);
  }
});

test("toolbarSettings: a valid order survives a bad display", () => {
  const result = toolbarSettings('{ "toolbar": { "order": ["a", "b"], "display": "nope" } }');
  assert.deepEqual(result.order, ["a", "b"]);
  assert.equal(result.display, "both");
  assert.equal(typeof result.error, "string");
});

test("toolbarSettings: a valid display survives a bad order", () => {
  const result = toolbarSettings('{ "toolbar": { "order": "a", "display": "icons" } }');
  assert.equal(result.order, null);
  assert.equal(result.display, "icons");
  assert.equal(typeof result.error, "string");
});

test("toolbarSettings: invalid JSON gives the defaults and an error", () => {
  const result = toolbarSettings("{bad");
  assert.deepEqual([result.order, result.display], [null, "both"]);
  assert.equal(typeof result.error, "string");
});

test("toolbarSettings: empty text and a wrong-type file give the defaults", () => {
  assert.deepEqual(toolbarSettings(""), { order: null, display: "both", error: null });
  assert.equal(toolbarSettings("[]").display, "both");
});

test("DISPLAYS lists the three display modes", () => {
  assert.deepEqual(DISPLAYS, ["icons", "labels", "both"]);
});

const sized = (px) => ({ id: "root", children: [{ id: "argus-toolbar", size: { px } }] });

test("measuredResize: the measured row plus the 10 px bar padding, only when the block differs", () => {
  assert.equal(measuredResize(sized(100), "argus-toolbar", 200), 210);
  assert.equal(measuredResize(sized(210), "argus-toolbar", 200), null);
});

test("measuredResize: a fractional measure rounds up", () => {
  assert.equal(measuredResize(sized(100), "argus-toolbar", 200.2), 211);
  assert.equal(measuredResize(sized(211), "argus-toolbar", 200.2), null);
});

test("measuredResize: null without the block, without a usable measure or without a px size", () => {
  assert.equal(measuredResize({ id: "root", children: [] }, "argus-toolbar", 200), null);
  for (const bad of [0, -5, NaN, Infinity, null, undefined, "200"]) assert.equal(measuredResize(sized(100), "argus-toolbar", bad), null, String(bad));
  assert.equal(measuredResize({ id: "root", children: [{ id: "argus-toolbar", size: { weight: 1 } }] }, "argus-toolbar", 200), 210);
  assert.equal(measuredResize(null, "argus-toolbar", 200), null);
});

const DIR = "/home/x/.config/herdr-app";

test("waitAfter: a batch that names the file or the folder settles first", () => {
  assert.equal(waitAfter([`${DIR}/argus.json`], DIR, "argus.json"), SETTLE_MS);
  assert.equal(waitAfter([DIR], DIR, "argus.json"), SETTLE_MS);
});

test("waitAfter: an empty batch (the watch was given up) waits for the poll", () => {
  assert.equal(waitAfter([], DIR, "argus.json"), POLL_MS);
});

test("waitAfter: a batch about other files does not wait", () => {
  assert.equal(waitAfter([`${DIR}/shared.json`], DIR, "argus.json"), 0);
});

test("badFileToast: invalid JSON or shape falls back for the whole file and shows the reason", () => {
  for (const text of ["{bad", "[]", '{ "toolbar": 3 }']) {
    const result = toolbarSettings(text);
    const toast = badFileToast(result.error);
    assert.equal(toast.title, "argus.json could not be read; using the default settings", text);
    assert.equal(toast.body, result.error, text);
    assert.equal(toast.level, "warning");
  }
});

test("badFileToast: one invalid setting says only the invalid settings use defaults", () => {
  for (const text of ['{ "toolbar": { "order": "a" } }', '{ "toolbar": { "display": "text" } }']) {
    const result = toolbarSettings(text);
    const toast = badFileToast(result.error);
    assert.equal(toast.title, "argus.json has invalid settings; using defaults for them", text);
    assert.equal(toast.body, result.error, text);
  }
});
