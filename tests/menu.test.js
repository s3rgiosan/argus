import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_LIST_MIN, MENU_PAD, footHeight, menuKey, startAt } from "../lib/menu.js";

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

test("menuHeight adds the padding, the rows and the titles, up to the cap", async () => {
  const { menuHeight, MENU_PAD, MENU_ROW, MENU_TITLE } = await import("../lib/menu.js");
  assert.equal(MENU_PAD, 5);
  assert.equal(MENU_ROW, 31);
  assert.equal(MENU_TITLE, 30);
  assert.equal(menuHeight(3), 10 + 93);
  assert.equal(menuHeight(3, 2), 10 + 93 + 60);
  assert.equal(menuHeight(3, 2, { extra: 7 }), 10 + 93 + 60 + 7);
  assert.equal(menuHeight(30, 2, { max: 420 }), 420);
});

test("footHeight: the foot takes its content when it fits", () => {
  const height = 2 * MENU_PAD + 400;
  assert.equal(footHeight(120, 100, height), 120);
  assert.equal(footHeight(277, 340, height), 277);
});

test("footHeight: a long foot leaves the list above its title and three rows", () => {
  const height = 2 * MENU_PAD + 400;
  assert.equal(footHeight(500, 340, height), 400 - MENU_LIST_MIN);
  assert.equal(footHeight(500, 60, height), 340);
  assert.equal(footHeight(500, 0, height), 400);
});
