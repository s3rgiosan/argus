import { test } from "node:test";
import assert from "node:assert/strict";
import { sortButtons } from "../lib/order.js";

const b = (id, label) => ({ id, label });
const buttons = [b("tsk", "Tasks"), b("usage", "Usage"), b("ports", "ports")];
const ids = (list) => list.map((x) => x.id);

test("sorts A-Z by label, ignoring case, without a stored order", () => {
  assert.deepEqual(ids(sortButtons(buttons, undefined)), ["ports", "tsk", "usage"]);
  assert.deepEqual(ids(sortButtons(buttons, null)), ["ports", "tsk", "usage"]);
  assert.deepEqual(ids(sortButtons(buttons, [])), ["ports", "tsk", "usage"]);
  assert.deepEqual(ids(sortButtons(buttons, "usage")), ["ports", "tsk", "usage"]);
});

test("puts the stored order first and the rest A-Z", () => {
  assert.deepEqual(ids(sortButtons(buttons, ["usage", "tsk"])), ["usage", "tsk", "ports"]);
  assert.deepEqual(ids(sortButtons(buttons, ["usage"])), ["usage", "ports", "tsk"]);
});

test("ignores unknown and repeated ids in the stored order", () => {
  assert.deepEqual(ids(sortButtons(buttons, ["gone", "usage", "usage", 3, "tsk"])), ["usage", "tsk", "ports"]);
});

test("does not change its input and handles a bad list", () => {
  const copy = structuredClone(buttons);
  sortButtons(buttons, ["usage"]);
  assert.deepEqual(buttons, copy);
  assert.deepEqual(sortButtons(null, ["a"]), []);
});
