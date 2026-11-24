import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProgram, configDirOf } from "../lib/agent-accounts.js";

const HOME = "/home/test";
const CLAUDE = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, tile: null, color: null, shell: false, agent: true };
const KNOWN = [{ key: "claude-work", name: "Claude Work", icon: "my-icons/work.svg", tint: false, tile: null, color: null, run: ["claude-work"], installed: true }];
const ACCOUNTS = { "/home/test/.claude-work": { key: "~/.claude-work", program: "claude-work" } };

test("configDirOf: the CLAUDE_CONFIG_DIR of a ps eww line, else the default folder", () => {
  assert.equal(configDirOf("claude --resume TERM=xterm CLAUDE_CONFIG_DIR=/home/test/.claude-work HOME=/home/test", HOME), "/home/test/.claude-work");
  assert.equal(configDirOf("claude CLAUDE_CONFIG_DIR=~/.claude-work/ PATH=/bin", HOME), "/home/test/.claude-work");
  assert.equal(configDirOf("claude TERM=xterm HOME=/home/test", HOME), "/home/test/.claude");
  assert.equal(configDirOf("claude MY_CLAUDE_CONFIG_DIR=/x", HOME), "/home/test/.claude");
  assert.equal(configDirOf("", HOME), "/home/test/.claude");
});

test("accountProgram: a mapped Claude account takes its programs.json entry", () => {
  assert.deepEqual(accountProgram(CLAUDE, "/home/test/.claude-work", ACCOUNTS, KNOWN), {
    ...CLAUDE, key: "claude-work", name: "Claude Work", icon: "my-icons/work.svg", tint: false, tile: null, color: null,
  });
});

test("accountProgram: anything else keeps its program", () => {
  assert.equal(accountProgram(CLAUDE, "/home/test/.claude", ACCOUNTS, KNOWN), CLAUDE);
  assert.equal(accountProgram(CLAUDE, undefined, ACCOUNTS, KNOWN), CLAUDE);
  assert.equal(accountProgram(CLAUDE, "/home/test/.claude-work", ACCOUNTS, []), CLAUDE);
  const codex = { ...CLAUDE, key: "codex" };
  assert.equal(accountProgram(codex, "/home/test/.claude-work", ACCOUNTS, KNOWN), codex);
  assert.equal(accountProgram(null, "/home/test/.claude-work", ACCOUNTS, KNOWN), null);
});
