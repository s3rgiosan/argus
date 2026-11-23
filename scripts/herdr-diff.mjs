#!/usr/bin/env node
// Shows what changed in Herdr between two versions, for a review of Argus after
// a Herdr update: the release notes, the shipped files that changed, the full
// diff of each file Argus follows, and whether Argus's patches still apply to
// the new shipped mods. It reads the public herdrdev/herdr-app repo and changes
// nothing in Herdr's app folder.
//
//   node scripts/herdr-diff.mjs --from 0.1.16 [--to 0.1.17] [--repo <dir>]
//
// --to defaults to the installed `herdr-app --version`. --repo is where the
// herdr-app clone is kept (default: <tmp>/argus-herdr-app).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changelogSections, plainVersion, trackedChanges } from "./herdr-diff-lib.mjs";
import * as paneHeader from "./pane-header.mjs";
import * as sidebar from "./sidebar.mjs";

const REPO_URL = "https://github.com/herdrdev/herdr-app.git";

function fail(message) {
  console.error(`herdr-diff: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : null;
};
const from = option("--from");
if (!from) fail("usage: node scripts/herdr-diff.mjs --from 0.1.16 [--to 0.1.17] [--repo <dir>]");
let to = option("--to");
if (!to) {
  try {
    to = plainVersion(execFileSync("herdr-app", ["--version"], { encoding: "utf8" }));
  } catch {
    fail("cannot read the installed version; pass --to");
  }
}
const repo = option("--repo") ?? join(tmpdir(), "argus-herdr-app");

const git = (...gitArgs) => execFileSync("git", ["-C", repo, ...gitArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
try {
  if (existsSync(join(repo, ".git"))) git("fetch", "--quiet", "--tags", "origin");
  else execFileSync("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", REPO_URL, repo], { stdio: "inherit" });
} catch (error) {
  fail(`cannot clone or fetch ${REPO_URL} into ${repo} (${error.message})`);
}
const tag = (version) => `v${plainVersion(version)}`;
for (const version of [from, to]) {
  try {
    git("rev-parse", "--verify", "--quiet", `${tag(version)}^{commit}`);
  } catch {
    fail(`no tag ${tag(version)} in ${REPO_URL}`);
  }
}
const [old, next] = [tag(from), tag(to)];

console.log(`# Herdr ${old} to ${next}\n`);
console.log("## Release notes\n");
const sections = changelogSections(git("show", `${next}:CHANGELOG.md`), from, to);
console.log(sections.length ? sections.map((s) => s.text).join("\n\n") : "(no changelog section in this range)");

console.log("\n## Changed shipped files\n");
const changed = git("diff", "--name-only", old, next, "--", "defaults", "docs").split("\n").filter(Boolean);
console.log(changed.length ? changed.map((file) => `- ${file}`).join("\n") : "(none)");

console.log("\n## Files Argus follows\n");
const tracked = trackedChanges(changed);
if (!tracked.length) console.log("(none changed)");
for (const entry of tracked) {
  console.log(`### ${entry.herdr}\n\nCheck: ${entry.argus}. ${entry.why}\n\n\`\`\`diff`);
  console.log(git("diff", old, next, "--", entry.herdr).trimEnd());
  console.log("```\n");
}

/** The first error line of `node --check` for an ES module source, or null when it parses. */
function syntaxError(source) {
  const dir = mkdtempSync(join(tmpdir(), "argus-herdr-diff-"));
  try {
    writeFileSync(join(dir, "main.mjs"), source);
    const check = spawnSync(process.execPath, ["--check", join(dir, "main.mjs")], { encoding: "utf8" });
    return check.status === 0 ? null : (check.stderr.split("\n").find((line) => /Error/.test(line)) ?? "node --check failed").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`## Argus patches on ${next}\n`);
const patches = [
  { name: "argus-pane (patchPaneHeader)", file: "defaults/mods/pane/main.js", apply: paneHeader.patchPaneHeader },
  { name: "argus-spaces (patchSidebar)", file: "defaults/mods/spaces/main.js", apply: sidebar.patchSidebar },
];
// The space group hooks exist once scripts/sidebar.mjs exports addGroups.
if (typeof sidebar.addGroups === "function") {
  patches.push({ name: "argus-spaces groups (patchSidebar + addGroups)", file: "defaults/mods/spaces/main.js", apply: (source) => sidebar.addGroups(sidebar.patchSidebar(source)) });
}
for (const patch of patches) {
  let result;
  try {
    const parse = syntaxError(patch.apply(git("show", `${next}:${patch.file}`)));
    result = parse === null ? "applies and parses" : `applies, but does not parse: ${parse}`;
  } catch (error) {
    result = `does not apply: ${error.message}`;
  }
  console.log(`- ${patch.name}: ${result}`);
}
