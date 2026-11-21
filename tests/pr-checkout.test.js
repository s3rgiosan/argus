import { test } from "node:test";
import assert from "node:assert/strict";
import { aheadCount, aheadRefusal, checkoutBranch, checkoutPlan } from "../mods/argus-pull-requests/checkout.js";

const PORCELAIN =
  "worktree /home/test/a\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a/pr-42\nHEAD def\nbranch refs/heads/pr/42\n\nworktree /wt/a/old\nHEAD 123\ndetached\n";

test("checkoutPlan prunes a worktree entry whose folder is gone, then creates", () => {
  const pr = { provider: "github", number: 7, headRef: "x", repo: "example-org/example-repo", host: "github.com" };
  const text = "worktree /home/test/a\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a/pr-7\nHEAD abc\nbranch refs/heads/pr/7\nprunable gitdir file points to non-existent location\n";
  const plan = checkoutPlan({ pr, localPath: "/home/test/a", root: "/wt", porcelain: text });
  assert.equal(plan.kind, "create");
  assert.deepEqual(plan.prune, ["worktree", "prune"]);
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
    prune: null,
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

