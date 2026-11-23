import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addGroup,
  checkName,
  checklist,
  createGuard,
  deleteGroup,
  FLIP_LIMIT,
  FLIP_WINDOW,
  groupOf,
  guardPaused,
  memberKey,
  moveGroup,
  newGroupId,
  pruneSpaces,
  readStore,
  renameGroup,
  sections,
  setMember,
  sortRows,
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

// Rows in the shape of the shipped sidebar's ordered rows: `w` is the space, `g` its git info.
const row = (id, machine = null, repo = null) => ({ w: { id, machine }, g: repo ? { repo, name: repo } : null });
const keyOf = (r) => memberKey(r.w, r.g);
const ids = (rows) => rows.map((r) => r.w.id);
const two = () => addGroup(addGroup(EMPTY, "A", "A"), "B", "B");

test("memberKey: the repo, else the space", () => {
  const repo = JSON.stringify([null, "/home/test/example-repo/.git"]);
  assert.equal(memberKey({ id: "s1" }, { repo }), repo);
  assert.equal(memberKey({ id: "s1" }, null), JSON.stringify(["space", "s1"]));
  assert.equal(memberKey({ id: "s1" }, { repo: 5 }), JSON.stringify(["space", "s1"]));
});

test("groupOf: the group of a key, or null", () => {
  const store = setMember(two(), "k", "B");
  assert.equal(groupOf(store, "k"), "B");
  assert.equal(groupOf(store, "other"), null);
});

test("sortRows: groups in store order, no group last, stable", () => {
  const rows = [row("x"), row("a1"), row("b1"), row("a2"), row("b2")];
  let store = two();
  for (const id of ["a1", "a2"]) store = setMember(store, keyOf(row(id)), "B");
  for (const id of ["b1", "b2"]) store = setMember(store, keyOf(row(id)), "A");
  assert.deepEqual(ids(sortRows(rows, store, keyOf)), ["b1", "b2", "a1", "a2", "x"]);
  assert.deepEqual(ids(rows), ["x", "a1", "b1", "a2", "b2"]);
});

test("sortRows: a worktree stays after its main checkout", () => {
  const rows = [row("b", null, "rb"), row("m", null, "rm"), row("m-wt", null, "rm")];
  const store = setMember(setMember(two(), "rm", "A"), "rb", "B");
  assert.deepEqual(ids(sortRows(rows, store, keyOf)), ["m", "m-wt", "b"]);
});

test("sortRows: never crosses machines", () => {
  const rows = [row("lb"), row("la"), row("rb", "remote1"), row("ra", "remote1")];
  let store = two();
  for (const [id, machine, group] of [["lb", null, "B"], ["la", null, "A"], ["rb", "remote1", "B"], ["ra", "remote1", "A"]]) {
    store = setMember(store, keyOf(row(id, machine)), group);
  }
  assert.deepEqual(ids(sortRows(rows, store, keyOf)), ["la", "lb", "ra", "rb"]);
});

test("sortRows: rows with no git info sort as their space", () => {
  const rows = [row("x"), row("y", null, "ry")];
  const store = setMember(two(), keyOf(row("x")), "A");
  assert.deepEqual(ids(sortRows(rows, store, keyOf)), ["x", "y"]);
  assert.deepEqual(ids(sortRows(rows, EMPTY, keyOf)), ["x", "y"]);
});

test("sections: no groups give one section without a header", () => {
  const rows = [row("x"), row("y")];
  assert.deepEqual(sections(rows, EMPTY, keyOf, { local: true }), [{ group: null, rows, header: false }]);
});

test("sections: one per group, then No group; empty ones only when local", () => {
  const rows = [row("a1"), row("a2")];
  let store = two();
  for (const r of rows) store = setMember(store, keyOf(r), "A");
  const local = sections(rows, store, keyOf, { local: true });
  assert.deepEqual(local.map((s) => [s.group?.id ?? null, ids(s.rows), s.header]), [["A", ["a1", "a2"], true], ["B", [], true], [null, [], true]]);
  const remote = sections(rows, store, keyOf, { local: false });
  assert.deepEqual(remote.map((s) => [s.group?.id ?? null, ids(s.rows)]), [["A", ["a1", "a2"]]]);
});

test("checklist: one entry per key, in first-seen order", () => {
  const rows = [row("m", null, "rm"), row("m-wt", null, "rm"), row("s")];
  const list = checklist(rows, keyOf, (r) => `name-${r.w.id}`);
  assert.deepEqual(list, [{ key: "rm", name: "name-m" }, { key: JSON.stringify(["space", "s"]), name: "name-s" }]);
});

test("guardPaused: three flips within the window pause until the stamp changes", () => {
  assert.equal(FLIP_LIMIT, 3);
  assert.equal(FLIP_WINDOW, 60000);
  const guard = createGuard();
  const ask = (settled, now, stamp = "s1", machine = null) => guardPaused(guard, { machine, stamp, settled, now });
  assert.equal(ask(true, 0), false);
  assert.equal(ask(false, 1000), false);
  assert.equal(ask(true, 2000), false);
  assert.equal(ask(false, 3000), false);
  assert.equal(ask(true, 4000), false);
  assert.equal(ask(false, 5000), true);
  assert.equal(ask(true, 6000), true);
  assert.equal(ask(false, 7000), true);
  assert.equal(ask(false, 8000, "s2"), false);
});

test("guardPaused: flips spread over more than the window do not pause", () => {
  const guard = createGuard();
  const ask = (settled, now) => guardPaused(guard, { machine: null, stamp: "s", settled, now });
  for (const at of [0, 40000, 80000]) {
    ask(true, at);
    assert.equal(ask(false, at + 1), false);
  }
});

test("guardPaused: each machine keeps its own flips, and a first unsettled call is no flip", () => {
  const guard = createGuard();
  const ask = (machine, settled, now) => guardPaused(guard, { machine, stamp: "s", settled, now });
  assert.equal(ask(null, false, 0), false);
  for (const at of [1, 3]) {
    ask(null, true, at);
    ask(null, false, at + 1);
  }
  ask("remote1", true, 5);
  assert.equal(ask("remote1", false, 6), false);
  ask(null, true, 7);
  assert.equal(ask(null, false, 8), true);
  assert.equal(ask("remote1", false, 9), false);
});
