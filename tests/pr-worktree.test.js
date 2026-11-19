import { test } from "node:test";
import assert from "node:assert/strict";
import { aheadCount, aheadRefusal, branchSlug, checkoutBranch, checkoutPlan, gitError, parseWorktrees, spaceFor, worktreeRoot } from "../mods/argus-pull-requests/worktree.js";

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
    { path: "/home/test/a", branch: "main" },
    { path: "/wt/a/pr-42", branch: "pr/42" },
    { path: "/wt/a/old", branch: null },
  ]);
  assert.deepEqual(parseWorktrees(""), []);
});

test("checkoutBranch", () => {
  assert.equal(checkoutBranch({ provider: "github", number: 42 }), "pr/42");
  assert.equal(checkoutBranch({ provider: "gitlab", number: 12 }), "mr/12");
});

test("checkoutPlan creates a worktree", () => {
  const pr = { provider: "github", number: 42, headRef: "main", repo: "example-org/example-repo", host: "github.com" };
  const porcelain = "worktree /home/test/example-repo\nHEAD abc\nbranch refs/heads/main\n";
  assert.deepEqual(checkoutPlan({ pr, localPath: "/home/test/example-repo", root: "/wt", porcelain }), {
    kind: "create",
    path: "/wt/example-repo/pr-42",
    cwd: "/home/test/example-repo",
    branch: "pr/42",
    exists: ["rev-parse", "--verify", "--quiet", "refs/heads/pr/42"],
    peek: ["fetch", "--no-tags", "origin", "refs/pull/42/head"],
    ahead: ["rev-list", "--count", "FETCH_HEAD..refs/heads/pr/42"],
    fetch: ["fetch", "--no-tags", "origin", "+refs/pull/42/head:refs/heads/pr/42"],
    add: ["worktree", "add", "/wt/example-repo/pr-42", "pr/42"],
  });
  const mr = { provider: "gitlab", number: 12, headRef: "x", repo: "example-group/example-sub/example-project", host: "gitlab.example.com" };
  const plan = checkoutPlan({ pr: mr, localPath: "/home/test/example-project/", root: "/wt", porcelain });
  assert.equal(plan.fetch[3], "+refs/merge-requests/12/head:refs/heads/mr/12");
  assert.equal(plan.peek[3], "refs/merge-requests/12/head");
  assert.equal(plan.path, "/wt/example-project/mr-12");
});

test("checkoutPlan opens an existing worktree", () => {
  const pr = { provider: "github", number: 42, headRef: "main", repo: "example-org/example-repo", host: "github.com" };
  assert.deepEqual(checkoutPlan({ pr, localPath: "/home/test/a", root: "/wt", porcelain: PORCELAIN }), {
    kind: "open",
    path: "/wt/a/pr-42",
  });
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

test("aheadCount reads the count git prints", () => {
  assert.equal(aheadCount("0\n"), 0);
  assert.equal(aheadCount("3\n"), 3);
  assert.equal(aheadCount(" 12 "), 12);
});

test("aheadCount: anything else is null", () => {
  for (const text of ["", "\n", "x", "-1", "1.5", "2 3"]) assert.equal(aheadCount(text), null, JSON.stringify(text));
});

test("aheadRefusal names the branch and the commit count", () => {
  assert.equal(
    aheadRefusal("pr/42", 1),
    "The local branch pr/42 has 1 commit that is not on the pull request. The branch is unchanged. Push or move those commits, or delete the branch, then check out again.",
  );
  assert.match(aheadRefusal("mr/7", 3), /^The local branch mr\/7 has 3 commits that are not on the pull request\./);
});
