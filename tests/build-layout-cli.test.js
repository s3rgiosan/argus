import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync, chmodSync, symlinkSync, lstatSync } from "node:fs";
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
    return div()
      .child(div().flex_none().truncate().max_w(260).child(name));
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
  // The earlier copy stays on disk; the layout no longer uses it.
  assert.equal(existsSync(join(dir, "mods", "argus-pane", "main.js")), true);
});

test("pane header: a copy that stopped after its mod.json is written again", () => {
  const dir = withHeader();
  mkdirSync(join(dir, "mods", "argus-pane"));
  writeFileSync(join(dir, "mods", "argus-pane", "mod.json"), JSON.stringify({ generated_by: "argus" }));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, "mods", "argus-pane", "main.js"), "utf8"), /paneTitle/);
  assert.equal(headerMod(dir), "argus-pane");
});

test("pane header: an empty folder is used for the copy", () => {
  const dir = withHeader();
  mkdirSync(join(dir, "mods", "argus-pane"));
  assert.equal(run(dir).status, 0);
  assert.equal(headerMod(dir), "argus-pane");
});

test("pane header: a patched header that does not parse keeps the shipped one, with a message", () => {
  const dir = withHeader(SHIPPED_HEADER + "const broken = ;\n");
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^build-layout: the patched pane header does not parse.*; the layout uses Herdr's pane header/m);
  assert.equal(existsSync(join(dir, "mods", "argus-pane", "main.js")), false);
  assert.equal(headerMod(dir), "pane");
});

test("pane header: a folder it cannot write keeps the shipped one, with a message", () => {
  const dir = withHeader();
  // A read-only copy folder makes the writes fail.
  mkdirSync(join(dir, "mods", "argus-pane"));
  writeFileSync(join(dir, "mods", "argus-pane", "mod.json"), JSON.stringify({ generated_by: "argus" }));
  chmodSync(join(dir, "mods", "argus-pane", "mod.json"), 0o444);
  chmodSync(join(dir, "mods", "argus-pane"), 0o555);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^build-layout: cannot write .*argus-pane.*; the layout uses Herdr's pane header/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
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

// Argus's copy of the sidebar
const SIDEBAR_MAIN = {
  id: "root",
  type: "row",
  children: [
    { id: "spaces", type: "block", content: { mod: "spaces" } },
    { id: "work", type: "column", children: [{ id: "tabs", type: "block" }, { id: "work-body", type: "row", children: [] }] },
  ],
};
const SHIPPED_SIDEBAR = `export default class Spaces {
  gitTail(g) {
    const where = [g.name, g.branch].filter(Boolean).join(" · ");
    return [where, g.ahead, g.behind];
  }
}
`;
function withSidebar(source = SHIPPED_SIDEBAR) {
  const dir = home({ main: SIDEBAR_MAIN });
  mkdirSync(join(dir, "mods", "spaces"));
  writeFileSync(join(dir, "mods", "spaces", "main.js"), source);
  writeFileSync(join(dir, "mods", "spaces", "mod.json"), JSON.stringify({ place: "none", title: "Spaces" }));
  return dir;
}
const sidebarMod = (dir) => JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8")).children[0].content.mod;

test("sidebar: writes the copy and points the layout at it", () => {
  const dir = withSidebar();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, "mods", "argus-spaces", "main.js"), "utf8"), /^    const where = "";$/m);
  assert.equal(JSON.parse(readFileSync(join(dir, "mods", "argus-spaces", "mod.json"), "utf8")).title, "Spaces (Argus)");
  assert.equal(sidebarMod(dir), "argus-spaces");
});

test("sidebar: a changed shipped sidebar keeps the shipped one, with a message", () => {
  const dir = withSidebar(SHIPPED_SIDEBAR.replace("gitTail(g)", "tail(g)"));
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^build-layout: Herdr's sidebar changed .*; the layout uses Herdr's sidebar/m);
  assert.equal(existsSync(join(dir, "mods", "argus-spaces")), false);
  assert.equal(sidebarMod(dir), "spaces");
});

const repoFile = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const GROUPS_SIDEBAR = repoFile("tests/fixtures/spaces-main.txt");
const GROUP_COPIES = {
  "space-groups.js": "lib/space-groups.js",
  "space-groups-view.js": "lib/space-groups-view.js",
  "menu.js": "lib/menu.js",
  "ui.js": "lib/ui.js",
  "icons/ellipsis.svg": "mods/argus-space-groups/icons/ellipsis.svg",
  "icons/LICENSE-Lucide.txt": "mods/argus-space-groups/icons/LICENSE-Lucide.txt",
};

test("sidebar: writes the groups files with the copy", () => {
  const dir = withSidebar(GROUPS_SIDEBAR);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /no groups/);
  for (const [copy, source] of Object.entries(GROUP_COPIES)) {
    assert.equal(readFileSync(join(dir, "mods", "argus-spaces", copy), "utf8"), repoFile(source), copy);
  }
  assert.match(readFileSync(join(dir, "mods", "argus-spaces", "main.js"), "utf8"), /from "\.\/space-groups-view\.js";/);
  assert.equal(sidebarMod(dir), "argus-spaces");
});

test("sidebar: a sidebar without the groups anchors keeps the copy with a warning", () => {
  const dir = withSidebar();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^build-layout: the groups hooks do not apply .*; the sidebar has no groups$/m);
  const main = readFileSync(join(dir, "mods", "argus-spaces", "main.js"), "utf8");
  assert.match(main, /^    const where = "";$/m);
  assert.doesNotMatch(main, /space-groups-view/);
  assert.equal(existsSync(join(dir, "mods", "argus-spaces", "space-groups-view.js")), false);
  assert.equal(sidebarMod(dir), "argus-spaces");
});

test("sidebar: a folder this script did not write is left alone", () => {
  const dir = withSidebar();
  mkdirSync(join(dir, "mods", "argus-spaces"));
  writeFileSync(join(dir, "mods", "argus-spaces", "main.js"), "// someone else's");
  const r = run(dir);
  assert.match(r.stderr, /argus-spaces exists and was not written by this script; the layout uses Herdr's sidebar/);
  assert.equal(readFileSync(join(dir, "mods", "argus-spaces", "main.js"), "utf8"), "// someone else's");
  assert.equal(sidebarMod(dir), "spaces");
});

test("sidebar: no shipped sidebar leaves the layout as it is", () => {
  const dir = home({ main: SIDEBAR_MAIN });
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.equal(existsSync(join(dir, "mods", "argus-spaces")), false);
  assert.equal(sidebarMod(dir), "spaces");
});

// Both copies in one run
const BOTH_MAIN = {
  id: "root",
  type: "row",
  children: [
    { id: "spaces", type: "block", content: { mod: "spaces" } },
    HEADER_MAIN.children[0],
  ],
};
function withBoth({ header = SHIPPED_HEADER, sidebar = SHIPPED_SIDEBAR } = {}) {
  const dir = home({ main: BOTH_MAIN });
  for (const [name, source, title] of [["pane", header, "Pane header"], ["spaces", sidebar, "Spaces"]]) {
    mkdirSync(join(dir, "mods", name));
    writeFileSync(join(dir, "mods", name, "main.js"), source);
    writeFileSync(join(dir, "mods", name, "mod.json"), JSON.stringify({ place: "none", title }));
  }
  return dir;
}
const bothMods = (dir) => {
  const layout = JSON.parse(readFileSync(join(dir, "layouts", "Argus.json"), "utf8"));
  return [layout.children[0].content.mod, layout.children[1].children[1].children[0].content.pane.header.content.mod];
};

test("both copies: one run writes both and the layout uses both", () => {
  const dir = withBoth();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(bothMods(dir), ["argus-spaces", "argus-pane"]);
});

test("both copies: a failing pane header still writes the sidebar", () => {
  const dir = withBoth({ header: SHIPPED_HEADER.replace("const name =", "const label ="), sidebar: GROUPS_SIDEBAR });
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /the layout uses Herdr's pane header/);
  assert.doesNotMatch(r.stderr, /sidebar/);
  assert.deepEqual(bothMods(dir), ["argus-spaces", "pane"]);
});

test("both copies: a failing sidebar still writes the pane header", () => {
  const dir = withBoth({ sidebar: SHIPPED_SIDEBAR.replace("gitTail(g)", "tail(g)") });
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /the layout uses Herdr's sidebar/);
  assert.deepEqual(bothMods(dir), ["spaces", "argus-pane"]);
});

test("both copies: a copy folder it cannot read keeps that shipped mod, and the other copy is written", () => {
  const dir = withBoth();
  mkdirSync(join(dir, "mods", "argus-spaces"));
  writeFileSync(join(dir, "mods", "argus-spaces", "mod.json"), JSON.stringify({ generated_by: "argus" }));
  chmodSync(join(dir, "mods", "argus-spaces"), 0o000);
  const r = run(dir);
  chmodSync(join(dir, "mods", "argus-spaces"), 0o755);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^build-layout: cannot read .*argus-spaces.*; the layout uses Herdr's sidebar/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.deepEqual(bothMods(dir), ["spaces", "argus-pane"]);
});

test("pane header: a copy folder that is a symbolic link is left alone", () => {
  const dir = withHeader();
  const elsewhere = mkdtempSync(join(tmpdir(), "argus-elsewhere-"));
  symlinkSync(elsewhere, join(dir, "mods", "argus-pane"));
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /argus-pane is a symbolic link; the layout uses Herdr's pane header/);
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.equal(headerMod(dir), "pane");
});

test("a written layout leaves no temporary file behind", () => {
  const dir = withHeader();
  assert.equal(run(dir).status, 0);
  assert.deepEqual(readdirSync(join(dir, "layouts")).filter((f) => f.endsWith(".tmp")), []);
  assert.deepEqual(readdirSync(join(dir, "mods", "argus-pane")).filter((f) => f.endsWith(".tmp")), []);
});

test("the preview svg is replaced atomically, never written through a link", () => {
  const dir = home();
  const victim = join(dir, "victim.svg");
  writeFileSync(victim, "keep");
  symlinkSync(victim, join(dir, "layouts", "Argus.svg"));
  assert.equal(run(dir).status, 0);
  assert.equal(readFileSync(victim, "utf8"), "keep");
  assert.equal(lstatSync(join(dir, "layouts", "Argus.svg")).isSymbolicLink(), false);
  assert.match(readFileSync(join(dir, "layouts", "Argus.svg"), "utf8"), /^<svg /);
  assert.deepEqual(names(dir), ["Argus.json", "Argus.svg", "main.json"]);
});
