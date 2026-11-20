import { test } from "node:test";
import assert from "node:assert/strict";
import { ghMergedArgs, ghPrStateArgs, glabArgs, GL_MERGED_QUERY, GL_MR_STATE_QUERY } from "../mods/argus-pull-requests/forge.js";
import { parseGhMerged, parseGhPrState, parseGlMerged, parseGlMrState } from "../mods/argus-pull-requests/model.js";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("ghMergedArgs and ghPrStateArgs read merged pull requests by branch and by number", () => {
  assert.deepEqual(ghMergedArgs("example-org/example-repo", "feat/a b"), [
    "pr", "list", "--repo", "example-org/example-repo", "--head", "feat/a b", "--state", "merged", "--limit", "5", "--json", "number,headRefOid,mergedAt",
  ]);
  assert.deepEqual(ghPrStateArgs("example-org/example-repo", 12), ["pr", "view", "12", "--repo", "example-org/example-repo", "--json", "number,state,headRefOid,mergedAt"]);
});

test("the GitLab merged queries select a branch's merged requests and one request by iid", () => {
  assert.match(GL_MERGED_QUERY, /mergeRequests\(sourceBranches: \[\$branch\], state: merged, first: 5\) \{ nodes \{ iid diffHeadSha mergedAt \} \}/);
  assert.match(GL_MR_STATE_QUERY, /mergeRequest\(iid: \$iid\) \{ iid state diffHeadSha mergedAt \}/);
  assert.deepEqual(glabArgs("gitlab.example.com", GL_MERGED_QUERY, { path: "example-group/example-project", branch: "feat/a" }).slice(-4), ["-f", "path=example-group/example-project", "-f", "branch=feat/a"]);
});

test("parseGhMerged keeps valid entries, newest merge first", () => {
  const text = JSON.stringify([
    { number: 8, headRefOid: A, mergedAt: "2026-11-10T00:00:00Z" },
    { number: 9, headRefOid: B, mergedAt: "2026-11-12T00:00:00Z" },
    { number: 10, headRefOid: "not-a-sha", mergedAt: "2026-11-13T00:00:00Z" },
    { number: -1, headRefOid: A, mergedAt: "2026-11-13T00:00:00Z" },
  ]);
  assert.deepEqual(parseGhMerged(text), [
    { number: 9, headSha: B, mergedAt: "2026-11-12T00:00:00Z" },
    { number: 8, headSha: A, mergedAt: "2026-11-10T00:00:00Z" },
  ]);
  assert.deepEqual(parseGhMerged("{}"), []);
});

test("parseGhPrState gives a merged pull request only", () => {
  assert.deepEqual(parseGhPrState(JSON.stringify({ number: 12, state: "MERGED", headRefOid: A, mergedAt: "2026-11-10T00:00:00Z" })), { number: 12, headSha: A, mergedAt: "2026-11-10T00:00:00Z" });
  assert.equal(parseGhPrState(JSON.stringify({ number: 12, state: "OPEN", headRefOid: A, mergedAt: null })), null);
  assert.equal(parseGhPrState(JSON.stringify({ number: 12, state: "MERGED", headRefOid: "x", mergedAt: "2026-11-10T00:00:00Z" })), null);
});

test("parseGlMerged and parseGlMrState read GitLab merged requests", () => {
  const list = { data: { project: { mergeRequests: { nodes: [
    { iid: "3", diffHeadSha: A, mergedAt: "2026-11-10T00:00:00Z" },
    { iid: "4", diffHeadSha: B, mergedAt: "2026-11-12T00:00:00Z" },
    { iid: "5", diffHeadSha: null, mergedAt: "2026-11-12T00:00:00Z" },
  ] } } } };
  assert.deepEqual(parseGlMerged(JSON.stringify(list)), [
    { number: 4, headSha: B, mergedAt: "2026-11-12T00:00:00Z" },
    { number: 3, headSha: A, mergedAt: "2026-11-10T00:00:00Z" },
  ]);
  assert.deepEqual(parseGlMerged(JSON.stringify({ data: { project: null } })), []);
  const one = (state) => JSON.stringify({ data: { project: { mergeRequest: { iid: "7", state, diffHeadSha: A, mergedAt: "2026-11-10T00:00:00Z" } } } });
  assert.deepEqual(parseGlMrState(one("merged")), { number: 7, headSha: A, mergedAt: "2026-11-10T00:00:00Z" });
  assert.equal(parseGlMrState(one("opened")), null);
  assert.equal(parseGlMrState(JSON.stringify({ data: { project: { mergeRequest: null } } })), null);
});
