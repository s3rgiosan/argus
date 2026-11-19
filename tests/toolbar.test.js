import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpen, clickCommands, toolbarOrder } from "../mods/argus-toolbar/toolbar-logic.js";

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

test("toolbarOrder: a missing file gives the default order and no error", () => {
  assert.deepEqual(toolbarOrder(null), { order: null, error: null });
  assert.deepEqual(toolbarOrder(undefined), { order: null, error: null });
});

test("toolbarOrder reads the toolbar order", () => {
  assert.deepEqual(toolbarOrder('{ "toolbar": { "order": ["argus-tsk", "argus-claude-usage"] } }'), {
    order: ["argus-tsk", "argus-claude-usage"],
    error: null,
  });
});

test("toolbarOrder: a file without a toolbar order is fine", () => {
  assert.deepEqual(toolbarOrder("{}"), { order: null, error: null });
  assert.deepEqual(toolbarOrder('{ "toolbar": {} }'), { order: null, error: null });
});

test("toolbarOrder: invalid JSON is an error", () => {
  const result = toolbarOrder("{bad");
  assert.equal(result.order, null);
  assert.equal(typeof result.error, "string");
});

test("toolbarOrder: a wrong shape is an error", () => {
  for (const text of ["[]", "3", "null", '{ "toolbar": 3 }', '{ "toolbar": [] }', '{ "toolbar": { "order": "a" } }', '{ "toolbar": { "order": null } }']) {
    const result = toolbarOrder(text);
    assert.equal(result.order, null, text);
    assert.equal(typeof result.error, "string", text);
  }
});

test("toolbarOrder drops ids that are not non-empty strings", () => {
  assert.deepEqual(toolbarOrder('{ "toolbar": { "order": ["a", 3, "", null, "b"] } }'), { order: ["a", "b"], error: null });
});
