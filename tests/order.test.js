import { test } from "node:test";
import assert from "node:assert/strict";
import { sortButtons, moveUp, moveDown, canMoveUp, canMoveDown } from "../lib/order.js";

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

test("moveUp and moveDown swap neighbours and return a new list", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveUp(list, 1), ["b", "a", "c"]);
  assert.deepEqual(moveDown(list, 1), ["a", "c", "b"]);
  assert.deepEqual(list, ["a", "b", "c"]);
});

test("moveUp and moveDown do nothing at the ends or out of range", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveUp(list, 0), list);
  assert.deepEqual(moveDown(list, 2), list);
  assert.deepEqual(moveUp(list, 9), list);
  assert.deepEqual(moveDown(list, -1), list);
});

test("canMoveUp and canMoveDown follow the position", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual([0, 1, 2].map((i) => canMoveUp(i)), [false, true, true]);
  assert.deepEqual([0, 1, 2].map((i) => canMoveDown(list, i)), [true, true, false]);
  assert.equal(canMoveDown(["a"], 0), false);
});
