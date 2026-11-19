import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, panelsFromManifests, STAY_AWAKE_WIDTH } from "../scripts/layout-build.mjs";
import { toolbarWidthFor } from "../scripts/toolbar-seed.mjs";

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
            { id: "panel", type: "column", size: { px: 372 }, children: [{ id: "panel-body", type: "stack", children: [] }] },
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
  assert.deepEqual(row.children.map((c) => [c.id, c.size]), [["tabs", { weight: 1 }], ["argus-toolbar", { px: toolbarWidthFor(panels, "both") }], ["argus-stay-awake", { px: STAY_AWAKE_WIDTH }]]);
  assert.deepEqual(find(out, "argus-stay-awake").content, { mod: "argus-stay-awake" });
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
  assert.deepEqual([column.type, column.size, column.hidden], ["column", { px: 372 }, true]);
  assert.deepEqual([column.min, column.max], [280, 900]);
  const stack = find(out, "argus-panels");
  assert.equal(stack.type, "stack");
  assert.equal(stack.active, "argus-claude-usage");
  assert.deepEqual(stack.children.map((c) => [c.id, c.content]), [
    ["argus-claude-usage", { mod: "argus-claude-usage" }],
    ["ports", { mod: "ports" }],
  ]);
});

test("the panel column copies size, min and max from Herdr's panel block", () => {
  const source = main();
  Object.assign(find(source, "panel"), { size: { px: 412 }, min: 300, max: 760 });
  const column = find(buildLayout(source, panels), "argus-panel");
  assert.deepEqual([column.size, column.min, column.max], [{ px: 412 }, 300, 760]);
});

test("the panel column falls back to 368, 280 and 900 without a Herdr panel block", () => {
  const source = main();
  const body = find(source, "work-body");
  body.children = body.children.filter((child) => child.id !== "panel");
  const column = find(buildLayout(source, panels), "argus-panel");
  assert.deepEqual([column.size, column.min, column.max], [{ px: 368 }, 280, 900]);
});

test("a Herdr panel block with only a size keeps the default min and max", () => {
  const source = main();
  find(source, "panel").size = { px: 401 };
  const column = find(buildLayout(source, panels), "argus-panel");
  assert.deepEqual([column.size, column.min, column.max], [{ px: 401 }, 280, 900]);
});

test("a Herdr panel block sized by weight is copied as it is", () => {
  const source = main();
  Object.assign(find(source, "panel"), { size: { weight: 2 }, min: 250 });
  const column = find(buildLayout(source, panels), "argus-panel");
  assert.deepEqual([column.size, column.min, column.max], [{ weight: 2 }, 250, 900]);
});

test("the copied panel size does not share objects with the input", () => {
  const source = main();
  Object.assign(find(source, "panel"), { size: { px: 377 } });
  const column = find(buildLayout(source, panels), "argus-panel");
  column.size.px = 1;
  assert.equal(find(source, "panel").size.px, 377);
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

test("refuses a layout that already contains the argus blocks", () => {
  assert.throws(() => buildLayout(buildLayout(main(), panels), panels), /main\.json already contains argus blocks/);
});

test("refuses a layout that has only the stay-awake block", () => {
  const out = buildLayout(main(), panels);
  const row = find(out, "argus-tabs-row");
  row.children = row.children.filter((c) => c.id !== "argus-toolbar");
  find(out, "work-body").children = find(out, "work-body").children.filter((c) => c.id !== "argus-panel");
  assert.throws(() => buildLayout(out, panels), /main\.json already contains argus blocks/);
});

test("the toolbar and keep-awake blocks drag the window like Herdr's tab bar block", () => {
  const out = buildLayout(main(), panels);
  assert.equal(find(out, "argus-toolbar").window_drag, true);
  assert.equal(find(out, "argus-stay-awake").window_drag, true);
});

test("a tabs block with window_drag keeps it on the first child of the row", () => {
  const source = main();
  find(source, "tabs").window_drag = true;
  assert.equal(find(buildLayout(source, panels), "tabs").window_drag, true);
});

test("the panel column resizes between 280 and 900 px", () => {
  const column = find(buildLayout(main(), panels), "argus-panel");
  assert.deepEqual([column.min, column.max], [280, 900]);
});

test("leaves out the stay-awake block when the mod is not installed", () => {
  const out = buildLayout(main(), panels, { stayAwake: false });
  assert.equal(find(out, "argus-stay-awake"), null);
  assert.deepEqual(find(out, "argus-tabs-row").children.map((c) => c.id), ["tabs", "argus-toolbar"]);
  assert.deepEqual(find(buildLayout(main(), panels, { stayAwake: true }), "argus-tabs-row").children.map((c) => c.id), ["tabs", "argus-toolbar", "argus-stay-awake"]);
});

test("toolbarWidthFor: both counts padding, icon, label and the gaps between buttons", () => {
  assert.equal(toolbarWidthFor(panels, "both"), 10 + 2 * (16 + 16 + 7 * 5) + 3);
  assert.equal(toolbarWidthFor([], "both"), 10);
  assert.equal(toolbarWidthFor([panels[0]], "both"), 10 + (16 + 16 + 7 * 5));
});

test("toolbarWidthFor: labels drop the icon slot, icons drop the label text", () => {
  assert.equal(toolbarWidthFor(panels, "labels"), 10 + 2 * (16 + 7 * 5) + 3);
  assert.equal(toolbarWidthFor(panels, "icons"), 10 + 2 * (16 + 16) + 3);
});

test("toolbarWidthFor: a panel without an icon has no icon slot and keeps its label in icons mode", () => {
  const mixed = [{ id: "a", label: "Usage", icon: "x.svg" }, { id: "b", label: "Ports", icon: null }];
  assert.equal(toolbarWidthFor(mixed, "icons"), 10 + (16 + 16) + (16 + 7 * 5) + 3);
  assert.equal(toolbarWidthFor(mixed, "both"), 10 + (16 + 16 + 7 * 5) + (16 + 7 * 5) + 3);
  assert.equal(toolbarWidthFor(mixed, "labels"), 10 + 2 * (16 + 7 * 5) + 3);
});

test("toolbarWidthFor: an unknown display counts as both", () => {
  assert.equal(toolbarWidthFor(panels, "x"), toolbarWidthFor(panels, "both"));
});

test("buildLayout sizes the toolbar for the given display", () => {
  const out = buildLayout(main(), panels, { display: "icons" });
  assert.deepEqual(find(out, "argus-toolbar").size, { px: toolbarWidthFor(panels, "icons") });
});

test("panelsFromManifests sorts by id ignoring case", () => {
  const entry = (name) => ({ name, manifest: { panel: { label: name } } });
  const out = panelsFromManifests([entry("Zeta"), entry("alpha"), entry("Beta"), entry("beta")]);
  assert.deepEqual(out.map((p) => p.id), ["alpha", "Beta", "beta", "Zeta"]);
});
