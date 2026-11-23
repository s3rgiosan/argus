import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addGroup,
  checkName,
  deleteGroup,
  moveGroup,
  newGroupId,
  pruneSpaces,
  readStore,
  renameGroup,
  setMember,
} from "../lib/space-groups.js";

const EMPTY = { groups: [], members: {} };

test("readStore: bad values give an empty store", () => {
  for (const value of [null, undefined, "x", 5, [], { groups: "x" }, { groups: [], members: [] }]) {
    assert.deepEqual(readStore(value), EMPTY);
  }
});

test("readStore: drops bad groups and members", () => {
  const value = {
    groups: [
      { id: "a", name: " Example group " },
      { id: "a", name: "Dup" },
      { id: "", name: "x" },
      { id: "b", name: "" },
      { id: "c", name: "x".repeat(41) },
      null,
    ],
    members: { k1: "a", k2: "gone", k3: 5 },
  };
  assert.deepEqual(readStore(value), { groups: [{ id: "a", name: "Example group" }], members: { k1: "a" } });
});

test("readStore: returns a new object", () => {
  const value = { groups: [{ id: "a", name: "A" }], members: { k: "a" } };
  const store = readStore(value);
  store.groups.push({ id: "b", name: "B" });
  store.members.k2 = "a";
  assert.deepEqual(value, { groups: [{ id: "a", name: "A" }], members: { k: "a" } });
});

test("checkName: refuses empty, long, taken and reserved names", () => {
  const store = addGroup(EMPTY, "Example group", "a");
  assert.equal(checkName(store, ""), "Give the group a name.");
  assert.equal(checkName(store, "   "), "Give the group a name.");
  assert.equal(checkName(store, "x".repeat(41)), "Use 40 characters or fewer.");
  assert.equal(checkName(store, "x".repeat(40)), null);
  assert.equal(checkName(store, " example GROUP "), "Another group has this name.");
  assert.equal(checkName(store, "example GROUP", "a"), null);
  assert.equal(checkName(store, "no group"), "This name is kept for spaces without a group.");
  assert.equal(checkName(store, "Personal"), null);
});

test("addGroup, renameGroup, moveGroup, deleteGroup: edit a copy", () => {
  let store = addGroup(addGroup(addGroup(EMPTY, "A", "a"), "B", "b"), "C", "c");
  assert.deepEqual(store.groups.map((g) => g.id), ["a", "b", "c"]);
  const before = structuredClone(store);
  const moved = moveGroup(store, "c", -1);
  assert.deepEqual(moved.groups.map((g) => g.id), ["a", "c", "b"]);
  assert.deepEqual(moveGroup(store, "a", -1).groups.map((g) => g.id), ["a", "b", "c"]);
  assert.deepEqual(moveGroup(store, "c", 1).groups.map((g) => g.id), ["a", "b", "c"]);
  assert.deepEqual(moveGroup(store, "a", 1).groups.map((g) => g.id), ["b", "a", "c"]);
  assert.equal(renameGroup(store, "b", " Bee ").groups[1].name, "Bee");
  store = setMember(setMember(store, "k1", "a"), "k2", "b");
  const deleted = deleteGroup(store, "a");
  assert.deepEqual(deleted.groups.map((g) => g.id), ["b", "c"]);
  assert.deepEqual(deleted.members, { k2: "b" });
  assert.deepEqual(before.groups.map((g) => g.id), ["a", "b", "c"]);
  assert.equal(addGroup(EMPTY, " Trimmed ", "t").groups[0].name, "Trimmed");
});

test("setMember and pruneSpaces: set, remove and drop closed spaces", () => {
  let store = addGroup(EMPTY, "A", "a");
  store = setMember(store, "k", "a");
  assert.deepEqual(store.members, { k: "a" });
  assert.deepEqual(setMember(store, "k", null).members, {});
  assert.deepEqual(store.members, { k: "a" });
  const repo = JSON.stringify([null, "/home/test/example-repo/.git"]);
  const s1 = JSON.stringify(["space", "s1"]);
  const s2 = JSON.stringify(["space", "s2"]);
  store = { groups: store.groups, members: { [s1]: "a", [s2]: "a", [repo]: "a" } };
  assert.deepEqual(pruneSpaces(store, new Set(["s1"])).members, { [s1]: "a", [repo]: "a" });
});

test("newGroupId: a g- id from the time and random characters", () => {
  assert.match(newGroupId(0, () => 0.5), /^g-0-[0-9a-z]{6}$/);
  assert.notEqual(newGroupId(1000, () => 0.1), newGroupId(1000, () => 0.9));
});
