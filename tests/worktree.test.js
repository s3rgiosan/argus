import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchSlug, findWorktree, gitError, parseWorktrees, spaceFor, worktreeListArgs, worktreePath, worktreeRoot, titleSlug, defaultBranchArgs, defaultBranchOf, tipArgs, remoteHeadsArgs, parseRemoteHeads, remoteBranchPlan, issueBranch, issuePlan, filterItems, aheadBehind, localBranchStep, branchNote, fastForwardArgs, remoteBranchArgs, remoteHasBranch, refspecMissing, branchNameError, folderExistsMessage } from "../lib/worktree.js";


const SHA = "a".repeat(40);

function porcelain(...entries) {
  return entries.map(({ path, branch }) => `worktree ${path}\nHEAD ${SHA}\n${branch ? `branch refs/heads/${branch}` : "detached"}`).join("\n\n") + "\n";
}

const LIST = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/feature-a", branch: "feature/a" });
const PRUNABLE = LIST.replace(`branch refs/heads/feature/a`, `branch refs/heads/feature/a\nprunable gitdir file points to non-existent location`);

const dir = (directory) => JSON.stringify({ worktrees: { directory } });

test("worktreeRoot reads the directory setting", () => {
  assert.deepEqual(worktreeRoot(null, "/home/test"), { root: "/home/test/.herdr/worktrees" });
  assert.deepEqual(worktreeRoot(dir("~/wt/"), "/home/test/"), { root: "/home/test/wt" });
  assert.deepEqual(worktreeRoot(dir("/srv/wt"), "/home/test"), { root: "/srv/wt" });
  assert.deepEqual(worktreeRoot(dir("C:\\wt\\"), "/home/test"), { root: "C:/wt" });
  assert.deepEqual(worktreeRoot("{}", "/home/test"), { root: "/home/test/.herdr/worktrees" });
});

test("worktreeRoot returns errors as values", () => {
  assert.deepEqual(worktreeRoot(dir("  "), "/home/test"), { error: "worktrees.directory must be a non-empty path." });
  assert.deepEqual(worktreeRoot(dir(5), "/home/test"), { error: "worktrees.directory must be a non-empty path." });
  assert.deepEqual(worktreeRoot(dir("relative/wt"), "/home/test"), {
    error: "worktrees.directory must be an absolute path or start with ~/.",
  });
  assert.match(worktreeRoot("{", "/home/test").error, /^settings\.json: /);
});

test("branchSlug treats a slug of only dots as empty", () => {
  for (const name of ["#.#", ".", ".."]) assert.match(branchSlug(name), /^branch-[0-9a-f]{8}$/, name);
  assert.equal(branchSlug("a.b"), "a.b");
});

test("worktreeRoot uses the trimmed directory", () => {
  assert.deepEqual(worktreeRoot(dir("  /srv/wt  "), "/home/test"), { root: "/srv/wt" });
  assert.deepEqual(worktreeRoot(dir(" ~/wt "), "/home/test"), { root: "/home/test/wt" });
});

test("branchSlug", () => {
  assert.equal(branchSlug("pr/42"), "pr-42");
  assert.equal(branchSlug("feature//x"), "feature-x");
  assert.match(branchSlug("///"), /^branch-[0-9a-f]{8}$/);
  assert.notEqual(branchSlug("///"), branchSlug("\\\\"));
});

const PORCELAIN =
  "worktree /home/test/a\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a/pr-42\nHEAD def\nbranch refs/heads/pr/42\n\nworktree /wt/a/old\nHEAD 123\ndetached\n";

test("parseWorktrees", () => {
  assert.deepEqual(parseWorktrees(PORCELAIN), [
    { path: "/home/test/a", branch: "main", head: "abc", locked: false, prunable: false },
    { path: "/wt/a/pr-42", branch: "pr/42", head: "def", locked: false, prunable: false },
    { path: "/wt/a/old", branch: null, head: "123", locked: false, prunable: false },
  ]);
  assert.deepEqual(parseWorktrees(""), []);
});

test("parseWorktrees marks a prunable entry", () => {
  const text = "worktree /wt/a/gone\nHEAD abc\nbranch refs/heads/pr/7\nprunable gitdir file points to non-existent location\n";
  assert.deepEqual(parseWorktrees(text), [{ path: "/wt/a/gone", branch: "pr/7", head: "abc", locked: false, prunable: true }]);
});

test("parseWorktrees marks a locked entry, with or without a reason", () => {
  const text = "worktree /wt/a/one\nHEAD abc\nbranch refs/heads/x\nlocked\n\nworktree /wt/a/two\nHEAD def\nbranch refs/heads/y\nlocked in use\n";
  assert.deepEqual(parseWorktrees(text).map((worktree) => worktree.locked), [true, true]);
});

test("spaceFor", () => {
  const spaces = [
    { id: "s0", folder: "/wt/a/pr-42", machine: "box", tabs: [{ id: "t0" }] },
    { id: "s1", folder: "/home/test/a", machine: null, tabs: [{ id: "t1" }] },
    { id: "s2", folder: "/wt/a/pr-420", machine: null, tabs: [{ id: "t2" }] },
    { id: "s3", folder: "/home/test/b", machine: null, tabs: [{ id: "t3" }] },
  ];
  const panes = [
    { tab: "t1", terminal: "x", cwd: "/home/test/a" },
    { tab: "t3", terminal: "y", cwd: "/wt/a/pr-42/src" },
  ];
  assert.equal(spaceFor(spaces, panes, "/wt/a/pr-42"), "s3");
  assert.equal(spaceFor(spaces.slice(1, 3), [], "/wt/a/pr-42"), null);
  assert.equal(spaceFor(spaces, [], "/wt/a/pr-420"), "s2");
  assert.equal(spaceFor([{ ...spaces[1], folder: "/wt/a/pr-42" }], [], "/wt/a/pr-42/"), "s1");
  assert.equal(spaceFor(spaces.slice(0, 1), [], "/wt/a/pr-42"), null);
});

test("gitError: the error line, not the first progress line", () => {
  const stderr = "From example-remote\n ! [rejected]        refs/pull/42/head -> pr/42  (non-fast-forward)\nerror: could not fetch\nhint: example hint\n";
  assert.equal(gitError({ code: 1, stdout: "", stderr }), "git: error: could not fetch");
  const add = "Preparing worktree (checking out 'pr/42')\nfatal: '/example/path' already exists\n";
  assert.equal(gitError({ code: 128, stdout: "", stderr: add }), "git: fatal: '/example/path' already exists");
  assert.equal(gitError({ code: 1, stdout: "", stderr: "first\nlast line\n\n" }), "git: last line");
  assert.equal(gitError({ code: 1, stdout: "out one\nout two\n", stderr: "  \n" }), "git: out two");
  assert.equal(gitError({ code: 3, stdout: "", stderr: "" }), "git: exited with code 3");
});

test("worktreeRoot: a blank directory is an error", () => {
  assert.deepEqual(worktreeRoot('{"worktrees":{"directory":"  "}}', "/home/test"), { error: "worktrees.directory must be a non-empty path." });
});

test("remoteHeadsArgs", () => {
  assert.deepEqual(remoteHeadsArgs(), ["ls-remote", "--heads", "origin"]);
});


test("parseRemoteHeads sorts, strips refs/heads/ and ignores other refs", () => {
  const out = [`${SHA}\trefs/heads/zeta`, `${SHA}\trefs/heads/feature/a`, `${SHA}\trefs/tags/v1`, `${SHA}\tHEAD`, `${SHA}\trefs/heads/Alpha`, "", "junk"].join("\n");
  assert.deepEqual(parseRemoteHeads(out), ["Alpha", "feature/a", "zeta"]);
  assert.deepEqual(parseRemoteHeads(""), []);
  assert.deepEqual(parseRemoteHeads(undefined), []);
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
    fetch: ["fetch", "--no-tags", "origin", "--", "main"],
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

test("defaultBranchOf reads the branch from a remote HEAD", () => {
  assert.equal(defaultBranchOf("origin/main\n"), "main");
  assert.equal(defaultBranchOf(""), null);
  assert.equal(defaultBranchOf("upstream/dev"), "dev");
  assert.deepEqual(defaultBranchArgs(), ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  assert.deepEqual(tipArgs("feat/a"), ["rev-parse", "--verify", "--quiet", "refs/heads/feat/a"]);
});

test("titleSlug: no ASCII letters or digits gives no slug segment", () => {
  assert.equal(titleSlug("✨ — ✨"), "");
  assert.equal(titleSlug("x".repeat(60)).length, 40);
  assert.equal(titleSlug("Fix: the  parser!"), "fix-the-parser");
  assert.equal(titleSlug(`${"a".repeat(39)} b`), "a".repeat(39));
});

test("worktreeListArgs and worktreePath", () => {
  assert.deepEqual(worktreeListArgs(), ["worktree", "list", "--porcelain"]);
  assert.equal(worktreePath("/w", "/home/test/example-repo/", "feature/a"), "/w/example-repo/feature-a");
});

test("findWorktree gives the path of the branch's worktree, or a prune for a gone one", () => {
  assert.deepEqual(findWorktree(LIST, "feature/a"), { path: "/w/example-repo/feature-a", prune: null });
  assert.deepEqual(findWorktree(PRUNABLE, "feature/a"), { path: null, prune: ["worktree", "prune"] });
  assert.deepEqual(findWorktree(LIST, "missing"), { path: null, prune: null });
});

test("tipArgs and defaultBranchArgs", () => {
  assert.deepEqual(tipArgs("feature/a"), ["rev-parse", "--verify", "--quiet", "refs/heads/feature/a"]);
  assert.deepEqual(defaultBranchArgs(), ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
});
