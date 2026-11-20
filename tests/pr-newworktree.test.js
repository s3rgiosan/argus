import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteHeadsArgs, parseRemoteHeads, branchItems, remoteBranchPlan, issueBranch, issuePlan, filterItems, aheadBehind, localBranchStep, branchNote, fastForwardArgs, remoteBranchArgs, remoteHasBranch, refspecMissing, branchNameError, branchRead, issueRead, noticeFor, folderExistsMessage, DEFAULT_BRANCH_NOTE } from "../mods/argus-pull-requests/newworktree.js";
import { titleSlug } from "../mods/argus-pull-requests/review.js";

const SHA = "a".repeat(40);

function porcelain(...entries) {
  return entries.map(({ path, branch }) => `worktree ${path}\nHEAD ${SHA}\n${branch ? `branch refs/heads/${branch}` : "detached"}`).join("\n\n") + "\n";
}

const LIST = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/feature-a", branch: "feature/a" });
const PRUNABLE = LIST.replace(`branch refs/heads/feature/a`, `branch refs/heads/feature/a\nprunable gitdir file points to non-existent location`);

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

test("remoteBranchPlan creates a branch with no automatic tracking, then sets the upstream", () => {
  const plan = remoteBranchPlan({ branch: "feature/b", localPath: "/home/test/example-repo/", root: "/w", porcelain: LIST, localExists: false });
  assert.deepEqual(plan, {
    kind: "create",
    path: "/w/example-repo/feature-b",
    branch: "feature/b",
    prune: null,
    check: ["check-ref-format", "--branch", "feature/b"],
    fetch: ["fetch", "--no-tags", "origin", "+refs/heads/feature/b:refs/remotes/origin/feature/b"],
    compare: null,
    add: ["worktree", "add", "--no-track", "-b", "feature/b", "/w/example-repo/feature-b", "refs/remotes/origin/feature/b"],
    newBranch: true,
    track: [
      ["config", "branch.feature/b.remote", "origin"],
      ["config", "branch.feature/b.merge", "refs/heads/feature/b"],
    ],
    refspecs: ["config", "--get-all", "remote.origin.fetch"],
    refspec: "+refs/heads/feature/b:refs/remotes/origin/feature/b",
  });
});

test("remoteBranchPlan keeps an existing local branch as it is and compares it with the remote", () => {
  const plan = remoteBranchPlan({ branch: "feature/b", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: true });
  assert.equal(plan.kind, "create");
  assert.deepEqual(plan.add, ["worktree", "add", "/w/example-repo/feature-b", "feature/b"]);
  assert.equal(plan.fetch[3], "+refs/heads/feature/b:refs/remotes/origin/feature/b");
  assert.equal(plan.newBranch, false);
  assert.equal(plan.track, null);
  assert.deepEqual(plan.compare, ["rev-list", "--left-right", "--count", "refs/heads/feature/b...refs/remotes/origin/feature/b"]);
});

test("remoteBranchPlan prunes a worktree entry whose folder is gone, then creates", () => {
  const plan = remoteBranchPlan({ branch: "feature/a", localPath: "/home/test/example-repo", root: "/w", porcelain: PRUNABLE, localExists: true });
  assert.equal(plan.kind, "create");
  assert.deepEqual(plan.prune, ["worktree", "prune"]);
  assert.equal(plan.path, "/w/example-repo/feature-a");
});

test("aheadBehind reads the left-right count", () => {
  assert.deepEqual(aheadBehind("2\t3\n"), { ahead: 2, behind: 3 });
  assert.deepEqual(aheadBehind("0 0"), { ahead: 0, behind: 0 });
  assert.equal(aheadBehind(""), null);
  assert.equal(aheadBehind("2"), null);
  assert.equal(aheadBehind("a\tb"), null);
  assert.equal(aheadBehind(undefined), null);
});

test("localBranchStep decides between add, fast-forward and note", () => {
  assert.equal(localBranchStep({ ahead: 0, behind: 0 }), "add");
  assert.equal(localBranchStep({ ahead: 0, behind: 4 }), "fastForward");
  assert.equal(localBranchStep({ ahead: 1, behind: 0 }), "note");
  assert.equal(localBranchStep({ ahead: 2, behind: 3 }), "note");
});

test("branchNote and fastForwardArgs", () => {
  assert.equal(branchNote("feature/b", { ahead: 2, behind: 3 }), "The local branch feature/b is 2 ahead and 3 behind origin/feature/b.");
  assert.deepEqual(fastForwardArgs("feature/b", "b".repeat(40), "a".repeat(40)), ["update-ref", "refs/heads/feature/b", "b".repeat(40), "a".repeat(40)]);
});

test("remoteBranchArgs and remoteHasBranch", () => {
  assert.deepEqual(remoteBranchArgs("5-fix"), ["ls-remote", "--heads", "origin", "refs/heads/5-fix"]);
  assert.equal(remoteHasBranch(`${SHA}\trefs/heads/5-fix\n`, "5-fix"), true);
  assert.equal(remoteHasBranch(`${SHA}\trefs/heads/5-fix-more\n`, "5-fix"), false);
  assert.equal(remoteHasBranch("", "5-fix"), false);
  assert.equal(remoteHasBranch(undefined, "5-fix"), false);
});

test("refspecMissing is true only when no fetch refspec stores the branch", () => {
  const spec = "+refs/heads/feature/b:refs/remotes/origin/feature/b";
  assert.equal(refspecMissing("+refs/heads/main:refs/remotes/origin/main\n", "feature/b"), true);
  assert.equal(refspecMissing("+refs/heads/*:refs/remotes/origin/*\n", "feature/b"), false);
  assert.equal(refspecMissing(`+refs/heads/main:refs/remotes/origin/main\n${spec}\n`, "feature/b"), false);
  assert.equal(refspecMissing("", "feature/b"), true);
});

test("branchNameError refuses a name git rejects or rewrites", () => {
  assert.equal(branchNameError("feature/b", { code: 0, stdout: "feature/b\n", stderr: "" }), null);
  assert.equal(branchNameError("-dash", { code: 128, stdout: "", stderr: "fatal: '-dash' is not a valid branch name\n" }), "git: fatal: '-dash' is not a valid branch name");
  assert.equal(branchNameError("@{-1}", { code: 0, stdout: "other\n", stderr: "" }), "git: '@{-1}' is not a valid branch name");
});

test("branchRead lists the branches and notes an unknown default branch", () => {
  assert.deepEqual(branchRead(["main", "x"], "main", LIST), { entries: [{ branch: "x", path: null }], note: null });
  assert.deepEqual(branchRead(["main", "x"], null, LIST), {
    entries: [
      { branch: "main", path: "/home/test/example-repo" },
      { branch: "x", path: null },
    ],
    note: DEFAULT_BRANCH_NOTE,
  });
  assert.equal(DEFAULT_BRANCH_NOTE, "Could not read the default branch, so it is listed too.");
});

test("branchItems shows no worktree for a prunable entry", () => {
  assert.deepEqual(branchItems(["feature/a"], "main", PRUNABLE), [{ branch: "feature/a", path: null }]);
});

test("issueRead notes a list that reached the limit", () => {
  const issues = Array.from({ length: 50 }, (_v, i) => ({ number: i + 1, title: "Example title", updatedAt: "" }));
  assert.deepEqual(issueRead(issues.slice(0, 49)), { entries: issues.slice(0, 49), note: null });
  assert.deepEqual(issueRead(issues), { entries: issues, note: "Showing the first 50 issues." });
});

test("noticeFor shows a stored text only in its own repo and tab", () => {
  const entry = { key: "github|h|a/b", tab: "branch", text: "Oops" };
  assert.equal(noticeFor(entry, "github|h|a/b", "branch"), "Oops");
  assert.equal(noticeFor(entry, "github|h|a/c", "branch"), null);
  assert.equal(noticeFor(entry, "github|h|a/b", "issue"), null);
  assert.equal(noticeFor(null, "github|h|a/b", "branch"), null);
});

test("folderExistsMessage", () => {
  assert.equal(folderExistsMessage("/w/example-repo/x"), "The folder /w/example-repo/x already exists. Remove it or pick another branch.");
});

test("issueBranch joins the number and the title slug", () => {
  assert.equal(issueBranch(12, "Fix the Login Bug!"), "12-fix-the-login-bug");
  assert.equal(issueBranch(7, "Ünïcode only 日本語"), "7-n-code-only");
  assert.equal(issueBranch(7, "日本語"), "7");
  assert.equal(issueBranch(7, ""), "7");
});

test("issueBranch keeps the title slug cap and ends on a letter or digit", () => {
  const branch = issueBranch(1e20, `${"word-".repeat(20)}end`);
  assert.match(branch, /^100000000000000000000(-word)+$/);
  assert.equal(issueBranch(1, "a".repeat(100)), `1-${"a".repeat(40)}`);
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
    prune: null,
    check: ["check-ref-format", "--branch", "5-fix-it"],
    fetch: ["fetch", "--no-tags", "origin", "main"],
    newBranch: true,
    add: ["worktree", "add", "--no-track", "-b", "5-fix-it", "/w/example-repo/5-fix-it", "origin/main"],
  });
});

test("issuePlan adds a worktree for an existing local branch without a fetch or a reset", () => {
  const plan = issuePlan({ number: 5, title: "Fix it", defaultBranch: "main", localPath: "/home/test/example-repo", root: "/w", porcelain: LIST, localExists: true });
  assert.equal(plan.kind, "create");
  assert.equal(plan.fetch, null);
  assert.deepEqual(plan.add, ["worktree", "add", "/w/example-repo/5-fix-it", "5-fix-it"]);
  assert.equal(plan.newBranch, false);
});

test("issuePlan prunes a worktree entry whose folder is gone, then creates", () => {
  const list = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/5-fix-it", branch: "5-fix-it" }) + "prunable gitdir file points to non-existent location\n";
  const plan = issuePlan({ number: 5, title: "Fix it", defaultBranch: "main", localPath: "/home/test/example-repo", root: "/w", porcelain: list, localExists: true });
  assert.equal(plan.kind, "create");
  assert.deepEqual(plan.prune, ["worktree", "prune"]);
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
      assert.ok(name.length <= 43);
    }
    assert.ok(titleSlug("end.lock").length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
