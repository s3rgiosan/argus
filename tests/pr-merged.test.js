import { test } from "node:test";
import assert from "node:assert/strict";
import { ghMergedArgs, ghPrStateArgs, GL_MERGED_QUERY, GL_MR_STATE_QUERY } from "../mods/argus-pull-requests/forge.js";
import { glabArgs } from "../lib/forge-cli.js";
import { parseGhMerged, parseGhPrState, parseGlMerged, parseGlMrState } from "../mods/argus-pull-requests/model.js";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("ghMergedArgs and ghPrStateArgs read merged pull requests by branch and by number", () => {
  assert.deepEqual(ghMergedArgs("example-org/example-repo", "feat/a b"), [
    "pr", "list", "--repo", "example-org/example-repo", "--head", "feat/a b", "--state", "merged", "--limit", "10", "--json", "number,headRefOid,mergedAt,baseRefName,isCrossRepository",
  ]);
  assert.deepEqual(ghPrStateArgs("example-org/example-repo", 12), ["pr", "view", "12", "--repo", "example-org/example-repo", "--json", "number,state,headRefOid,mergedAt,baseRefName"]);
});

test("the GitLab merged queries select a branch's merged requests and one request by iid", () => {
  assert.match(GL_MERGED_QUERY, /mergeRequests\(sourceBranches: \[\$branch\], state: merged, first: 10\) \{ nodes \{ iid diffHeadSha mergedAt targetBranch sourceProjectId targetProjectId \} \}/);
  assert.match(GL_MR_STATE_QUERY, /mergeRequest\(iid: \$iid\) \{ iid state diffHeadSha mergedAt targetBranch \}/);
  assert.deepEqual(glabArgs("gitlab.example.com", GL_MERGED_QUERY, { path: "example-group/example-project", branch: "feat/a" }).slice(-4), ["-f", "path=example-group/example-project", "-f", "branch=feat/a"]);
});

test("parseGhMerged keeps valid entries, newest merge first, and drops forks", () => {
  const text = JSON.stringify([
    { number: 8, headRefOid: A, mergedAt: "2026-11-10T00:00:00Z", baseRefName: "main", isCrossRepository: false },
    { number: 9, headRefOid: B, mergedAt: "2026-11-12T00:00:00Z", baseRefName: "dev", isCrossRepository: false },
    { number: 10, headRefOid: "not-a-sha", mergedAt: "2026-11-13T00:00:00Z", baseRefName: "main" },
    { number: -1, headRefOid: A, mergedAt: "2026-11-13T00:00:00Z", baseRefName: "main" },
    { number: 11, headRefOid: A, mergedAt: "2026-11-14T00:00:00Z", baseRefName: "main", isCrossRepository: true },
  ]);
  assert.deepEqual(parseGhMerged(text), [
    { number: 9, headSha: B, mergedAt: "2026-11-12T00:00:00Z", base: "dev" },
    { number: 8, headSha: A, mergedAt: "2026-11-10T00:00:00Z", base: "main" },
  ]);
  assert.deepEqual(parseGhMerged("{}"), []);
});

test("parseGhPrState gives a merged pull request only", () => {
  assert.deepEqual(parseGhPrState(JSON.stringify({ number: 12, state: "MERGED", headRefOid: A, mergedAt: "2026-11-10T00:00:00Z", baseRefName: "main" })), { number: 12, headSha: A, mergedAt: "2026-11-10T00:00:00Z", base: "main" });
  assert.equal(parseGhPrState(JSON.stringify({ number: 12, state: "OPEN", headRefOid: A, mergedAt: null })), null);
  assert.equal(parseGhPrState(JSON.stringify({ number: 12, state: "MERGED", headRefOid: "x", mergedAt: "2026-11-10T00:00:00Z" })), null);
});

test("parseGlMerged and parseGlMrState read GitLab merged requests", () => {
  const list = { data: { project: { mergeRequests: { nodes: [
    { iid: "3", diffHeadSha: A, mergedAt: "2026-11-10T00:00:00Z", targetBranch: "main", sourceProjectId: 5, targetProjectId: 5 },
    { iid: "4", diffHeadSha: B, mergedAt: "2026-11-12T00:00:00Z", targetBranch: "dev", sourceProjectId: 5, targetProjectId: 5 },
    { iid: "5", diffHeadSha: null, mergedAt: "2026-11-12T00:00:00Z", targetBranch: "main", sourceProjectId: 5, targetProjectId: 5 },
    { iid: "6", diffHeadSha: A, mergedAt: "2026-11-13T00:00:00Z", targetBranch: "main", sourceProjectId: 9, targetProjectId: 5 },
  ] } } } };
  assert.deepEqual(parseGlMerged(JSON.stringify(list)), [
    { number: 4, headSha: B, mergedAt: "2026-11-12T00:00:00Z", base: "dev" },
    { number: 3, headSha: A, mergedAt: "2026-11-10T00:00:00Z", base: "main" },
  ]);
  assert.deepEqual(parseGlMerged(JSON.stringify({ data: { project: null } })), []);
  const one = (state, mergedAt = "2026-11-10T00:00:00Z") => JSON.stringify({ data: { project: { mergeRequest: { iid: "7", state, diffHeadSha: A, mergedAt, targetBranch: "main" } } } });
  assert.deepEqual(parseGlMrState(one("merged")), { number: 7, headSha: A, mergedAt: "2026-11-10T00:00:00Z", base: "main" });
  assert.equal(parseGlMrState(one("opened")), null);
  assert.equal(parseGlMrState(JSON.stringify({ data: { project: { mergeRequest: null } } })), null);
});

test("a merged entry may have no merge time, and sorts last", () => {
  const list = { data: { project: { mergeRequests: { nodes: [
    { iid: "3", diffHeadSha: A, mergedAt: null, targetBranch: "main", sourceProjectId: 5, targetProjectId: 5 },
    { iid: "4", diffHeadSha: B, mergedAt: "2026-11-12T00:00:00Z", targetBranch: "main", sourceProjectId: 5, targetProjectId: 5 },
  ] } } } };
  assert.deepEqual(parseGlMerged(JSON.stringify(list)).map((entry) => [entry.number, entry.mergedAt]), [[4, "2026-11-12T00:00:00Z"], [3, null]]);
  const state = JSON.stringify({ data: { project: { mergeRequest: { iid: "7", state: "merged", diffHeadSha: A, mergedAt: null, targetBranch: "main" } } } });
  assert.deepEqual(parseGlMrState(state), { number: 7, headSha: A, mergedAt: null, base: "main" });
});


test("GitLab merged parsers throw on a GraphQL error reply", () => {
  const reply = JSON.stringify({ errors: [{ message: "Example failure" }], data: null });
  assert.throws(() => parseGlMerged(reply), /Example failure/);
  assert.throws(() => parseGlMrState(reply), /Example failure/);
});
