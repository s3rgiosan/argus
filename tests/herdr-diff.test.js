import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACKED, changelogSections, compareVersions, plainVersion, trackedChanges } from "../scripts/herdr-diff-lib.mjs";

const CHANGELOG = `# Herdr changelog

## [0.1.18] - 2026-12-01

### New
- Example new item.

## [0.1.17] - 2026-11-22
<!-- spotlight -->

### Fixed
- Example fix.

## [0.1.16] - 2026-11-14

### New
- Older item.
`;

test("plainVersion: drops a leading v and spaces", () => {
  assert.equal(plainVersion("v0.1.17"), "0.1.17");
  assert.equal(plainVersion(" 0.1.17 "), "0.1.17");
  assert.equal(plainVersion("herdr-app 0.1.17"), "0.1.17");
  assert.equal(plainVersion("0.1.17-rc1"), "0.1.17");
  assert.equal(plainVersion("herdr-app 0.1.17-rc1"), "0.1.17");
});

test("compareVersions: compares each number", () => {
  assert.equal(compareVersions("0.1.16", "0.1.17") < 0, true);
  assert.equal(compareVersions("0.1.17", "v0.1.17"), 0);
  assert.equal(compareVersions("0.2.0", "0.1.99") > 0, true);
  assert.equal(compareVersions("0.1.10", "0.1.9") > 0, true);
});

test("changelogSections: the versions after from, up to and with to, newest first", () => {
  const sections = changelogSections(CHANGELOG, "v0.1.16", "0.1.18");
  assert.deepEqual(sections.map((s) => s.version), ["0.1.18", "0.1.17"]);
  assert.match(sections[1].text, /^## \[0\.1\.17\] - 2026-11-22\n/);
  assert.match(sections[1].text, /- Example fix\.\n?$/);
  assert.doesNotMatch(sections[1].text, /0\.1\.16/);
});

test("changelogSections: one version, and none when the range is empty", () => {
  assert.deepEqual(changelogSections(CHANGELOG, "0.1.16", "0.1.17").map((s) => s.version), ["0.1.17"]);
  assert.deepEqual(changelogSections(CHANGELOG, "0.1.18", "0.1.18"), []);
});

test("trackedChanges: the Argus code to check for each changed Herdr file", () => {
  const changed = ["defaults/mods/agents/main.js", "defaults/mods/toast/main.js", "defaults/herdr.d.ts"];
  const found = trackedChanges(changed);
  assert.deepEqual(found.map((t) => t.herdr), ["defaults/herdr.d.ts", "defaults/mods/agents/main.js"]);
  assert.ok(found.every((t) => typeof t.argus === "string" && typeof t.why === "string"));
  assert.deepEqual(trackedChanges([]), []);
});

test("TRACKED: names the Herdr files Argus follows", () => {
  const herdr = TRACKED.map((t) => t.herdr);
  for (const file of ["defaults/herdr.d.ts", "defaults/AGENTS.md", "docs/commands.md", "defaults/mods/spaces/main.js", "defaults/mods/pane/main.js", "defaults/mods/agents/main.js", "defaults/mods/tabs/main.js"]) {
    assert.ok(herdr.includes(file), file);
  }
});
