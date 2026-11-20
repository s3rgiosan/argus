import { test } from "node:test";
import assert from "node:assert/strict";
import { ghMergedListArgs, GL_MERGED_LIST_QUERY } from "../mods/argus-pull-requests/forge.js";
import { parseGhMergedList, parseGlMergedList } from "../mods/argus-pull-requests/model.js";
import { countMerged } from "../mods/argus-pull-requests/cleanup.js";

const A = "a".repeat(40);
const B = "b".repeat(40);

const wt = (branch, head = A, review = null) => ({ path: `/w/${branch}`, branch, head, locked: false, prunable: false, review });
const head = (number, branch, headSha = A, base = "main") => ({ number, branch, headSha, base });

test("ghMergedListArgs reads the repo's last 100 merged pull requests", () => {
  assert.deepEqual(ghMergedListArgs("example-org/example-repo"), [
    "pr", "list", "--repo", "example-org/example-repo", "--state", "merged", "--limit", "100", "--json", "number,headRefName,headRefOid,mergedAt,baseRefName,isCrossRepository",
  ]);
});

test("GL_MERGED_LIST_QUERY reads the project's last 100 merge requests, newest merge first", () => {
  assert.match(GL_MERGED_LIST_QUERY, /mergeRequests\(state: merged, first: 100, sort: MERGED_AT_DESC\) \{ nodes \{ iid sourceBranch diffHeadSha mergedAt targetBranch sourceProjectId targetProjectId \} \}/);
});

test("parseGhMergedList drops forks and invalid entries", () => {
  const text = JSON.stringify([
    { number: 1, headRefName: "feat/a", headRefOid: A, mergedAt: "2026-11-10T00:00:00Z", baseRefName: "main", isCrossRepository: false },
    { number: 2, headRefName: "feat/a", headRefOid: B, mergedAt: "2026-11-11T00:00:00Z", baseRefName: "main", isCrossRepository: true },
    { number: 3, headRefName: "feat/c", headRefOid: "nope", mergedAt: "2026-11-11T00:00:00Z", baseRefName: "main", isCrossRepository: false },
    { number: 0, headRefName: "feat/d", headRefOid: A, mergedAt: "2026-11-11T00:00:00Z", baseRefName: "main", isCrossRepository: false },
  ]);
  assert.deepEqual(parseGhMergedList(text), [{ number: 1, branch: "feat/a", headSha: A, base: "main" }]);
  assert.deepEqual(parseGhMergedList("{}"), []);
});

test("parseGlMergedList drops merge requests from another project and invalid entries", () => {
  const nodes = [
    { iid: "4", sourceBranch: "feat/a", diffHeadSha: A, mergedAt: null, targetBranch: "main", sourceProjectId: 7, targetProjectId: 7 },
    { iid: "5", sourceBranch: "feat/a", diffHeadSha: B, mergedAt: null, targetBranch: "main", sourceProjectId: 8, targetProjectId: 7 },
    { iid: "x", sourceBranch: "feat/c", diffHeadSha: A, mergedAt: null, targetBranch: "main", sourceProjectId: 7, targetProjectId: 7 },
  ];
  assert.deepEqual(parseGlMergedList(JSON.stringify({ data: { project: { mergeRequests: { nodes } } } })), [{ number: 4, branch: "feat/a", headSha: A, base: "main" }]);
  assert.deepEqual(parseGlMergedList(JSON.stringify({ data: { project: null } })), []);
});

test("countMerged: a branch whose head is the merged head counts", () => {
  assert.equal(countMerged([wt("feat/a")], [head(1, "feat/a")], "main"), 1);
});

test("countMerged: a reused branch name at another commit does not count", () => {
  assert.equal(countMerged([wt("feat/a", B)], [head(1, "feat/a", A)], "main"), 0);
});

test("countMerged: a merge into another base does not count, unless the base or the default is unknown", () => {
  assert.equal(countMerged([wt("feat/a")], [head(1, "feat/a", A, "release")], "main"), 0);
  assert.equal(countMerged([wt("feat/a")], [head(1, "feat/a", A, null)], "main"), 1);
  assert.equal(countMerged([wt("feat/a")], [head(1, "feat/a", A, "release")], null), 1);
});

test("countMerged: a review worktree counts by its number, once", () => {
  const review = wt("argus/review-12-x", B, 12);
  assert.equal(countMerged([review], [head(12, "feat/z", A)], "main"), 1);
  assert.equal(countMerged([review], [head(12, "feat/z", A), head(12, "feat/y", A)], "main"), 1);
  assert.equal(countMerged([review], [head(13, "argus/review-12-x", B)], "main"), 0);
});

test("countMerged counts each matching worktree once", () => {
  assert.equal(countMerged([wt("feat/a"), wt("feat/b")], [head(1, "feat/a"), head(2, "feat/a")], "main"), 1);
});
