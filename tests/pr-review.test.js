import { test } from "node:test";
import assert from "node:assert/strict";
import { agentArgv, agentChoices } from "../mods/argus-pull-requests/review.js";

const known = [
  { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, agent: true, installed: true, run: ["claude"] },
  { key: "codex", name: "Codex", icon: null, tint: false, agent: true, installed: true, run: ["codex"] },
  { key: "gemini", name: "Gemini", icon: null, tint: false, agent: true, installed: false, run: ["gemini"] },
  { key: "nvim", name: "Neovim", icon: null, tint: false, agent: false, installed: true, run: ["nvim"] },
];
const profiles = [
  { folder: "/home/test/.claude", isDefault: true, label: "Personal", email: null, accountUuid: "a" },
  { folder: "/home/test/.claude-work", isDefault: false, label: ".claude-work", email: null, accountUuid: "b" },
];

test("agentChoices: installed agents, Claude Code once per account", () => {
  const choices = agentChoices(known, profiles, { names: { "~/.claude-work": "Work" }, hidden: [] }, "/home/test");
  assert.deepEqual(choices.map((c) => [c.label, c.argv, c.model]), [
    ["Claude Code · Personal", ["claude"], true],
    ["Claude Code · Work", ["env", "CLAUDE_CONFIG_DIR=/home/test/.claude-work", "claude"], true],
    ["Codex", ["codex"], false],
  ]);
});

test("agentChoices: hidden accounts are left out, and names fall back to the label", () => {
  const choices = agentChoices(known, profiles, { names: {}, hidden: ["~/.claude"] }, "/home/test");
  assert.deepEqual(choices.map((c) => c.label), ["Claude Code · .claude-work", "Codex"]);
});

test("agentChoices: no installed agent gives no choice", () => {
  assert.deepEqual(agentChoices([], profiles, { names: {}, hidden: [] }, "/home/test"), []);
});

test("agentChoices: Claude Code with no profile found runs the plain command", () => {
  assert.deepEqual(agentChoices(known.slice(0, 1), [], { names: {}, hidden: [] }, "/home/test").map((c) => c.argv), [["claude"]]);
});

test("agentChoices: ids are unique and icons come from the agent", () => {
  const choices = agentChoices(known, profiles, { names: {}, hidden: [] }, "/home/test");
  assert.deepEqual(choices.map((c) => c.id), ["claude:/home/test/.claude", "claude:/home/test/.claude-work", "codex"]);
  assert.deepEqual([choices[0].icon, choices[0].tint], ["icons/claude.svg", true]);
});

test("agentArgv: --model only for agents that take it, and only when set", () => {
  const [claude, , codex] = agentChoices(known, profiles, { names: {}, hidden: [] }, "/home/test");
  assert.deepEqual(agentArgv(claude, " sonnet "), ["claude", "--model", "sonnet"]);
  assert.deepEqual(agentArgv(claude, ""), ["claude"]);
  assert.deepEqual(agentArgv(codex, "o3"), ["codex"]);
});
