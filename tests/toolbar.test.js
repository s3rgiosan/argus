import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpen, clickCommands, toolbarSettings, touchesFile } from "../mods/argus-toolbar/toolbar-logic.js";

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
