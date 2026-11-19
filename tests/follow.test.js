import { test } from "node:test";
import assert from "node:assert/strict";
import { compareNames, followFolder, followedProject } from "../lib/follow.js";

test("compareNames: sorts without regard to case, then by the raw text", () => {
  assert.deepEqual(["cli", "Taken Name", "alpha"].sort(compareNames), ["alpha", "cli", "Taken Name"]);
  assert.deepEqual(["b", "a", "A", "B"].sort(compareNames), ["A", "a", "B", "b"]);
  assert.equal(compareNames("same", "same"), 0);
});

test("followedProject: the project that is the folder or holds it", () => {
  const projects = ["/home/test/sites/a/wp-content", "/home/test/tools/cli"];
  assert.equal(followedProject(projects, "/home/test/sites/a/wp-content"), "/home/test/sites/a/wp-content");
  assert.equal(followedProject(projects, "/home/test/sites/a/wp-content/themes/demo"), "/home/test/sites/a/wp-content");
  assert.equal(followedProject(projects, "/home/test/tools"), null);
});
test("followedProject: matches on folder boundaries only", () => {
  assert.equal(followedProject(["/home/test/a/wp"], "/home/test/a/wp-content"), null);
  assert.equal(followedProject(["/home/test/a/wp"], "/home/test/a/wp/x"), "/home/test/a/wp");
});
test("followedProject: the longest match wins", () => {
  const projects = ["/home/test/site", "/home/test/site/wordpress/wp-content"];
  assert.equal(followedProject(projects, "/home/test/site/wordpress/wp-content/plugins"), "/home/test/site/wordpress/wp-content");
  assert.equal(followedProject(projects, "/home/test/site/docs"), "/home/test/site");
});
test("followedProject: ignores trailing slashes and returns the stored path", () => {
  assert.equal(followedProject(["/home/test/site/"], "/home/test/site"), "/home/test/site/");
  assert.equal(followedProject(["/home/test/site"], "/home/test/site/"), "/home/test/site");
  assert.equal(followedProject(["/home/test/site"], "/home/test/site//sub/"), "/home/test/site");
});
test("followedProject: no folder or no projects follow nothing", () => {
  assert.equal(followedProject(["/home/test/site"], null), null);
  assert.equal(followedProject(["/home/test/site"], ""), null);
  assert.equal(followedProject([], "/home/test/site"), null);
  assert.equal(followedProject([null, "", "/"], "/home/test/site"), null);
});

const spacesFixture = [
  { id: "sp1", active: false, folder: "/home/test/one", tabs: [{ id: "tb1", active: true }] },
  { id: "sp2", active: true, folder: "/home/test/two", tabs: [{ id: "tb2", active: false }, { id: "tb3", active: true }] },
];
const paneFixture = (over) => ({ pane: "p", terminal: "t1", tab: "tb3", cwd: null, focused: false, ...over });
test("followFolder: the focused terminal's folder", () => {
  const focused = { space: "sp2", tab: "tb3", pane: "p1", terminal: "t1", cwd: "/home/test/two/app" };
  assert.equal(followFolder(focused, [], spacesFixture), "/home/test/two/app");
});
test("followFolder: a focused mod pane uses a terminal in the same tab", () => {
  const focused = { space: "sp2", tab: "tb3", pane: "p2", terminal: null, cwd: null };
  const panes = [
    paneFixture({ pane: "p0", tab: "tb1", cwd: "/home/test/one" }),
    paneFixture({ pane: "p2", terminal: null, mod: "argus-tsk", focused: true }),
    paneFixture({ pane: "p3", cwd: "/home/test/two/app" }),
  ];
  assert.equal(followFolder(focused, panes, spacesFixture), "/home/test/two/app");
});
test("followFolder: then a terminal in another tab of the space, then the space folder", () => {
  const focused = { space: "sp2", tab: "tb3", pane: "p2", terminal: null, cwd: null };
  const panes = [paneFixture({ pane: "p4", tab: "tb2", cwd: "/home/test/two/lib" }), paneFixture({ pane: "p0", tab: "tb1", cwd: "/home/test/one" })];
  assert.equal(followFolder(focused, panes, spacesFixture), "/home/test/two/lib");
  assert.equal(followFolder(focused, [], spacesFixture), "/home/test/two");
});
test("followFolder: without focus it reads the shown space and tab", () => {
  const panes = [paneFixture({ pane: "p3", cwd: "/home/test/two/app" })];
  assert.equal(followFolder(null, panes, spacesFixture), "/home/test/two/app");
  assert.equal(followFolder(null, [], []), null);
});
test("followFolder: a space on another machine follows nothing", () => {
  const remote = [{ id: "sp9", active: true, machine: "build-box", folder: "/home/test/site", tabs: [{ id: "tb9", active: true }] }];
  const focused = { space: "sp9", tab: "tb9", pane: "p9", terminal: "t9", cwd: "/home/test/site" };
  assert.equal(followFolder(focused, [paneFixture({ pane: "p9", tab: "tb9", cwd: "/home/test/site" })], remote), null);
  assert.equal(followFolder(null, [], remote), null);
});
