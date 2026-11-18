import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpen, clickCommands } from "../mods/argus-toolbar/toolbar-logic.js";

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
