import { test } from "node:test";
import assert from "node:assert/strict";
import { agentArgv, agentChoices, branchRefusal, reviewBranch, reviewInstructions, reviewPlan, reviewPrefix, reviewPrompt, reviewRuns, titleSlug } from "../mods/argus-pull-requests/review.js";

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

const pr = (provider, host, repo) => ({
  provider, host, repo, number: 12, title: "Example title", url: "", author: "octo-user", headRef: "feature/example", baseRef: "main",
  isDraft: false, state: "open", reviewDecision: null, checks: { passed: 0, failed: 0, running: 0, total: 0 }, mergeable: "mergeable",
  updatedAt: "2026-01-01T00:00:00Z", localPath: null,
});
const detail = (p) => ({ pr: p, body: "", headSha: "abc123", squash: false, checks: [], reviewers: [], merge: { state: "mergeable", reason: null }, conversation: [] });
const gh = detail(pr("github", "github.com", "example-org/example-repo"));
const gl = detail(pr("gitlab", "gitlab.example.com", "example-group/example-sub/example-project"));

test("reviewPrompt: read-only rules, verification with the CLI, and the PR facts", () => {
  const text = reviewPrompt({ detail: gh, configured: null, extra: "" });
  assert.match(text, /^You review pull request #12 in example-org\/example-repo on github\.com\. This review is read-only\./);
  assert.match(text, /gh pr view 12 --repo example-org\/example-repo --json number,baseRefName,headRefName,headRefOid/);
  assert.match(text, /git fetch --no-tags origin refs\/pull\/12\/head/);
  assert.match(text, /git diff origin\/main\.\.\.abc123/);
  assert.match(text, /Pull request title: Example title\nAuthor: octo-user$/);
  assert.doesNotMatch(text, /Extra instructions/);
});

test("reviewPrompt: GitLab uses glab and the merge request ref", () => {
  const text = reviewPrompt({ detail: gl, configured: null, extra: "" });
  assert.match(text, /glab mr view 12 -R https:\/\/gitlab\.example\.com\/example-group\/example-sub\/example-project -F json/);
  assert.match(text, /refs\/merge-requests\/12\/head/);
});

test("reviewPrompt: configured and extra instructions come last, under the read-only reminder", () => {
  const text = reviewPrompt({ detail: gh, configured: "Check the migrations.", extra: " Focus on src/. " });
  assert.match(text, /Extra instructions\. The read-only rules above still apply\.\n\nCheck the migrations\.\n\nFocus on src\/\.$/);
  assert.match(reviewPrompt({ detail: gh, configured: null, extra: "Only this." }), /still apply\.\n\nOnly this\.$/);
  assert.doesNotMatch(reviewPrompt({ detail: gh, configured: "  ", extra: "\n" }), /Extra instructions/);
});

test("reviewInstructions reads pullRequests.review.instructions", () => {
  assert.deepEqual(reviewInstructions(null), { instructions: null, error: null });
  assert.deepEqual(reviewInstructions('{"pullRequests":{"review":{"instructions":"  Be brief. "}}}'), { instructions: "Be brief.", error: null });
  assert.deepEqual(reviewInstructions('{"toolbar":{}}'), { instructions: null, error: null });
  assert.equal(reviewInstructions('{"pullRequests":{"review":{"instructions":3}}}').error, "pullRequests.review.instructions is not text");
  assert.match(reviewInstructions("{bad").error, /JSON/);
});

test("reviewRuns: worktrees on argus/review-<n>- branches, by pull request", () => {
  const project = { key: "github.com/example-org/example-repo", provider: "github", host: "github.com", repo: "example-org/example-repo", localPath: "/c/repo", folders: [] };
  const porcelain =
    "worktree /c/repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /w/r12b\nHEAD 2\nbranch refs/heads/argus/review-12-b-2\n\n" +
    "worktree /w/r12a\nHEAD 3\nbranch refs/heads/argus/review-12-a-1\n\nworktree /w/other\nHEAD 4\nbranch refs/heads/argus/reviewer\n\n" +
    "worktree /w/detached\nHEAD 5\ndetached\n";
  assert.deepEqual(reviewRuns([{ project, porcelain }]), {
    "github.com/example-org/example-repo#12": [
      { path: "/w/r12a", branch: "argus/review-12-a-1" },
      { path: "/w/r12b", branch: "argus/review-12-b-2" },
    ],
  });
  assert.deepEqual(reviewRuns([]), {});
});
