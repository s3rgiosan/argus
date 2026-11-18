import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultCandidates, storeDir, versionOk, parseVersion } from "../mods/argus-tsk/locate.js";

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
