import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCandidates, storeDir, versionOk, versionAtLeast, TITLES_TSK, parseVersion, commandCandidates, expandHome, normalizeSettings } from "../mods/argus-tsk/locate.js";

test("default candidates cover unix locations", () => {
  const list = defaultCandidates("/home/u");
  assert.equal(list[0], "/home/u/.local/bin/tsk");
  assert.ok(list.includes("/opt/homebrew/bin/tsk"));
  assert.ok(list.includes("/usr/local/bin/tsk"));
  assert.ok(list.includes("/home/linuxbrew/.linuxbrew/bin/tsk"));
});

test("default candidates skip the home entry without a home", () => {
  const list = defaultCandidates("");
  assert.ok(list.every((p) => !p.includes(".local")));
  assert.ok(list.includes("/usr/local/bin/tsk"));
});

test("store dir honours TSK_STATE_DIR", () => {
  assert.equal(storeDir({ TSK_STATE_DIR: "/x" }, "/home/u"), "/x");
});

test("store dir ignores an empty TSK_STATE_DIR", () => {
  assert.equal(storeDir({ TSK_STATE_DIR: "" }, "/home/u"), "/home/u/.tsk");
});

test("store dir defaults to ~/.tsk", () => {
  assert.equal(storeDir({}, "/home/u"), "/home/u/.tsk");
});

test("parses version", () => {
  assert.deepEqual(parseVersion("tsk 0.13.0\n"), [0, 13, 0]);
  assert.equal(parseVersion("nope"), null);
});

test("ignores prerelease suffix", () => {
  assert.deepEqual(parseVersion("tsk 1.2.3-rc1"), [1, 2, 3]);
});

test("versionOk needs 0.13.0 or newer", () => {
  assert.equal(versionOk("tsk 0.12.9"), false);
  assert.equal(versionOk("tsk 0.13.0"), true);
  assert.equal(versionOk("tsk 0.13.1"), true);
  assert.equal(versionOk("tsk 1.0.0"), true);
  assert.equal(versionOk("garbage"), false);
});

test("command candidates: the setting, then tsk on PATH, then the install locations", () => {
  assert.deepEqual(commandCandidates("/opt/tsk/bin/tsk", "/home/u"), ["/opt/tsk/bin/tsk", "tsk", ...defaultCandidates("/home/u")]);
  assert.deepEqual(commandCandidates("", "/home/u"), ["tsk", ...defaultCandidates("/home/u")]);
  assert.deepEqual(commandCandidates("  ", "/home/u"), ["tsk", ...defaultCandidates("/home/u")]);
});

test("command candidates expand ~ in the setting and drop repeats", () => {
  assert.deepEqual(commandCandidates("~/.local/bin/tsk", "/home/u"), ["/home/u/.local/bin/tsk", "tsk", ...defaultCandidates("/home/u").slice(1)]);
  assert.deepEqual(commandCandidates("tsk", "/home/u"), ["tsk", ...defaultCandidates("/home/u")]);
});

test("expandHome", () => {
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("~/x/", "/home/u"), "/home/u/x");
  assert.equal(expandHome(" /abs ", "/home/u"), "/abs");
  assert.equal(expandHome("", "/home/u"), "");
});

test("normalizeSettings keeps strings and fills blanks", () => {
  assert.deepEqual(normalizeSettings(undefined), { tsk: "", stateDir: "" });
  assert.deepEqual(normalizeSettings({ tsk: "/bin/tsk", stateDir: 3 }), { tsk: "/bin/tsk", stateDir: "" });
  assert.deepEqual(normalizeSettings({ tsk: " ", stateDir: " /tmp/s " }), { tsk: "", stateDir: "/tmp/s" });
});

test("versionAtLeast compares a version against a minimum", () => {
  assert.deepEqual(TITLES_TSK, [0, 14, 0]);
  assert.equal(versionAtLeast("tsk 0.13.9", TITLES_TSK), false);
  assert.equal(versionAtLeast("tsk 0.14.0", TITLES_TSK), true);
  assert.equal(versionAtLeast("tsk 0.14.1", TITLES_TSK), true);
  assert.equal(versionAtLeast("tsk 1.0.0", TITLES_TSK), true);
  assert.equal(versionAtLeast("garbage", TITLES_TSK), false);
  assert.equal(versionAtLeast("", TITLES_TSK), false);
});
