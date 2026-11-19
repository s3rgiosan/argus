import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS_BODY, NO_METHOD, NO_SHA, actionCommand, afterAction, bodyError, canAct, ghMethodArgs, mergePrompt, pickMergeMethod } from "../mods/argus-pull-requests/actions.js";

const GL_URL = "https://gitlab.example.com/example-group/example-sub/example-project";

const pr = (provider, host, repo) => ({
  provider,
  host,
  repo,
  number: 12,
  title: "Example title",
  url: "",
  author: "octo-user",
  headRef: "feature/example",
  baseRef: "main",
  isDraft: false,
  state: "open",
  reviewDecision: null,
  checks: { passed: 0, failed: 0, running: 0, total: 0 },
  mergeable: "mergeable",
  updatedAt: "2026-01-01T00:00:00Z",
  localPath: null,
});

const detail = (p) => ({
  pr: p,
  body: "",
  headSha: "abc123",
  squash: false,
  checks: [],
  reviewers: [],
  merge: { state: "mergeable", reason: null },
  conversation: [],
});

const gh = detail(pr("github", "github.com", "example-org/example-repo"));
const gl = detail(pr("gitlab", "gitlab.example.com", "example-group/example-sub/example-project"));

test("gh approve", () => {
  assert.deepEqual(actionCommand({ kind: "approve", detail: gh, body: "" }), {
    name: "gh",
    args: ["pr", "review", "12", "--repo", "example-org/example-repo", "--approve"],
  });
});

test("gh request changes and comment", () => {
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gh, body: "Fix it" }).args, [
    "pr", "review", "12", "--repo", "example-org/example-repo", "--request-changes", "--body=Fix it",
  ]);
  assert.deepEqual(actionCommand({ kind: "comment", detail: gh, body: "Looks fine" }).args, [
    "pr", "review", "12", "--repo", "example-org/example-repo", "--comment", "--body=Looks fine",
  ]);
});

test("glab approve, comment and request changes", () => {
  assert.deepEqual(actionCommand({ kind: "approve", detail: gl, body: "" }), {
    name: "glab",
    args: ["mr", "approve", "12", "-R", GL_URL, "--sha", "abc123"],
  });
  assert.deepEqual(actionCommand({ kind: "comment", detail: gl, body: "ok" }).args, [
    "mr", "note", "create", "12", "-R", GL_URL, "--message=ok", "--resolvable=false",
  ]);
});

test("body stays one argument", () => {
  const body = "-x \"quoted\"\nsecond=line";
  assert.deepEqual(actionCommand({ kind: "comment", detail: gh, body }).args.slice(-2), ["--comment", `--body=${body}`]);
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gl, body }).args, [
    "mr", "note", "draft", "create", "12", "-R", GL_URL, `--message=${body}`,
  ]);
});

test("merge args pin the head", () => {
  assert.deepEqual(actionCommand({ kind: "merge", detail: gh, body: "", method: "squash" }).args, [
    "pr", "merge", "12", "--repo", "example-org/example-repo", "--squash", "--match-head-commit", "abc123",
  ]);
  assert.deepEqual(actionCommand({ kind: "merge", detail: gl, body: "" }).args, [
    "mr", "merge", "12", "-R", GL_URL, "--yes", "--auto-merge=false", "--sha", "abc123",
  ]);
  assert.deepEqual(actionCommand({ kind: "merge", detail: { ...gl, squash: true }, body: "" }).args, [
    "mr", "merge", "12", "-R", GL_URL, "--yes", "--auto-merge=false", "--sha", "abc123", "--squash",
  ]);
});

test("missing sha refuses", () => {
  for (const [kind, d] of [["merge", gh], ["merge", gl], ["approve", gl]]) {
    assert.deepEqual(actionCommand({ kind, detail: { ...d, headSha: null }, body: "", method: "merge" }), { error: NO_SHA });
  }
  assert.equal(actionCommand({ kind: "approve", detail: { ...gh, headSha: null }, body: "" }).name, "gh");
});

test("gh merge without a method refuses", () => {
  assert.deepEqual(actionCommand({ kind: "merge", detail: gh, body: "", method: null }), { error: NO_METHOD });
});

test("bodyError", () => {
  assert.equal(bodyError("comment", "  \n "), "Write a comment first.");
  assert.equal(bodyError("request_changes", ""), "Write a comment first.");
  assert.equal(bodyError("comment", "ok"), null);
  assert.equal(bodyError("approve", ""), null);
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gh, body: "" }), { error: "Write a comment first." });
  assert.deepEqual([...NEEDS_BODY].sort(), ["comment", "request_changes"]);
});

test("unknown kind throws", () => {
  assert.throws(() => actionCommand({ kind: "close", detail: gh, body: "" }), /unknown action/);
});

test("ghMethodArgs", () => {
  assert.deepEqual(ghMethodArgs("example-org/example-repo"), [
    "repo", "view", "example-org/example-repo", "--json", "viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed",
  ]);
});

test("pickMergeMethod", () => {
  const r = (o) => JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, ...o });
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: "SQUASH" })), "squash");
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: "REBASE" })), "rebase");
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: "MERGE", mergeCommitAllowed: false })), "squash");
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: null, mergeCommitAllowed: false, squashMergeAllowed: false })), "rebase");
  assert.equal(pickMergeMethod(r({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false })), null);
  assert.equal(pickMergeMethod("not json"), null);
  assert.equal(pickMergeMethod("null"), null);
});

test("glab repo url", () => {
  // The URL comes from the detail's host and repo as stored.
  assert.equal(actionCommand({ kind: "comment", detail: gl, body: "ok" }).args[5], GL_URL);
});

test("mergePrompt", () => {
  assert.equal(mergePrompt(gh, "merge"), "Merge #12 into main with a merge commit?");
  assert.equal(mergePrompt(gh, "squash"), "Merge #12 into main with squash?");
  assert.equal(mergePrompt(gh, "rebase"), "Merge #12 into main with rebase?");
  assert.equal(mergePrompt(gl, null), "Merge #12 into main with the project's merge method?");
  assert.equal(mergePrompt({ ...gl, squash: true }, null), "Merge #12 into main with squash?");
});

test("canAct", () => {
  assert.equal(canAct(gh.pr), true);
  assert.equal(canAct({ ...gh.pr, state: "merged" }), false);
  assert.equal(canAct({ ...gh.pr, state: "closed" }), false);
  assert.equal(canAct({ ...gh.pr, isDraft: true }), true);
});

test("glab request changes creates a draft, then publishes it", () => {
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gl, body: "Fix it" }), {
    name: "glab",
    args: ["mr", "note", "draft", "create", "12", "-R", GL_URL, "--message=Fix it"],
    then: ["mr", "note", "draft", "publish", "12", "-R", GL_URL, "--reviewer-state=requested_changes", "--yes"],
  });
  assert.equal("then" in actionCommand({ kind: "comment", detail: gl, body: "ok" }), false);
});

test("afterAction re-reads after every action and clears the comment only after its own action", () => {
  assert.deepEqual(afterAction("approve", true), { reread: true, clearComment: false });
  assert.deepEqual(afterAction("merge", true), { reread: true, clearComment: false });
  assert.deepEqual(afterAction("comment", true), { reread: true, clearComment: true });
  assert.deepEqual(afterAction("request_changes", true), { reread: true, clearComment: true });
  assert.deepEqual(afterAction("comment", false), { reread: true, clearComment: false });
  assert.deepEqual(afterAction("merge", false), { reread: true, clearComment: false });
});
