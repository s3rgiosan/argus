import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGlabDetail, parseGlabMr, parseGlabProject, parseGlabUser } from "../mods/argus-pull-requests/model.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const host = "gitlab.example.com";
const path = "example-group/example-sub/example-project";

test("parseGlabUser splits authored and review-requested merge requests", () => {
  const { needsReview, mine } = parseGlabUser(fixture("pr-glab-user.json"), host);
  assert.equal(mine.length, 1);
  assert.equal(needsReview.length, 1);
  const a = mine[0];
  assert.equal(a.number, 11);
  assert.equal(a.repo, path);
  assert.equal(a.provider, "gitlab");
  assert.equal(a.host, host);
  assert.equal(a.url, `https://${host}/${path}/-/merge_requests/11`);
  assert.equal(a.author, "octo-user");
  assert.equal(a.headRef, "feature/11");
  assert.equal(a.baseRef, "main");
  assert.equal(a.state, "open");
  assert.equal(a.isDraft, false);
  assert.equal(a.localPath, null);
  assert.equal(a.reviewDecision, "approved");
  assert.equal(a.mergeable, "mergeable");
  assert.deepEqual(a.checks, { passed: 1, failed: 0, running: 0, total: 1 });
  const b = needsReview[0];
  assert.equal(b.number, 12);
  assert.equal(b.reviewDecision, "review_required");
  assert.equal(b.mergeable, "blocked");
  assert.deepEqual(b.checks, { passed: 0, failed: 0, running: 1, total: 1 });
});

test("parseGlabProject maps every merge request", () => {
  const [c, d] = parseGlabProject(fixture("pr-glab-project.json"), host);
  assert.equal(c.number, 13);
  assert.equal(c.isDraft, true);
  assert.equal(c.reviewDecision, null);
  assert.deepEqual(c.checks, { passed: 0, failed: 0, running: 0, total: 0 });
  assert.equal(d.number, 14);
  assert.equal(d.mergeable, "conflicting");
  assert.deepEqual(d.checks, { passed: 0, failed: 1, running: 0, total: 1 });
});

test("parseGlabDetail builds the detail view", () => {
  const detail = parseGlabDetail(fixture("pr-glab-detail.json"), host);
  assert.equal(detail.pr.number, 14);
  assert.equal(detail.pr.reviewDecision, "changes_requested");
  assert.equal(detail.body, "Example description.");
  assert.deepEqual(detail.checks, [
    { name: "build", state: "passed" },
    { name: "test", state: "failed" },
  ]);
  assert.deepEqual(detail.reviewers, [{ name: "review-user", state: "changes_requested" }]);
  assert.deepEqual(detail.conversation, [
    { author: "review-user", body: "Example note.", at: "2026-11-12T09:00:00Z", kind: "comment" },
  ]);
  assert.deepEqual(detail.merge, { state: "conflicting", reason: "Indicates a reviewer has requested changes." });
});

test("parseGlabDetail falls back to one pipeline check, requested reviewers and name-based reasons", () => {
  const raw = JSON.parse(fixture("pr-glab-detail.json"));
  const mr = raw.data.project.mergeRequest;
  mr.conflicts = false;
  mr.detailedMergeStatus = "SOMETHING_NEW";
  mr.headPipeline = { status: "running" };
  mr.reviewers.nodes = [
    { username: "a-user", mergeRequestInteraction: { reviewState: "constructor" } },
    { username: "b-user", mergeRequestInteraction: null },
  ];
  const detail = parseGlabDetail(JSON.stringify(raw), host);
  assert.deepEqual(detail.checks, [{ name: "pipeline", state: "running" }]);
  assert.deepEqual(detail.reviewers, [
    { name: "a-user", state: "requested" },
    { name: "b-user", state: "requested" },
  ]);
  assert.deepEqual(detail.merge, { state: "blocked", reason: "something new" });
});

test("parseGlabMr maps statuses case-insensitively", () => {
  const node = {
    iid: "5",
    state: "merged",
    detailedMergeStatus: "mergeable",
    headPipeline: { status: "canceled" },
    targetProject: { fullPath: path },
  };
  const pr = parseGlabMr(node, host);
  assert.equal(pr.state, "merged");
  assert.equal(pr.mergeable, "mergeable");
  assert.equal(pr.checks.failed, 1);
  assert.equal(parseGlabMr({ ...node, state: "closed", detailedMergeStatus: undefined }, host).mergeable, "unknown");
  assert.equal(parseGlabMr({ ...node, state: "closed" }, host).state, "closed");
});

test("GitLab parsers throw on errors, signed-out and missing project", () => {
  const signedOut = JSON.stringify({ data: { currentUser: null } });
  const noProject = JSON.stringify({ data: { project: null } });
  const noMr = JSON.stringify({ data: { project: { mergeRequest: null } } });
  const errors = JSON.stringify({ errors: [{ message: "Field 'x' doesn't exist" }], data: { currentUser: null } });
  assert.throws(() => parseGlabUser(signedOut, host), { message: "not signed in" });
  assert.throws(() => parseGlabProject(noProject, host), { message: "project not found" });
  assert.throws(() => parseGlabDetail(noMr, host), { message: "project not found" });
  assert.throws(() => parseGlabDetail(noProject, host), { message: "project not found" });
  assert.throws(() => parseGlabUser(errors, host), { message: "Field 'x' doesn't exist" });
  assert.throws(() => parseGlabProject("nope", host), { message: "unexpected glab output" });
  assert.throws(() => parseGlabUser("{}", host), { message: "unexpected glab output" });
  assert.throws(() => parseGlabProject('{"data":{"project":{}}}', host), { message: "unexpected glab output" });
  assert.throws(() => parseGlabMr({}, host), { message: "unexpected glab output" });
});

test("parseGlabMr rejects an empty, zero or non-numeric iid", () => {
  for (const iid of ["", "0", "abc", "1.5", "-3", null, undefined, {}]) {
    assert.throws(() => parseGlabMr({ iid, targetProject: { fullPath: path } }, host), { message: "unexpected glab output" }, String(iid));
  }
  assert.equal(parseGlabMr({ iid: 7, targetProject: { fullPath: path } }, host).number, 7);
});

test("GitLab lists drop a merge request without a usable iid and keep the rest", () => {
  const node = (iid) => ({ iid, title: "t", targetProject: { fullPath: path } });
  const nodes = [node(""), node("4"), node("abc"), node(null), node("5")];
  const user = JSON.stringify({ data: { currentUser: { reviewRequestedMergeRequests: { nodes }, authoredMergeRequests: { nodes: [node("")] } } } });
  const project = JSON.stringify({ data: { project: { mergeRequests: { nodes } } } });
  const parsed = parseGlabUser(user, host);
  assert.deepEqual(parsed.needsReview.map((pr) => pr.number), [4, 5]);
  assert.deepEqual(parsed.mine, []);
  assert.deepEqual(parseGlabProject(project, host).map((pr) => pr.number), [4, 5]);
});
