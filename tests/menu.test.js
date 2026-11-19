import { test } from "node:test";
import assert from "node:assert/strict";
import { menuKey, startAt } from "../lib/menu.js";

test("menuKey: down moves to the next row and wraps", () => {
  assert.deepEqual(menuKey(0, "down", 3), { handled: true, at: 1, action: null });
  assert.deepEqual(menuKey(2, "down", 3), { handled: true, at: 0, action: null });
});

test("menuKey: up moves to the previous row and wraps", () => {
  assert.deepEqual(menuKey(2, "up", 3), { handled: true, at: 1, action: null });
  assert.deepEqual(menuKey(0, "up", 3), { handled: true, at: 2, action: null });
});

test("menuKey: enter picks the row, escape closes", () => {
  assert.deepEqual(menuKey(1, "enter", 3), { handled: true, at: 1, action: "pick" });
  assert.deepEqual(menuKey(1, "escape", 3), { handled: true, at: 1, action: "close" });
});

test("menuKey: other keys are not handled", () => {
  assert.deepEqual(menuKey(1, "a", 3), { handled: false, at: 1, action: null });
  assert.deepEqual(menuKey(1, "tab", 3), { handled: false, at: 1, action: null });
});

test("menuKey: an empty menu only closes", () => {
  assert.deepEqual(menuKey(0, "down", 0), { handled: true, at: 0, action: null });
  assert.deepEqual(menuKey(0, "enter", 0), { handled: true, at: 0, action: null });
  assert.deepEqual(menuKey(0, "escape", 0), { handled: true, at: 0, action: "close" });
});

test("menuKey: an out-of-range row counts from the start", () => {
  assert.deepEqual(menuKey(9, "down", 3), { handled: true, at: 1, action: null });
  assert.deepEqual(menuKey(-4, "up", 3), { handled: true, at: 2, action: null });
});

test("startAt: the current row, else the first", () => {
  assert.equal(startAt([{ current: false }, { current: true }]), 1);
  assert.equal(startAt([{ current: false }]), 0);
  assert.equal(startAt([]), 0);
});
