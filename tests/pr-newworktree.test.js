import { test } from "node:test";
import assert from "node:assert/strict";
import { branchItems, branchRead, issueRead, noticeFor, DEFAULT_BRANCH_NOTE, emptyText, defaultProjectKey, holdsWorktree } from "../mods/argus-pull-requests/newworktree.js";

const SHA = "a".repeat(40);

function porcelain(...entries) {
  return entries.map(({ path, branch }) => `worktree ${path}\nHEAD ${SHA}\n${branch ? `branch refs/heads/${branch}` : "detached"}`).join("\n\n") + "\n";
}

const LIST = porcelain({ path: "/home/test/example-repo", branch: "main" }, { path: "/w/example-repo/feature-a", branch: "feature/a" });
const PRUNABLE = LIST.replace(`branch refs/heads/feature/a`, `branch refs/heads/feature/a\nprunable gitdir file points to non-existent location`);

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

test("branchRead lists the branches and notes an unknown default branch", () => {
  assert.deepEqual(branchRead(["main", "x"], "main", LIST), { entries: [{ branch: "x", path: null }], held: ["main", "feature/a"], note: null });
  assert.deepEqual(branchRead(["main", "x"], null, LIST), {
    entries: [
      { branch: "main", path: "/home/test/example-repo" },
      { branch: "x", path: null },
    ],
    held: ["main", "feature/a"],
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

test("emptyText tells a filter miss from an empty list", () => {
  assert.equal(emptyText("branch", 3, 0), "Nothing matches the filter");
  assert.equal(emptyText("pr", 1, 0), "Nothing matches the filter");
  assert.equal(emptyText("branch", 0, 0), "No other branches on the remote");
  assert.equal(emptyText("pr", 0, 0), "No open pull requests of this repo on the board");
  assert.equal(emptyText("issue", 0, 0), "No open issues assigned to you");
});

test("defaultProjectKey gives the followed key when listed, else the first, else null", () => {
  const projects = [{ key: "a" }, { key: "b" }];
  assert.equal(defaultProjectKey(projects, "b"), "b");
  assert.equal(defaultProjectKey(projects, "z"), "a");
  assert.equal(defaultProjectKey(projects, null), "a");
  assert.equal(defaultProjectKey([], "b"), null);
});

test("branchRead lists the branches that hold a worktree, prunable ones left out", () => {
  assert.deepEqual(branchRead(["x"], "main", LIST).held, ["main", "feature/a"]);
  assert.deepEqual(branchRead(["x"], "main", PRUNABLE).held, ["main"]);
});

test("holdsWorktree is true only when the read lists the branch", () => {
  const read = branchRead(["x"], "main", LIST);
  assert.equal(holdsWorktree(read, "feature/a"), true);
  assert.equal(holdsWorktree(read, "pr/7"), false);
  assert.equal(holdsWorktree(undefined, "feature/a"), false);
  assert.equal(holdsWorktree({ entries: [], note: null }, "feature/a"), false);
});
