import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GROUP_FILES, GroupsError, SIDEBAR, SidebarError, addGroups, ownsSidebar, patchSidebar, sidebarManifest, useSidebar } from "../scripts/sidebar.mjs";

// The part of Herdr's sidebar that the patch changes, in the shape it ships.
const SHIPPED = `export default class Spaces {
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const branch = raw === "main" ? "" : raw;
    const repo = tree ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \\u00b7 ");
    return h_flex()
      .when(Boolean(where), (el) => el.child(div().child(where)))
      .when(g.ahead > 0, (el) => el.child(\`\\u2191\${g.ahead}\`))
      .when(g.behind > 0, (el) => el.child(\`\\u2193\${g.behind}\`));
  }

  row() {
    const where = "elsewhere";
    return where;
  }
}
`;

test("patchSidebar: the space row shows no repo or branch text", () => {
  const out = patchSidebar(SHIPPED);
  const tail = out.slice(out.indexOf("gitTail("), out.indexOf("row()"));
  assert.match(tail, /^    const where = "";$/m);
  assert.doesNotMatch(tail, /filter\(Boolean\)\.join/);
});

test("patchSidebar: keeps the ahead and behind counts and the rest of the file", () => {
  const out = patchSidebar(SHIPPED);
  assert.match(out, /g\.ahead > 0/);
  assert.match(out, /g\.behind > 0/);
  assert.match(out, /const where = "elsewhere";/);
});

test("patchSidebar: refuses a sidebar whose gitTail changed", () => {
  assert.throws(() => patchSidebar(SHIPPED.replace("gitTail(g", "spaceTail(g")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED.replace('    const where = [repo', "    const place = [repo")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED.replaceAll("g.ahead", "g.up")), SidebarError);
  assert.throws(() => patchSidebar(SHIPPED + "\n  gitTail(other) {\n  }\n"), SidebarError);
});

test("sidebarManifest and ownsSidebar: the copy is named and marked as Argus's", () => {
  const manifest = sidebarManifest({ place: "none", title: "Spaces" });
  assert.deepEqual(manifest, { place: "none", title: "Spaces (Argus)", generated_by: "argus" });
  assert.equal(ownsSidebar(manifest), true);
  assert.equal(ownsSidebar({ title: "Spaces" }), false);
  assert.equal(ownsSidebar(null), false);
});

test("useSidebar: every block that shows the shipped sidebar shows the copy", () => {
  const layout = { id: "root", children: [{ id: "spaces", content: { mod: "spaces" } }, { id: "agents", content: { mod: "agents" } }] };
  const out = useSidebar(layout, SIDEBAR);
  assert.equal(out.children[0].content.mod, "argus-spaces");
  assert.equal(out.children[1].content.mod, "agents");
  assert.equal(layout.children[0].content.mod, "spaces");
});

test("patchSidebar: a blank line before gitTail or its where line keeps the indent", () => {
  const spaced = SHIPPED.replace("  gitTail(", "\n  gitTail(").replace("    const where = [repo", "\n    const where = [repo");
  const out = patchSidebar(spaced);
  assert.match(out, /\n\n    \/\/ Argus leaves out[^\n]*\n    \/\/ [^\n]*\n    const where = "";\n/);
});

test("patchSidebar: refuses a gitTail with two where lines", () => {
  assert.throws(() => patchSidebar(SHIPPED.replace('    const where = [repo', '    const where = "";\n    const where = [repo')), SidebarError);
});

// The groups hooks, against a made-up sidebar that holds every anchor.
const FIXTURE = readFileSync(new URL("./fixtures/spaces-main.txt", import.meta.url), "utf8");

/** True when `source` parses as an ES module. */
function parses(source) {
  const dir = mkdtempSync(join(tmpdir(), "argus-sidebar-"));
  try {
    writeFileSync(join(dir, "main.mjs"), source);
    return spawnSync(process.execPath, ["--check", join(dir, "main.mjs")]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HOOKS = [
  'import { argusInit, argusSort, argusSections, argusDropOnRow, argusNewGroupButton } from "./space-groups-view.js";',
  "    argusInit(this);",
  "    out.splice(0, out.length, ...argusSort(this, out, sp, (w) => this.git[where(w, ps)]));",
  "      const argus = argusSections(this, rows, draw, t, collapsed, null);\n      this.activeAt = argus.active;\n      return argus.items;",
  "      const argusMine = argusSections(this, mine, draw, t, collapsed, m);\n      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? argusMine.items :",
  "      const first = folded ? -1 : argusMine.active;",
  "          argusDropOnRow(this, from, w);\n          const index = spaces().findIndex(s => s.id === w.id);",
  "        .when(!collapsed, el => el.child(argusNewGroupButton(this, t)))\n        .child(div().id(\"space-new\")",
];

test("addGroups: adds every hook", () => {
  const out = addGroups(patchSidebar(FIXTURE));
  for (const hook of HOOKS) assert.ok(out.includes(hook), hook);
  assert.doesNotMatch(out, /mine\.map\(draw\)/);
  assert.doesNotMatch(out, /return rows\.map\(draw\);/);
  assert.doesNotMatch(out, /mine\.findIndex/);
  assert.match(out, /^    const where = "";$/m);
  assert.ok(parses(out));
});

// Each anchor and a change that removes it.
const ANCHORS = [
  ['import { spaces, machines, panes, run, openOverlay, shared, setShared } from "herdr";', 'import { spaces, machines, panes, run, openOverlay, shared, setShared } from "herdr-kit";'],
  ["    this.machines = [];", "    this.machines = new Array();"],
  ["    const order = sp.map(w => w.id);", "    const order = sp.map((w) => w.id);"],
  ["const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);", "const whereOf = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);"],
  ["    const sp = spaces(), ps = panes();", "    const sp = spaces(), panesNow = panes();"],
  ["      this.activeAt = rows.findIndex(r => r.w.active);", "      this.activeAt = rows.findIndex((r) => r.w.active);"],
  ["      return rows.map(draw);", "      return rows.map((r) => draw(r));"],
  ["mine.length ? mine.map(draw) :", "mine.length ? mine.map((r) => draw(r)) :"],
  ["      const first = folded ? -1 : mine.findIndex(r => r.w.active);", "      const first = folded ? -1 : mine.findIndex((r) => r.w.active);"],
  ["          const index = spaces().findIndex(s => s.id === w.id);", "          const index = spaces().findIndex((s) => s.id === w.id);"],
  ['        .child(div().id("space-new")', '        .child(div().id("space-add")'],
];

test("addGroups: refuses a missing anchor", () => {
  for (const [anchor, changed] of ANCHORS) {
    assert.ok(FIXTURE.includes(anchor), anchor);
    assert.throws(() => addGroups(FIXTURE.replace(anchor, changed)), GroupsError, anchor);
  }
});

test("addGroups: refuses a doubled anchor", () => {
  const lines = FIXTURE.split("\n");
  for (const [anchor] of ANCHORS) {
    const at = lines.findIndex((line) => line.includes(anchor));
    const doubled = [...lines.slice(0, at + 1), lines[at], ...lines.slice(at + 1)].join("\n");
    assert.throws(() => addGroups(doubled), GroupsError, anchor);
  }
});

test("addGroups: a blank line before an anchor keeps the indent", () => {
  const out = addGroups(FIXTURE.replace("    this.machines = [];", "\n    this.machines = [];"));
  assert.match(out, /\n\n    this\.machines = \[\];\n    argusInit\(this\);\n/);
});

test("addGroups: the error names the hooks", () => {
  assert.throws(() => addGroups("export default class Spaces {}\n"), (error) => error instanceof GroupsError && error.name === "GroupsError" && /^the groups hooks do not apply \(/.test(error.message));
});

test("GROUP_FILES: the copy's extra files and their repo sources", () => {
  assert.deepEqual(GROUP_FILES, {
    "space-groups.js": "lib/space-groups.js",
    "space-groups-view.js": "lib/space-groups-view.js",
    "menu.js": "lib/menu.js",
    "ui.js": "lib/ui.js",
    "icons/ellipsis.svg": "mods/argus-space-groups/icons/ellipsis.svg",
    "icons/LICENSE-Lucide.txt": "mods/argus-space-groups/icons/LICENSE-Lucide.txt",
  });
});
