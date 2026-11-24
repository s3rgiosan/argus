import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_LIST, AGENT_LIST_FILES, AgentListError, SHIPPED_AGENT_LIST, addAccountHooks, agentListManifest, ownsAgentList, useAgentList } from "../scripts/agent-list.mjs";

const FIXTURE = readFileSync(new URL("./fixtures/agents-main.txt", import.meta.url), "utf8");

function parses(source) {
  const dir = mkdtempSync(join(tmpdir(), "argus-agent-list-"));
  try {
    writeFileSync(join(dir, "main.mjs"), source);
    return spawnSync(process.execPath, ["--check", join(dir, "main.mjs")]).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("addAccountHooks: imports the hooks, starts them in init and draws each agent's account icon", () => {
  const out = addAccountHooks(FIXTURE);
  assert.match(out, /^import \{ agents, terminals, theme, run \} from "herdr";\nimport \{ argusAccountsInit, argusProgram \} from "\.\/agent-accounts-view\.js";$/m);
  assert.match(out, /^    this\.folded = new Set\(\);\n    argusAccountsInit\(this, cx\);$/m);
  assert.ok(out.includes("const pic = icon(argusProgram(this, k), 14, t.foreground);"));
  assert.ok(out.includes("const pic = icon(argusProgram(this, a), 16, t.foreground);"));
  assert.doesNotMatch(out, /icon\(\w+\.program,/);
  assert.ok(parses(out));
});

test("addAccountHooks: refuses a list whose anchors changed", () => {
  const changes = [
    ['import { agents, terminals, theme, run } from "herdr";', 'import { agents, terminals, theme, run } from "herdr-kit";'],
    ["    this.folded = new Set();", "    this.folded = new Set([]);"],
    ["  init(_props, cx) {", "  init(_props, context) {"],
    ["function icon(p, size, color) {", "function iconOf(p, size, color) {"],
  ];
  for (const [anchor, changed] of changes) {
    assert.ok(FIXTURE.includes(anchor), anchor);
    assert.throws(() => addAccountHooks(FIXTURE.replace(anchor, changed)), AgentListError, anchor);
  }
  assert.throws(() => addAccountHooks(FIXTURE.replaceAll(".program, ", ".prog, ")), AgentListError);
  assert.throws(() => addAccountHooks(FIXTURE.replace("    this.folded = new Set();", "    this.folded = new Set();\n    this.folded = new Set();")), AgentListError);
});

test("agentListManifest and ownsAgentList: the copy is named and marked as Argus's", () => {
  const manifest = agentListManifest({ place: "none", title: "Agents" });
  assert.deepEqual(manifest, { place: "none", title: "Agents (Argus)", generated_by: "argus" });
  assert.equal(ownsAgentList(manifest), true);
  assert.equal(ownsAgentList({ title: "Agents" }), false);
  assert.equal(ownsAgentList(null), false);
});

test("useAgentList: every block that shows Herdr's agents list shows the copy", () => {
  const layout = { id: "root", children: [{ id: "agents", content: { mod: SHIPPED_AGENT_LIST } }, { id: "x", content: { mod: "argus-agents" } }] };
  const out = useAgentList(layout, AGENT_LIST);
  assert.equal(out.children[0].content.mod, "argus-agent-list");
  assert.equal(out.children[1].content.mod, "argus-agents");
  assert.equal(layout.children[0].content.mod, "agents");
});

test("AGENT_LIST_FILES: the lib files the hooks import", () => {
  assert.deepEqual(AGENT_LIST_FILES, {
    "agent-accounts-view.js": "lib/agent-accounts-view.js",
    "agent-accounts.js": "lib/agent-accounts.js",
    "argus-file.js": "lib/argus-file.js",
    "paths.js": "lib/paths.js",
  });
});
