import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const toolbarPx = (dir) => {
  const find = (node) => (node.id === "argus-toolbar" ? node : (node.children ?? []).map(find).find(Boolean));
  return find(JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8"))).size.px;
};
const withPanel = (dir, label = "Usage") => {
  mkdirSync(join(dir, "mods", "argus-claude-usage"));
  writeFileSync(join(dir, "mods", "argus-claude-usage", "mod.json"), JSON.stringify({ panel: { label, icon: "icons/x.svg" } }));
};

test("sizes the toolbar for the display set in argus.json", () => {
  const dir = home();
  withPanel(dir);
  assert.equal(run(dir).status, 0);
  const both = toolbarPx(dir);
  rmSync(join(dir, "layouts", "Argus.json"));
  writeFileSync(join(dir, "argus.json"), JSON.stringify({ toolbar: { display: "icons" } }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(toolbarPx(dir), 10 + 16 + 16);
  assert.equal(both, 10 + 16 + 16 + 7 * 5);
});

test("an unreadable argus.json gives the default display and a warning", () => {
  const dir = home();
  withPanel(dir);
  writeFileSync(join(dir, "argus.json"), "{bad");
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(toolbarPx(dir), 10 + 16 + 16 + 7 * 5);
  assert.match(r.stderr, /^build-layout: argus\.json: .*; an invalid setting uses its default/m);
});

// Argus's copy of the pane header
const HEADER_MAIN = {
  id: "root",
  type: "row",
  children: [
    {
      id: "work",
      type: "column",
      children: [
        { id: "tabs", type: "block" },
        { id: "work-body", type: "row", children: [{ id: "main", type: "block", content: { tab: "active", pane: { header: { content: { mod: "pane" } } } } }] },
      ],
    },
  ],
};
const SHIPPED_HEADER = `import { panes, props, run, theme, home, layout } from "herdr";
export default class Pane {
  render() {
    const name = p.title || "shell";
  }
}
`;
function withHeader(source = SHIPPED_HEADER) {
  const dir = home({ main: HEADER_MAIN });
  mkdirSync(join(dir, "mods", "pane"));
  writeFileSync(join(dir, "mods", "pane", "main.js"), source);
  writeFileSync(join(dir, "mods", "pane", "mod.json"), JSON.stringify({ place: "none", title: "Pane header" }));
  return dir;
}
const headerMod = (dir) => JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8")).children[0].children[1].children[0].content.pane.header.content.mod;

test("pane header: writes the copy and points the layout at it", () => {
  const dir = withHeader();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const main = readFileSync(join(dir, "mods", "argus-pane", "main.js"), "utf8");
  assert.match(main, /const name = paneTitle\(p\) \?\? \(p\.title \|\| "shell"\);/);
  assert.equal(JSON.parse(readFileSync(join(dir, "mods", "argus-pane", "mod.json"), "utf8")).generated_by, "argus");
  assert.equal(headerMod(dir), "argus-pane");
});

test("pane header: a run after a Herdr update writes the copy again", () => {
  const dir = withHeader();
  run(dir);
  writeFileSync(join(dir, "mods", "pane", "main.js"), SHIPPED_HEADER.replace('"shell"', '"terminal"'));
  assert.equal(run(dir).status, 0);
  assert.match(readFileSync(join(dir, "mods", "argus-pane", "main.js"), "utf8"), /"terminal"/);
});

test("pane header: a changed shipped header keeps the shipped one, with a message", () => {
  const dir = withHeader(SHIPPED_HEADER.replace("const name =", "const label ="));
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^build-layout: Herdr's pane header changed .*; the layout uses Herdr's pane header/m);
  assert.equal(existsSync(join(dir, "mods", "argus-pane")), false);
  assert.equal(headerMod(dir), "pane");
});

test("pane header: a changed shipped header removes an earlier copy from the layout only", () => {
  const dir = withHeader();
  run(dir);
  writeFileSync(join(dir, "mods", "pane", "main.js"), SHIPPED_HEADER.replace("const name =", "const label ="));
  run(dir);
  assert.equal(headerMod(dir), "pane");
});

test("pane header: a folder this script did not write is left alone", () => {
  const dir = withHeader();
  mkdirSync(join(dir, "mods", "argus-pane"));
  writeFileSync(join(dir, "mods", "argus-pane", "main.js"), "// someone else's");
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /argus-pane exists and was not written by this script; the layout uses Herdr's pane header/);
  assert.equal(readFileSync(join(dir, "mods", "argus-pane", "main.js"), "utf8"), "// someone else's");
  assert.equal(headerMod(dir), "pane");
});

test("pane header: no shipped header leaves the layout as it is", () => {
  const dir = home({ main: HEADER_MAIN });
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.equal(headerMod(dir), "pane");
});
