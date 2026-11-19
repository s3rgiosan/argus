import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, panelsFromManifests, toolbarWidth, AWAKE_WIDTH } from "../scripts/layout-build.mjs";

const main = () => ({
  id: "root",
  type: "row",
  titlebar: "none",
  children: [
    { id: "sidebar", type: "column", size: { px: 268 }, children: [{ id: "spaces", type: "block", content: { mod: "spaces" } }] },
    {
      id: "work",
      type: "column",
      children: [
        { id: "tabs", type: "block", size: { px: 42 }, content: { mod: "tabs" } },
        {
          id: "work-body",
          type: "row",
          children: [
            { id: "main", type: "block", content: { tab: "active" } },
            { id: "panel", type: "column", size: { px: 368 }, children: [{ id: "panel-body", type: "stack", children: [] }] },
          ],
        },
        { id: "status", type: "block", size: { px: 28 }, content: { mod: "workspace-status" } },
      ],
    },
  ],
});

const panels = [
  { id: "argus-claude-usage", label: "Usage", icon: "mods/argus-claude-usage/usage.svg" },
  { id: "ports", label: "Ports", icon: "mods/ports/ports.svg" },
];

const find = (node, id) => {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
};

test("wraps the tabs block in a row with the toolbar", () => {
  const out = buildLayout(main(), panels);
  const row = find(out, "argus-tabs-row");
  assert.equal(row.type, "row");
  assert.deepEqual(row.size, { px: 42 });
  assert.equal(row.resizable, false);
  assert.deepEqual(row.children.map((c) => [c.id, c.size]), [["tabs", { weight: 1 }], ["argus-awake", { px: AWAKE_WIDTH }], ["argus-toolbar", { px: toolbarWidth(panels) }]]);
  assert.deepEqual(find(out, "argus-awake").content, { mod: "argus-awake" });
  assert.deepEqual(find(out, "argus-toolbar").content, {
    mod: "argus-toolbar",
    props: { panel: "argus-panel", stack: "argus-panels", buttons: panels },
  });
  assert.deepEqual(find(out, "work").children.map((c) => c.id), ["argus-tabs-row", "work-body", "status"]);
});

test("adds a hidden panel column with one block per panel", () => {
  const out = buildLayout(main(), panels);
  const body = find(out, "work-body");
  assert.deepEqual(body.children.map((c) => c.id), ["main", "panel", "argus-panel"]);
  const column = find(out, "argus-panel");
  assert.deepEqual([column.type, column.size, column.hidden], ["column", { px: 440 }, true]);
  const stack = find(out, "argus-panels");
  assert.equal(stack.type, "stack");
  assert.equal(stack.active, "argus-claude-usage");
  assert.deepEqual(stack.children.map((c) => [c.id, c.content]), [
    ["argus-claude-usage", { mod: "argus-claude-usage" }],
    ["ports", { mod: "ports" }],
  ]);
});

test("toolbar width follows the labels", () => {
  assert.equal(toolbarWidth(panels), 10 + (32 + 7 * 5 + 3) + (32 + 7 * 5 + 3));
  assert.equal(toolbarWidth([]), 10);
});

test("same input, same output; input unchanged", () => {
  const input = main();
  const copy = structuredClone(input);
  assert.deepEqual(buildLayout(input, panels), buildLayout(main(), panels));
  assert.deepEqual(input, copy);
});

test("missing anchors throw", () => {
  const noTabs = main();
  noTabs.children[1].children.shift();
  assert.throws(() => buildLayout(noTabs, panels), /no tabs block/);
  const noBody = main();
  noBody.children[1].children.splice(1, 1);
  assert.throws(() => buildLayout(noBody, panels), /no work-body row/);
});

test("panelsFromManifests keeps mods that declare a panel", () => {
  const out = panelsFromManifests([
    { name: "ports", manifest: { panel: { label: "Ports", icon: "ports.svg" } } },
    { name: "argus-claude-usage", manifest: { panel: { label: "Usage", icon: "usage.svg" } } },
    { name: "spaces", manifest: { place: "left" } },
    { name: "bad", manifest: { panel: { icon: "x.svg" } } },
  ]);
  assert.deepEqual(out, panels);
});

test("panelsFromManifests drops icon paths that leave the mod folder", () => {
  const out = panelsFromManifests([
    { name: "a", manifest: { panel: { label: "A", icon: "../b/x.svg" } } },
    { name: "c", manifest: { panel: { label: "C", icon: "/etc/x.svg" } } },
    { name: "d", manifest: { panel: { label: "D", icon: "icons/ok.svg" } } },
  ]);
  assert.deepEqual(out.map((p) => p.icon), [null, null, "mods/d/icons/ok.svg"]);
});

test("refuses a layout that already has the argus blocks", () => {
  assert.throws(() => buildLayout(buildLayout(main(), panels), panels), /already has the argus blocks/);
});

test("refuses a layout that has only the awake block", () => {
  const out = buildLayout(main(), panels);
  const row = find(out, "argus-tabs-row");
  row.children = row.children.filter((c) => c.id !== "argus-toolbar");
  find(out, "work-body").children = find(out, "work-body").children.filter((c) => c.id !== "argus-panel");
  assert.throws(() => buildLayout(out, panels), /already has the argus blocks/);
});

test("the panel column resizes between 280 and 900 px", () => {
  const column = find(buildLayout(main(), panels), "argus-panel");
  assert.deepEqual([column.min, column.max], [280, 900]);
});
