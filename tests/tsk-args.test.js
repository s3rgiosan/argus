import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listArgs,
  taskArgs,
  addArgs,
  statusArgs,
  editArgs,
  stepsArgs,
  replyArgs,
  archiveArgs,
  projectTitleArgs,
  withStateDir,
} from "../mods/argus-tsk/tsk.js";

const live = { shelf: "live", group: "none", sort: "recent" };

test("desk scope", () => {
  assert.deepEqual(listArgs({ kind: "desk" }, live), ["list", "--desk", "--json"]);
});

test("project scope passes full path", () => {
  assert.deepEqual(
    listArgs({ kind: "project", project: "/home/test/client/site" }, live),
    ["list", "--project=/home/test/client/site", "--json"],
  );
});

test("thread scope spans all", () => {
  assert.deepEqual(listArgs({ kind: "thread", name: "release" }, live), [
    "list", "--all", "--thread=release", "--json",
  ]);
});

test("assignee scope spans all", () => {
  assert.deepEqual(listArgs({ kind: "assignee", name: "me" }, live), [
    "list", "--all", "--assignee=me", "--json",
  ]);
});

test("done shelf drops group and sort", () => {
  const o = { shelf: "done", group: "thread", sort: "title" };
  assert.deepEqual(listArgs({ kind: "all" }, o), ["list", "--all", "--done", "--json"]);
});

test("project group and sort need the all scope", () => {
  const o = { shelf: "live", group: "project", sort: "project" };
  assert.deepEqual(listArgs({ kind: "desk" }, o), ["list", "--desk", "--json"]);
  assert.deepEqual(
    listArgs({ kind: "project", project: "/home/test/site" }, o),
    ["list", "--project=/home/test/site", "--json"],
  );
  assert.deepEqual(listArgs({ kind: "all" }, o), [
    "list", "--all", "--group=project", "--sort=project", "--json",
  ]);
  assert.deepEqual(listArgs({ kind: "thread", name: "auth" }, o), [
    "list", "--all", "--thread=auth", "--group=project", "--sort=project", "--json",
  ]);
});

test("other group and sort stay on a single project scope", () => {
  const o = { shelf: "live", group: "thread", sort: "title" };
  assert.deepEqual(listArgs({ kind: "desk" }, o), [
    "list", "--desk", "--group=thread", "--sort=title", "--json",
  ]);
});

test("archived shelf drops group and sort", () => {
  const o = { shelf: "archived", group: "project", sort: "assignee" };
  assert.deepEqual(listArgs({ kind: "desk" }, o), [
    "list", "--desk", "--archived", "--json",
  ]);
});

test("task detail", () => {
  assert.deepEqual(taskArgs(12), ["list", "T12", "--json"]);
});

test("add with all fields", () => {
  const c = {
    title: "Fix it",
    notes: "details",
    project: "/home/test/site",
    thread: "auth",
    assignee: "me",
  };
  assert.deepEqual(addArgs(c), [
    "add", "--title=Fix it", "--notes=details", "--project=/home/test/site",
    "--thread=auth", "--assignee=me", "--json",
  ]);
});

test("dash values use the equals form", () => {
  assert.deepEqual(addArgs({ title: "-5 degrees" }), [
    "add", "--title=-5 degrees", "--desk", "--json",
  ]);
  assert.deepEqual(
    addArgs({ title: "x", notes: null, project: null, thread: null, assignee: null }),
    ["add", "--title=x", "--desk", "--json"],
  );
});

test("dash positional text follows double dash", () => {
  assert.deepEqual(
    stepsArgs(3, { kind: "add", text: "--force", place: { kind: "first" } }),
    ["steps", "T3", "add", "--first", "--", "--force"],
  );
  assert.deepEqual(replyArgs(3, "-1", true), ["reply", "T3", "--send", "--", "-1"]);
  assert.deepEqual(replyArgs(3, "hi", false), ["reply", "T3", "--", "hi"]);
});

test("step ops", () => {
  assert.deepEqual(stepsArgs(3, { kind: "toggle", id: "a3" }), ["steps", "T3", "toggle", "a3"]);
  assert.deepEqual(stepsArgs(3, { kind: "rename", id: "a3", text: "New" }), [
    "steps", "T3", "rename", "a3", "--", "New",
  ]);
  assert.deepEqual(
    stepsArgs(3, { kind: "move", id: "a3", place: { kind: "before", id: "b1" } }),
    ["steps", "T3", "move", "a3", "--before=b1"],
  );
  assert.deepEqual(stepsArgs(3, { kind: "add", text: "Do", place: null }), [
    "steps", "T3", "add", "--", "Do",
  ]);
  assert.deepEqual(stepsArgs(3, { kind: "add", text: "Do" }), [
    "steps", "T3", "add", "--", "Do",
  ]);
  assert.deepEqual(stepsArgs(3, { kind: "remove", id: "a3" }), ["steps", "T3", "remove", "a3"]);
  assert.deepEqual(
    stepsArgs(3, { kind: "move", id: "a3", place: { kind: "after", id: "b1" } }),
    ["steps", "T3", "move", "a3", "--after=b1"],
  );
  assert.deepEqual(
    stepsArgs(3, { kind: "move", id: "a3", place: { kind: "last" } }),
    ["steps", "T3", "move", "a3", "--last"],
  );
});

test("status simple changes", () => {
  assert.deepEqual(statusArgs(4, { kind: "open" }), ["status", "T4", "open"]);
  assert.deepEqual(statusArgs(4, { kind: "ready" }), ["status", "T4", "ready"]);
});

test("start without dispatch", () => {
  assert.deepEqual(
    statusArgs(4, { kind: "start", dispatch: false, again: false, force: false }),
    ["status", "T4", "started", "--no-dispatch"],
  );
});

test("start with dispatch adds no dispatch flag", () => {
  assert.deepEqual(
    statusArgs(4, { kind: "start", dispatch: true, again: false, force: false }),
    ["status", "T4", "started"],
  );
});

test("start again with force", () => {
  assert.deepEqual(
    statusArgs(4, { kind: "start", dispatch: true, again: true, force: true }),
    ["status", "T4", "started", "--again", "--force"],
  );
});

test("done clean", () => {
  assert.deepEqual(statusArgs(4, { kind: "done", clean: true }), [
    "status", "T4", "done", "--clean",
  ]);
  assert.deepEqual(statusArgs(4, { kind: "done", clean: false }), ["status", "T4", "done"]);
});

test("blocked card", () => {
  const c = {
    kind: "blocked",
    why: "which db?",
    needs: null,
    options: ["postgres", "sqlite"],
    on: null,
  };
  assert.deepEqual(statusArgs(5, c), [
    "status", "T5", "blocked", "--why=which db?", "--option=postgres", "--option=sqlite",
  ]);
});

test("review card", () => {
  const c = {
    kind: "review",
    done: "built",
    checks: ["a", "b"],
    next: "ship",
    on: "T9",
  };
  assert.deepEqual(statusArgs(5, c), [
    "status", "T5", "review", "--done=built", "--check=a", "--check=b",
    "--next=ship", "--on=T9",
  ]);
});

test("edit unassign and clear after", () => {
  const e = { title: null, notes: "", assignee: null, unassign: true, after: [], on: null };
  assert.deepEqual(editArgs(6, e), [
    "edit", "T6", "--notes=", "--unassign", "--clear-after",
  ]);
});

test("edit after list", () => {
  const e = { title: "New", assignee: "me", unassign: false, after: [2, 8] };
  assert.deepEqual(editArgs(6, e), [
    "edit", "T6", "--title=New", "--assignee=me", "--after=T2", "--after=T8",
  ]);
});

test("edit unassign wins over assignee", () => {
  assert.deepEqual(editArgs(6, { assignee: "me", unassign: true }), [
    "edit", "T6", "--unassign",
  ]);
});

test("archive and restore", () => {
  assert.deepEqual(archiveArgs(7, true), ["archive", "T7"]);
  assert.deepEqual(archiveArgs(7, false), ["unarchive", "T7"]);
});

test("withStateDir appends the flag only when a dir is set", () => {
  assert.deepEqual(withStateDir(["list"], "/tmp/x"), ["list", "--state-dir", "/tmp/x"]);
  assert.deepEqual(withStateDir(["list"], ""), ["list"]);
  assert.deepEqual(withStateDir(["list"], undefined), ["list"]);
});

test("withStateDir puts the flag before the -- that starts free text", () => {
  assert.deepEqual(withStateDir(replyArgs(4, "--state-dir", false), "/tmp/x"), [
    "reply",
    "T4",
    "--state-dir",
    "/tmp/x",
    "--",
    "--state-dir",
  ]);
  assert.deepEqual(withStateDir(stepsArgs(4, { kind: "add", text: "x" }), "/tmp/x"), [
    "steps",
    "T4",
    "add",
    "--state-dir",
    "/tmp/x",
    "--",
    "x",
  ]);
});

test("project title sets a title, or clears it when null or empty", () => {
  assert.deepEqual(projectTitleArgs("/home/test/sites/a", "Site A"), ["project", "title", "/home/test/sites/a", "Site A"]);
  assert.deepEqual(projectTitleArgs("/home/test/sites/a", null), ["project", "title", "/home/test/sites/a", "--clear"]);
  assert.deepEqual(projectTitleArgs("/home/test/sites/a", ""), ["project", "title", "/home/test/sites/a", "--clear"]);
});

test("project title takes the store folder at the end", () => {
  assert.deepEqual(withStateDir(projectTitleArgs("/home/test/sites/a", "Site A"), "/tmp/x"), [
    "project", "title", "/home/test/sites/a", "Site A", "--state-dir", "/tmp/x",
  ]);
  assert.deepEqual(withStateDir(projectTitleArgs("/home/test/sites/a", null), "/tmp/x"), [
    "project", "title", "/home/test/sites/a", "--clear", "--state-dir", "/tmp/x",
  ]);
});
