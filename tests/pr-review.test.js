import { test } from "node:test";
import assert from "node:assert/strict";
import { agentArgv, agentChoices, branchRefusal, reviewBranch, reviewPlan, reviewPrefix, titleSlug } from "../mods/argus-pull-requests/review.js";

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

test("reviewBranch: number, title slug and hash", () => {
  assert.equal(reviewBranch({ number: 12, title: "Add a Published date to Report heroes" }, "0f59ec2c"), "argus/review-12-add-a-published-date-to-report-heroes-0f59ec2c");
  assert.equal(reviewPrefix(12), "argus/review-12-");
});

test("titleSlug: no ASCII letters or digits gives no slug segment", () => {
  assert.equal(titleSlug("✨ — ✨"), "");
  assert.equal(reviewBranch({ number: 12, title: "✨" }, "0f59ec2c"), "argus/review-12-0f59ec2c");
  assert.equal(titleSlug("x".repeat(60)).length, 40);
  assert.equal(titleSlug("Fix: the  parser!"), "fix-the-parser");
  assert.equal(titleSlug(`${"a".repeat(39)} b`), "a".repeat(39));
});

test("branchRefusal: the prefix links the run to its PR, and git rules apply", () => {
  assert.equal(branchRefusal("argus/review-12-fix-0f59ec2c", 12), null);
  assert.match(branchRefusal("review-12-fix", 12), /argus\/review-12-/);
  assert.match(branchRefusal("argus/review-13-fix", 12), /argus\/review-12-/);
  assert.match(branchRefusal("argus/review-12-has space", 12), /space/);
  assert.match(branchRefusal("argus/review-12-", 12), /after/);
  assert.equal(branchRefusal("  argus/review-12-fix  ", 12), null);
});

test("reviewPlan: a worktree on a new branch from the main checkout HEAD", () => {
  assert.deepEqual(reviewPlan({ localPath: "/home/test/code/example-repo/", root: "/home/test/.herdr/worktrees", branch: "argus/review-12-fix-0f59ec2c" }), {
    path: "/home/test/.herdr/worktrees/example-repo/argus-review-12-fix-0f59ec2c",
    cwd: "/home/test/code/example-repo/",
    check: ["check-ref-format", "--branch", "argus/review-12-fix-0f59ec2c"],
    add: ["worktree", "add", "-b", "argus/review-12-fix-0f59ec2c", "/home/test/.herdr/worktrees/example-repo/argus-review-12-fix-0f59ec2c", "HEAD"],
  });
});
