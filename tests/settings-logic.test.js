import { test } from "node:test";
import assert from "node:assert/strict";
import { toolbarButtons } from "../mods/argus-settings/settings-logic.js";

const buttons = [{ id: "a", label: "A", icon: "mods/a/a.svg" }];
const tree = { id: "root", children: [{ id: "row", children: [{ id: "argus-toolbar", content: { mod: "argus-toolbar", props: { buttons } } }] }] };

test("toolbarButtons reads the toolbar block's buttons", () => {
  assert.deepEqual(toolbarButtons(tree), buttons);
});

test("toolbarButtons is empty without a toolbar or buttons", () => {
  assert.deepEqual(toolbarButtons({ id: "root", children: [] }), []);
  assert.deepEqual(toolbarButtons(null), []);
  assert.deepEqual(toolbarButtons({ id: "argus-toolbar", content: { props: { buttons: "x" } } }), []);
});
