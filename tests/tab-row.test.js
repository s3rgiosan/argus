import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_LIST_FILES } from "../scripts/agent-list.mjs";
import { SHIPPED_TAB_ROW, TAB_ROW, TAB_ROW_FILES, TabRowError, addTabAccountHooks, ownsTabRow, tabRowManifest, useTabRow } from "../scripts/tab-row.mjs";

const FIXTURE = readFileSync(new URL("./fixtures/tabs-main.txt", import.meta.url), "utf8");

function parses(source) {
  const dir = mkdtempSync(join(tmpdir(), "argus-tab-row-"));
  try {
    writeFileSync(join(dir, "main.mjs"), source);
    return spawnSync(process.execPath, ["--check", join(dir, "main.mjs")]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("addTabAccountHooks: imports the hooks, starts them in init and draws the lead agent's account icon", () => {
  const out = addTabAccountHooks(FIXTURE);
  assert.match(out, /^import \{ spaces, panes, run, theme \} from "herdr";\nimport \{ argusAccountsInit, argusProgram \} from "\.\/agent-accounts-view\.js";$/m);
  assert.match(out, /^  init\(_props, cx\) \{\n    argusAccountsInit\(this, cx\);\n    this\.pressed = null;$/m);
  assert.ok(out.includes("const program = argusProgram(this, { address: lead?.terminal, program: lead?.program });"));
  assert.ok(!out.includes("const program = lead?.program;"));
  assert.ok(parses(out));
});

test("addTabAccountHooks: keeps an init that already takes cx", () => {
  const out = addTabAccountHooks(FIXTURE.replace("  init() {", "  init(_props, cx) {"));
  assert.match(out, /^  init\(_props, cx\) \{\n    argusAccountsInit\(this, cx\);$/m);
  assert.ok(parses(out));
});

test("addTabAccountHooks: refuses a tab row whose anchors changed", () => {
  const changes = [
    ['import { spaces, panes, run, theme } from "herdr";', 'import { spaces, panes, run, theme } from "herdr-kit";'],
    ["  init() {", "  init(props) {"],
    ["const program = lead?.program;", "const prog = lead?.program;"],
  ];
  for (const [anchor, changed] of changes) {
    assert.ok(FIXTURE.includes(anchor), anchor);
    assert.throws(() => addTabAccountHooks(FIXTURE.replace(anchor, changed)), TabRowError, anchor);
  }
  const doubled = FIXTURE.replace("      const program = lead?.program;", "      const program = lead?.program;\n      const program2 = 1;\n      const program = lead?.program;");
  assert.throws(() => addTabAccountHooks(doubled), TabRowError);
});

test("tabRowManifest and ownsTabRow: the copy is named and marked as Argus's", () => {
  const manifest = tabRowManifest({ place: "none", title: "Tabs" });
  assert.deepEqual(manifest, { place: "none", title: "Tabs (Argus)", generated_by: "argus" });
  assert.equal(ownsTabRow(manifest), true);
  assert.equal(ownsTabRow({ title: "Tabs" }), false);
  assert.equal(ownsTabRow(null), false);
});

test("useTabRow: every block that shows Herdr's tab row shows the copy", () => {
  const layout = { id: "root", children: [{ id: "tabs", window_drag: true, content: { mod: SHIPPED_TAB_ROW } }, { id: "x", content: { mod: "argus-toolbar" } }] };
  const out = useTabRow(layout, TAB_ROW);
  assert.equal(out.children[0].content.mod, "argus-tabs");
  assert.equal(out.children[0].window_drag, true);
  assert.equal(out.children[1].content.mod, "argus-toolbar");
  assert.equal(layout.children[0].content.mod, "tabs");
});

test("TAB_ROW_FILES: the same lib files as the agents list copy", () => {
  assert.deepEqual(TAB_ROW_FILES, AGENT_LIST_FILES);
});
