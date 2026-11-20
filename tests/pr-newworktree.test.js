import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteHeadsArgs, parseRemoteHeads, branchItems, remoteBranchPlan, issueBranch, issuePlan, filterItems } from "../mods/argus-pull-requests/newworktree.js";
import { titleSlug } from "../mods/argus-pull-requests/review.js";

const SHA = "a".repeat(40);

function porcelain(...entries) {
  return entries.map(({ path, branch }) => `worktree ${path}\nHEAD ${SHA}\n${branch ? `branch refs/heads/${branch}` : "detached"}`).join("\n\n") + "\n";
}

const LIST = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/feature-a", branch: "feature/a" });

test("remoteHeadsArgs", () => {
  assert.deepEqual(remoteHeadsArgs(), ["ls-remote", "--heads", "origin"]);
});

test("parseRemoteHeads sorts, strips refs/heads/ and ignores other refs", () => {
  const out = [`${SHA}\trefs/heads/zeta`, `${SHA}\trefs/heads/feature/a`, `${SHA}\trefs/tags/v1`, `${SHA}\tHEAD`, `${SHA}\trefs/heads/Alpha`, "", "junk"].join("\n");
  assert.deepEqual(parseRemoteHeads(out), ["Alpha", "feature/a", "zeta"]);
  assert.deepEqual(parseRemoteHeads(""), []);
  assert.deepEqual(parseRemoteHeads(undefined), []);
});

test("branchItems drops the default branch and marks branches with a worktree", () => {
  assert.deepEqual(branchItems(["feature/a", "main", "other"], "main", LIST), [
    { branch: "feature/a", path: "/w/example-repo/feature-a" },
    { branch: "other", path: null },
  ]);
  assert.deepEqual(branchItems(["main", "x"], null, LIST), [
    { branch: "main", path: "/home/test/example-repo" },
    { branch: "x", path: null },
  ]);
});

test("remoteBranchPlan opens an existing worktree", () => {
  assert.deepEqual(remoteBranchPlan({ branch: "feature/a", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: false }), { kind: "open", path: "/w/example-repo/feature-a" });
});

test("remoteBranchPlan creates a tracking branch when none exists locally", () => {
  const plan = remoteBranchPlan({ branch: "feature/b", localPath: "/home/test/example-repo/", root: "/w", porcelain: LIST, localExists: false });
  assert.deepEqual(plan, {
    kind: "create",
    path: "/w/example-repo/feature-b",
    fetch: ["fetch", "--no-tags", "origin", "+refs/heads/feature/b:refs/remotes/origin/feature/b"],
    add: ["worktree", "add", "--track", "-b", "feature/b", "/w/example-repo/feature-b", "origin/feature/b"],
  });
});

test("remoteBranchPlan keeps an existing local branch as it is", () => {
  const plan = remoteBranchPlan({ branch: "feature/b", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: true });
  assert.equal(plan.kind, "create");
  assert.deepEqual(plan.add, ["worktree", "add", "/w/example-repo/feature-b", "feature/b"]);
  assert.equal(plan.fetch[3], "+refs/heads/feature/b:refs/remotes/origin/feature/b");
});

test("issueBranch joins the number and the title slug", () => {
  assert.equal(issueBranch(12, "Fix the Login Bug!"), "12-fix-the-login-bug");
  assert.equal(issueBranch(7, "Ünïcode only 日本語"), "7-n-code-only");
  assert.equal(issueBranch(7, "日本語"), "7");
  assert.equal(issueBranch(7, ""), "7");
});

test("issueBranch is at most 60 characters and cuts on a dash", () => {
  const branch = issueBranch(1e20, `${"word-".repeat(20)}end`);
  assert.ok(branch.length <= 60);
  assert.ok(!branch.endsWith("-"));
  assert.match(branch, /^100000000000000000000(-word)+$/);
  const tight = issueBranch(1, "a".repeat(100));
  assert.ok(tight.length <= 60);
});

test("issuePlan opens the worktree of an existing issue branch", () => {
  const list = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/5-fix-it", branch: "5-fix-it" });
  assert.deepEqual(issuePlan({ number: 5, title: "Fix it", defaultBranch: "main", localPath: "/home/test/example-repo", root: "/w", porcelain: list, localExists: true }), { kind: "open", path: "/w/example-repo/5-fix-it" });
});

test("issuePlan cuts a new branch from the default branch without upstream", () => {
  const plan = issuePlan({ number: 5, title: "Fix it", defaultBranch: "main", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: false });
  assert.deepEqual(plan, {
    kind: "create",
    path: "/w/example-repo/5-fix-it",
    branch: "5-fix-it",
    check: ["check-ref-format", "--branch", "5-fix-it"],
    fetch: ["fetch", "--no-tags", "origin", "main"],
    add: ["worktree", "add", "--no-track", "-b", "5-fix-it", "/w/example-repo/5-fix-it", "origin/main"],
  });
});

test("issuePlan adds a worktree for an existing local branch without a fetch or a reset", () => {
  const plan = issuePlan({ number: 5, title: "Fix it", defaultBranch: "main", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: true });
  assert.equal(plan.kind, "create");
  assert.equal(plan.fetch, null);
  assert.deepEqual(plan.add, ["worktree", "add", "/w/example-repo/5-fix-it", "5-fix-it"]);
});

test("filterItems matches case-insensitively, with or without #", () => {
  const items = [{ n: 12, t: "Fix Login" }, { n: 40, t: "Add export" }];
  const key = (item) => `#${item.n} ${item.t}`;
  assert.equal(filterItems(items, "", key), items);
  assert.equal(filterItems(items, "  ", key), items);
  assert.deepEqual(filterItems(items, "LOGIN", key), [items[0]]);
  assert.deepEqual(filterItems(items, "#40", key), [items[1]]);
  assert.deepEqual(filterItems(items, "40", key), [items[1]]);
  assert.deepEqual(filterItems(items, "zzz", key), []);
});

test("issue branch names pass git check-ref-format for odd titles", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-"));
  try {
    const titles = ["Fix: a/b c..d", "  spaces   everywhere  ", "emoji 🎉 title", "~^:?*[ weird", "日本語のタイトル", "a".repeat(200), "end.lock", "@{x}", "-", "feat/slash/ed", "ÀÉÎ"];
    for (const title of titles) {
      const name = issueBranch(99, title);
      const out = execFileSync("git", ["check-ref-format", "--branch", name], { cwd: dir }).toString().trim();
      assert.equal(out, name, title);
      assert.ok(name.length <= 60);
    }
    assert.ok(titleSlug("end.lock").length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
