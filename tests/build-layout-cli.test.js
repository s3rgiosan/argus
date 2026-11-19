import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/build-layout.mjs", import.meta.url));
const MAIN = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "tabs", type: "block" }, { id: "work-body", type: "row", children: [] }] }] };

function home({ main = MAIN, mods = true, toolbar = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "argus-build-"));
  mkdirSync(join(dir, "layouts"));
  if (main !== null) writeFileSync(join(dir, "layouts", "main.json"), typeof main === "string" ? main : JSON.stringify(main));
  if (mods) mkdirSync(join(dir, "mods"));
  if (mods && toolbar) {
    mkdirSync(join(dir, "mods", "argus-toolbar"));
    writeFileSync(join(dir, "mods", "argus-toolbar", "main.js"), "");
  }
  return dir;
}
const run = (dir, ...args) =>
  spawnSync(process.execPath, [script, ...args], { env: { PATH: "/usr/bin:/bin", HERDR_APP_HOME: dir }, encoding: "utf8" });

test("missing main.json: clear message, nothing written", () => {
  const dir = home({ main: null });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build-layout: cannot read .*main\.json/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.equal(readdirSync(join(dir, "layouts")).includes("Argus.json"), false);
});

test("invalid main.json: clear message", () => {
  const r = run(home({ main: "{bad" }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build-layout: cannot read .*main\.json/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("missing mods folder: asks to install the toolbar", () => {
  const r = run(home({ mods: false }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /install the toolbar first/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("--switch without herdr-app: clear message after writing", () => {
  const dir = home();
  const r = run(dir, "--switch");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /herdr-app not found/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.equal(readdirSync(join(dir, "layouts")).includes("Argus.json"), true);
});

const names = (dir) => readdirSync(join(dir, "layouts")).sort();

test("writes layouts/Argus.json", () => {
  const dir = home();
  assert.equal(run(dir).status, 0);
  assert.deepEqual(names(dir), ["Argus.json", "Argus.svg", "main.json"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8")).generated_by, "argus");
});

test("renames a generated argus.json to Argus.json and leaves one file", () => {
  const dir = home();
  writeFileSync(join(dir, "layouts", "argus.json"), JSON.stringify({ id: "old", generated_by: "argus" }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(names(dir), ["Argus.json", "Argus.svg", "main.json"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8")).id, "root");
});

test("refuses an argus.json it did not write", () => {
  const dir = home();
  writeFileSync(join(dir, "layouts", "argus.json"), JSON.stringify({ id: "mine" }));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /argus\.json was not written by this script/);
  assert.deepEqual(names(dir), ["argus.json", "main.json"]);
  assert.equal(JSON.parse(readFileSync(join(dir, "layouts", "argus.json"), "utf8")).id, "mine");
});

test("sets the preview picture and copies it next to the layout", () => {
  const dir = home();
  assert.equal(run(dir).status, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8")).preview, "layouts/Argus.svg");
  assert.match(readFileSync(join(dir, "layouts", "Argus.svg"), "utf8"), /^<svg /);
});

test("a layout that already has the argus blocks: clear message, nothing written", () => {
  const dir = home({ main: { ...MAIN, children: [{ id: "argus-toolbar", type: "block" }, ...MAIN.children] } });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /main\.json already contains argus blocks; nothing written/);
  assert.doesNotMatch(r.stderr, /changed shape/);
  assert.equal(readdirSync(join(dir, "layouts")).includes("Argus.json"), false);
});

test("keeps an existing layout state file", () => {
  const dir = home();
  mkdirSync(join(dir, "layouts", ".state"));
  writeFileSync(join(dir, "layouts", ".state", "argus.json"), '{"theme":"x"}');
  assert.equal(run(dir).status, 0);
  assert.equal(readFileSync(join(dir, "layouts", ".state", "argus.json"), "utf8"), '{"theme":"x"}');
});
