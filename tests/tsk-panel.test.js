import { test } from "node:test";
import assert from "node:assert/strict";
import { expandAction, isExpanded, panelOf } from "../mods/argus-tsk/panel.js";

const tree = (panel) => ({
  id: "root",
  type: "row",
  children: [
    { id: "main", type: "block", content: { tab: "active" } },
    panel,
  ],
});
const argusPanel = (over = {}) => ({
  id: "argus-panel",
  type: "column",
  size: { px: 440 },
  min: 280,
  max: 900,
  children: [
    {
      id: "argus-panels",
      type: "stack",
      children: [
        { id: "argus-claude-usage", type: "block", content: { mod: "argus-claude-usage" } },
        { id: "argus-tsk", type: "block", content: { mod: "argus-tsk" } },
      ],
    },
  ],
  ...over,
});

test("panelOf: reads the panel's width and max when it holds the mod", () => {
  assert.deepEqual(panelOf(tree(argusPanel()), "argus-panel", "argus-tsk"), { px: 440, max: 900 });
  assert.deepEqual(panelOf(tree(argusPanel({ size: { px: 612 } })), "argus-panel", "argus-tsk"), { px: 612, max: 900 });
});
test("panelOf: a missing size or max gives null and the 900 px default", () => {
  assert.deepEqual(panelOf(tree(argusPanel({ size: { weight: 1 }, max: undefined })), "argus-panel", "argus-tsk"), { px: null, max: 900 });
});
test("panelOf: null when the panel is missing or does not hold the mod", () => {
  assert.equal(panelOf(tree({ id: "other", type: "block" }), "argus-panel", "argus-tsk"), null);
  assert.equal(panelOf(tree(argusPanel()), "argus-panel", "ports"), null);
  assert.equal(panelOf(null, "argus-panel", "argus-tsk"), null);
  assert.equal(panelOf("main", "argus-panel", "argus-tsk"), null);
});

test("isExpanded: within 20 px of the max counts as expanded", () => {
  assert.equal(isExpanded({ px: 900, max: 900 }), true);
  assert.equal(isExpanded({ px: 880, max: 900 }), true);
  assert.equal(isExpanded({ px: 879, max: 900 }), false);
  assert.equal(isExpanded({ px: null, max: 900 }), false);
});

test("expandAction: expands to the max and saves the width it had", () => {
  assert.deepEqual(expandAction({ px: 440, max: 900 }, null), { px: 900, save: 440 });
  assert.deepEqual(expandAction({ px: 512, max: 900 }, 600), { px: 900, save: 512 });
});
test("expandAction: an unknown width expands and saves nothing", () => {
  assert.deepEqual(expandAction({ px: null, max: 900 }, 600), { px: 900, save: null });
});
test("expandAction: an expanded panel goes back to the saved width", () => {
  assert.deepEqual(expandAction({ px: 900, max: 900 }, 512), { px: 512, save: null });
  assert.deepEqual(expandAction({ px: 885, max: 900 }, 512), { px: 512, save: null });
});
test("expandAction: without a usable saved width it goes back to 440", () => {
  assert.deepEqual(expandAction({ px: 900, max: 900 }, null), { px: 440, save: null });
  assert.deepEqual(expandAction({ px: 900, max: 900 }, "wide"), { px: 440, save: null });
  assert.deepEqual(expandAction({ px: 900, max: 900 }, 890), { px: 440, save: null });
  assert.deepEqual(expandAction({ px: 900, max: 900 }, 0), { px: 440, save: null });
});
