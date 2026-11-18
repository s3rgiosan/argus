import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
  assert.equal(existsSync(join(dir, "layouts", "argus.json")), false);
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
  assert.equal(existsSync(join(dir, "layouts", "argus.json")), true);
});
