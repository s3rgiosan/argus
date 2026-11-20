import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, defaultBranchOf, defaultBranchArgs, insideFolder, rowsFor, branchStep, tipArgs, statusArgs, ignoredArgs, ignoredOf, tickedByDefault, readsOnOpen, recheck, reflogArgs, reflogShas, unsavedArgs, hasOutput, submoduleArgs, worktreesInSpaces, freshForReview } from "../mods/argus-pull-requests/cleanup.js";
import { branchDelete, linkedWorktrees, reviewNumber } from "../mods/argus-pull-requests/review.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

/** One `git worktree list --porcelain` block. */
function block({ path, head = SHA_A, branch = null, locked = false, prunable = false }) {
  const lines = [`worktree ${path}`, `HEAD ${head}`];
  lines.push(branch === null ? "detached" : `branch refs/heads/${branch}`);
  if (locked) lines.push("locked");
  if (prunable) lines.push("prunable gitdir file points to non-existent location");
  return lines.join("\n");
}

function porcelain(...blocks) {
  return blocks.map(block).join("\n\n") + "\n";
}

const MAIN = { path: "/repo/example-repo", branch: "main" };

/** A worktree as `candidates` returns it. */
function wt(branch, extra = {}) {
  return { path: `/w/${branch.replaceAll("/", "-")}`, branch, head: SHA_A, locked: false, prunable: false, review: reviewNumber(branch), ...extra };
}

function merged(number, headSha = SHA_A, mergedAt = "2026-11-10T00:00:00Z", base = "main") {
  return { number, headSha, mergedAt, base };
}

function input(worktrees, extra = {}) {
  return { worktrees, merged: {}, reviewMerged: {}, dirty: new Set(), inSpace: new Set(), openBranches: new Set(), ...extra };
}

test("defaultBranchOf reads the branch from a remote HEAD", () => {
  assert.equal(defaultBranchOf("origin/main\n"), "main");
  assert.equal(defaultBranchOf(""), null);
  assert.equal(defaultBranchOf("upstream/dev"), "dev");
  assert.deepEqual(defaultBranchArgs(), ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  assert.deepEqual(tipArgs("feat/a"), ["rev-parse", "--verify", "--quiet", "refs/heads/feat/a"]);
  assert.deepEqual(statusArgs(), ["status", "--porcelain", "--untracked-files=all"]);
});

test("linkedWorktrees reads the head commit of each linked worktree", () => {
  const list = linkedWorktrees(porcelain(MAIN, { path: "/w/a", branch: "feat/a", head: SHA_B }));
  assert.deepEqual(list, [{ path: "/w/a", branch: "feat/a", head: SHA_B, locked: false, prunable: false }]);
});

test("candidates: linked worktrees with a branch, minus the default and the main worktree's branch", () => {
  const list = candidates(
    porcelain(
      MAIN,
      { path: "/w/feat-a", branch: "feat/a" },
      { path: "/w/main-copy", branch: "main" },
      { path: "/w/dev", branch: "dev" },
      { path: "/w/detached" },
    ),
    "dev",
  );
  assert.deepEqual(list.map((w) => w.branch), ["feat/a"]);
});

test("candidates keep paths and branches with spaces and slashes whole", () => {
  const [one] = candidates(porcelain(MAIN, { path: "/w/example repo/feat-a b", branch: "feat/a/b" }), "main");
  assert.equal(one.path, "/w/example repo/feat-a b");
  assert.equal(one.branch, "feat/a/b");
});

test("candidates read review numbers and the lock and prune flags", () => {
  const list = candidates(
    porcelain(MAIN, { path: "/w/r", branch: "argus/review-12-x" }, { path: "/w/l", branch: "feat/l", locked: true }, { path: "/w/p", branch: "feat/p", prunable: true }),
    "main",
  );
  assert.deepEqual(
    list.map((w) => [w.branch, w.review, w.locked, w.prunable]),
    [
      ["argus/review-12-x", 12, false, false],
      ["feat/l", null, true, false],
      ["feat/p", null, false, true],
    ],
  );
});

test("insideFolder matches the folder and its subfolders, not a folder that only shares a prefix", () => {
  assert.equal(insideFolder("/w/feat-a", "/w/feat-a"), true);
  assert.equal(insideFolder("/w/feat-a/src", "/w/feat-a"), true);
  assert.equal(insideFolder("/w/feat-ab", "/w/feat-a"), false);
});

test("rowsFor: a merged branch whose tip is the merged head is eligible", () => {
  const rows = rowsFor(input([wt("feat/a")], { merged: { "feat/a": [merged(8)] } }));
  assert.deepEqual(rows, [{ path: "/w/feat-a", branch: "feat/a", number: 8, mergedAt: "2026-11-10T00:00:00Z", headSha: SHA_A, review: false, reason: null, ignored: [], prunable: false }]);
});

test("rowsFor: each reason greys a row", () => {
  const m = { merged: { "feat/a": [merged(8)] } };
  const reason = (worktree, extra) => rowsFor(input([worktree], { ...m, ...extra }))[0].reason;
  assert.equal(reason(wt("feat/a", { locked: true }), {}), "locked");
  assert.equal(reason(wt("feat/a"), { dirty: new Set(["/w/feat-a"]) }), "has changes");
  assert.equal(reason(wt("feat/a"), { inSpace: new Set(["/w/feat-a"]) }), "open in a space");
  assert.equal(reason(wt("feat/a"), { openBranches: new Set(["feat/a"]) }), "has an open pull request");
  assert.equal(reason(wt("feat/a", { head: SHA_C }), {}), "not at the merged commit");
});

test("rowsFor: the first reason that applies wins, in a fixed order", () => {
  const all = { dirty: new Set(["/w/feat-a"]), inSpace: new Set(["/w/feat-a"]), openBranches: new Set(["feat/a"]), merged: { "feat/a": [merged(8)] } };
  assert.equal(rowsFor(input([wt("feat/a", { locked: true, head: SHA_C })], all))[0].reason, "locked");
  assert.equal(rowsFor(input([wt("feat/a", { head: SHA_C })], all))[0].reason, "has changes");
  assert.equal(rowsFor(input([wt("feat/a", { head: SHA_C })], { ...all, dirty: new Set() }))[0].reason, "open in a space");
  assert.equal(rowsFor(input([wt("feat/a", { head: SHA_C })], { ...all, dirty: new Set(), inSpace: new Set() }))[0].reason, "has an open pull request");
});

test("rowsFor: a branch off the merged commit names the newest merged pull request", () => {
  const rows = rowsFor(input([wt("feat/a", { head: SHA_C })], { merged: { "feat/a": [merged(9, SHA_B, "2026-11-12T00:00:00Z"), merged(8, SHA_A, "2026-11-10T00:00:00Z")] } }));
  assert.equal(rows[0].reason, "not at the merged commit");
  assert.equal(rows[0].number, 9);
});

test("rowsFor: of two merged pull requests, the one whose head is the tip counts", () => {
  const rows = rowsFor(input([wt("feat/a", { head: SHA_A })], { merged: { "feat/a": [merged(9, SHA_B, "2026-11-12T00:00:00Z"), merged(8, SHA_A, "2026-11-10T00:00:00Z")] } }));
  assert.equal(rows[0].reason, null);
  assert.equal(rows[0].number, 8);
});

test("rowsFor: a prunable worktree has no changes to keep", () => {
  const rows = rowsFor(input([wt("feat/a", { prunable: true })], { merged: { "feat/a": [merged(8)] }, dirty: new Set(["/w/feat-a"]) }));
  assert.equal(rows[0].reason, null);
});

test("rowsFor: a review worktree matches by number, whatever its tip", () => {
  const review = wt("argus/review-12-x", { head: SHA_C });
  assert.equal(rowsFor(input([review], { reviewMerged: { 12: merged(12, SHA_A) } }))[0].reason, null);
  assert.equal(rowsFor(input([review], { reviewMerged: { 12: merged(12, SHA_A) } }))[0].review, true);
  assert.deepEqual(rowsFor(input([review], { reviewMerged: { 12: null } })), []);
  assert.deepEqual(rowsFor(input([review])), []);
});

test("rowsFor leaves out worktrees with no merged pull request and sorts by branch", () => {
  const rows = rowsFor(input([wt("feat/b"), wt("feat/c"), wt("feat/a")], { merged: { "feat/b": [merged(2)], "feat/a": [merged(1)], "feat/c": [] } }));
  assert.deepEqual(rows.map((row) => row.branch), ["feat/a", "feat/b"]);
});

test("branchStep deletes a branch only when its tip is still the merged head", () => {
  const row = rowsFor(input([wt("feat/a")], { merged: { "feat/a": [merged(8)] } }))[0];
  assert.deepEqual(branchStep(row, SHA_A), { args: ["branch", "-D", "feat/a"], kept: null });
  assert.deepEqual(branchStep(row, SHA_B), { args: null, kept: "not at the merged commit" });
  assert.deepEqual(branchStep(row, null), { args: null, kept: null });
  const review = rowsFor(input([wt("argus/review-12-x")], { reviewMerged: { 12: merged(12) } }))[0];
  assert.deepEqual(branchStep(review, SHA_C), { args: branchDelete("argus/review-12-x"), kept: null });
  assert.deepEqual(branchStep(review, null), { args: null, kept: null });
});

test("ignored files: read with ls-files, kept on the row, and the row starts unticked", () => {
  assert.deepEqual(ignoredArgs(), ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]);
  assert.deepEqual(ignoredOf("docs/\nnode_modules/\n\n"), ["docs/", "node_modules/"]);
  assert.deepEqual(ignoredOf(""), []);
  const rows = rowsFor(input([wt("feat/a"), wt("feat/b")], { merged: { "feat/a": [merged(1)], "feat/b": [merged(2)] }, ignored: { "/w/feat-a": ["docs/"] } }));
  assert.deepEqual(rows[0].ignored, ["docs/"]);
  assert.equal(rows[0].reason, null);
  assert.deepEqual([...tickedByDefault(rows)], ["/w/feat-b"]);
});

test("readsOnOpen: the view reads when it has no list yet, and keeps finished results until Done", () => {
  assert.equal(readsOnOpen(null), true);
  assert.equal(readsOnOpen({ phase: "done" }), false);
  assert.equal(readsOnOpen({ phase: "list" }), false);
});

test("recheck: a worktree changed since the list was read is not removed", () => {
  const row = { ignored: ["docs/"], prunable: false };
  assert.equal(recheck(row, "", ["docs/"]), null);
  assert.equal(recheck(row, "", []), null);
  assert.equal(recheck(row, " M a.txt\n", ["docs/"]), "has changes");
  assert.equal(recheck(row, "?? new.txt\n", ["docs/"]), "has changes");
  assert.equal(recheck(row, null, ["docs/"]), "has changes");
  assert.equal(recheck(row, "", ["docs/", "tmp/"]), "ignored files changed");
  assert.equal(recheck(row, "", null), "ignored files changed");
  assert.equal(recheck({ ignored: [], prunable: true }, null, null), null);
});

test("rowsFor: a row keeps the prunable flag", () => {
  const rows = rowsFor(input([wt("feat/a", { prunable: true })], { merged: { "feat/a": [merged(8)] } }));
  assert.equal(rows[0].prunable, true);
});

test("stacked pull requests: only a merge into the default branch counts", () => {
  const stacked = { merged: { "feat/a": [merged(8, SHA_A, "2026-11-10T00:00:00Z", "feat/base")] }, defaultBranch: "main" };
  const [row] = rowsFor(input([wt("feat/a")], stacked));
  assert.equal(row.reason, "merged into feat/base");
  assert.equal(row.number, 8);
  assert.equal(rowsFor(input([wt("feat/a")], { ...stacked, defaultBranch: null }))[0].reason, null);
  const both = { merged: { "feat/a": [merged(9, SHA_B, "2026-11-12T00:00:00Z", "feat/base"), merged(8, SHA_A, "2026-11-10T00:00:00Z", "main")] }, defaultBranch: "main" };
  const [kept] = rowsFor(input([wt("feat/a")], both));
  assert.equal(kept.reason, null);
  assert.equal(kept.number, 8);
  const review = wt("argus/review-12-x");
  assert.equal(rowsFor(input([review], { reviewMerged: { 12: merged(12, SHA_A, "2026-11-10T00:00:00Z", "feat/base") }, defaultBranch: "main" }))[0].reason, "merged into feat/base");
  assert.equal(rowsFor(input([review], { reviewMerged: { 12: merged(12, SHA_A, "2026-11-10T00:00:00Z", "main") }, defaultBranch: "main" }))[0].reason, null);
});

test("rowsFor: a null merge time stays in the row", () => {
  const rows = rowsFor(input([wt("feat/a")], { merged: { "feat/a": [merged(8, SHA_A, null)] } }));
  assert.equal(rows[0].mergedAt, null);
  assert.equal(rows[0].reason, null);
});

test("rowsFor: submodules and unsaved commits grey a row, in the fixed order", () => {
  const m = { merged: { "feat/a": [merged(8)] } };
  const path = "/w/feat-a";
  const reason = (extra, worktree = wt("feat/a")) => rowsFor(input([worktree], { ...m, ...extra }))[0].reason;
  assert.equal(reason({ submodules: new Set([path]) }), "has submodules");
  assert.equal(reason({ unsaved: new Set([path]) }), "has unsaved commits");
  assert.equal(reason({ submodules: new Set([path]), unsaved: new Set([path]) }), "has submodules");
  assert.equal(reason({ dirty: new Set([path]), submodules: new Set([path]) }), "has changes");
  assert.equal(reason({ unsaved: new Set([path]), inSpace: new Set([path]) }), "has unsaved commits");
  assert.equal(reason({ inSpace: new Set([path]), defaultBranch: "main", merged: { "feat/a": [merged(8, SHA_A, "2026-11-10T00:00:00Z", "dev")] } }), "open in a space");
  const stacked = { openBranches: new Set(["feat/a"]), merged: { "feat/a": [merged(8, SHA_A, "2026-11-10T00:00:00Z", "dev")] }, defaultBranch: "main" };
  assert.equal(reason(stacked, wt("feat/a", { head: SHA_C })), "has an open pull request");
  assert.equal(reason({ ...stacked, openBranches: new Set() }, wt("feat/a", { head: SHA_C })), "merged into dev");
});

test("unsaved commits: the reflog is capped and read for the worktree's HEAD", () => {
  assert.deepEqual(reflogArgs(), ["log", "-g", "--max-count=200", "--format=%H", "HEAD"]);
  assert.deepEqual(reflogShas(`${SHA_A}\n${SHA_B}\n${SHA_A}\n\n`), [SHA_A, SHA_B]);
  assert.deepEqual(reflogShas(""), []);
  assert.deepEqual(unsavedArgs([SHA_A, SHA_B]), ["rev-list", "--max-count=1", SHA_A, SHA_B, "--not", "--branches", "--remotes", "--tags"]);
  assert.equal(unsavedArgs([]), null);
  assert.equal(hasOutput(`${SHA_A}\n`), true);
  assert.equal(hasOutput("\n"), false);
});

test("submodules: read with git submodule status", () => {
  assert.deepEqual(submoduleArgs(), ["submodule", "status"]);
  assert.equal(hasOutput(` ${SHA_A} sm (heads/main)\n`), true);
});

test("worktreesInSpaces: local spaces only, their folders and their terminals", () => {
  const spaces = [
    { id: "s1", folder: "/w/feat-a", machine: null, tabs: [{ id: "t1" }] },
    { id: "s2", folder: "/home/test/other", machine: null, tabs: [{ id: "t2" }] },
    { id: "s3", folder: "/w/remote", machine: "vps", tabs: [{ id: "t3" }] },
  ];
  const panes = [
    { tab: "t2", terminal: "p1", cwd: "/w/feat-b/src" },
    { tab: "t3", terminal: "p2", cwd: "/w/feat-c" },
    { tab: "t9", terminal: "p3", cwd: "/w/feat-d" },
    { tab: "t2", terminal: null, cwd: "/w/feat-e" },
  ];
  const list = ["feat-a", "feat-b", "feat-c", "feat-d", "feat-e", "feat-ab"].map((name) => wt(name));
  assert.deepEqual([...worktreesInSpaces(list, spaces, panes)].sort(), ["/w/feat-a", "/w/feat-b"]);
});

test("freshForReview: the board's Review link drops a list with no removal results, so the view reads again", () => {
  assert.equal(freshForReview(null), null);
  assert.equal(freshForReview({ phase: "list", results: {} }), null);
  const removing = { phase: "removing", results: {} };
  assert.equal(freshForReview(removing), removing);
  const done = { phase: "done", results: { "/w/a": "removed" } };
  assert.equal(freshForReview(done), done);
  const loading = { phase: "loading", results: {} };
  assert.equal(freshForReview(loading), loading);
});
