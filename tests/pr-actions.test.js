import { test } from "node:test";
import assert from "node:assert/strict";
import { CLI_TIMEOUT } from "../lib/forge-runner.js";
import { DRAFT_KEPT, DRAFT_TEXT, DRAFTS_UNREAD, HEAD_MOVED, HEAD_UNREAD, LOGIN_TTL, NEEDS_BODY, NO_METHOD, NO_SHA, RUN_LIMIT, actionCommand, ghHeadArgs, glHeadArgs, headRefusal, actionFailure, afterAction, bodyError, canAct, clearsComment, confirmedDetail, draftListArgs, draftPlan, loginFresh, ownPr, ghMethodArgs, leavePr, mergePrompt, pendingDrafts, pickMergeMethod, runningOf, withRunning, withoutRunning } from "../mods/argus-pull-requests/actions.js";

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

test("gh approve reads the head first", () => {
  assert.deepEqual(actionCommand({ kind: "approve", detail: gh, body: "" }), {
    name: "gh",
    args: ["api", "--method", "POST", "--hostname", "github.com", "repos/example-org/example-repo/pulls/12/reviews", "-f", `commit_id=${gh.headSha}`, "-f", "event=APPROVE"],
    check: ["pr", "view", "12", "--repo", "example-org/example-repo", "--json", "headRefOid"],
  });
  // -f is a raw string, so a body that starts with @ or - stays text.
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gh, body: "@file" }).args.slice(-4), ["-f", "event=REQUEST_CHANGES", "-f", "body=@file"]);
});

test("gh request changes reads the head first; comment does not", () => {
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gh, body: "Fix it" }).check, ghHeadArgs("example-org/example-repo", 12));
  assert.equal(actionCommand({ kind: "comment", detail: gh, body: "Looks fine" }).check, undefined);
  for (const kind of ["approve", "comment"]) {
    assert.equal(actionCommand({ kind, detail: gl, body: "Text" }).check, undefined);
  }
});

test("gl request changes reads the head first", () => {
  const command = actionCommand({ kind: "request_changes", detail: gl, body: "Fix it" });
  assert.deepEqual(command.check, glHeadArgs(gl.pr));
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gl, body: "Fix it", publishOnly: true }).check, glHeadArgs(gl.pr));
  assert.equal(headRefusal(gl.headSha, JSON.stringify({ data: { project: { mergeRequest: { diffHeadSha: gl.headSha } } } })), null);
  assert.equal(headRefusal(gl.headSha, JSON.stringify({ data: { project: { mergeRequest: { diffHeadSha: "other" } } } })), HEAD_MOVED);
  assert.equal(headRefusal(gl.headSha, JSON.stringify({ data: { project: { mergeRequest: null } } })), HEAD_UNREAD);
});

test("headRefusal compares the current head with the shown head", () => {
  assert.equal(headRefusal("abc123", JSON.stringify({ headRefOid: "abc123" })), null);
  assert.equal(headRefusal("abc123", JSON.stringify({ headRefOid: "def456" })), HEAD_MOVED);
  assert.equal(headRefusal(null, JSON.stringify({ headRefOid: "def456" })), HEAD_MOVED);
  for (const stdout of ["", "not json", "null", "[]", JSON.stringify({}), JSON.stringify({ headRefOid: "" }), JSON.stringify({ headRefOid: 7 })]) {
    assert.equal(headRefusal("abc123", stdout), HEAD_UNREAD);
  }
});

test("gh request changes and comment", () => {
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gh, body: "Fix it" }).args, [
    "api", "--method", "POST", "--hostname", "github.com", "repos/example-org/example-repo/pulls/12/reviews", "-f", "commit_id=abc123", "-f", "event=REQUEST_CHANGES", "-f", "body=Fix it",
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

test("GitLab merge follows the picked method", () => {
  assert.deepEqual(actionCommand({ kind: "merge", detail: gl, body: "", method: "squash" }).args.slice(-1), ["--squash"]);
  assert.deepEqual(actionCommand({ kind: "merge", detail: gl, body: "", method: "rebase" }), { error: NO_METHOD });
});

test("missing sha refuses", () => {
  for (const [kind, d] of [["merge", gh], ["merge", gl], ["approve", gl], ["approve", gh], ["request_changes", gh]]) {
    assert.deepEqual(actionCommand({ kind, detail: { ...d, headSha: null }, body: "Text", method: "merge" }), { error: NO_SHA });
  }
  assert.equal(actionCommand({ kind: "comment", detail: { ...gh, headSha: null }, body: "Text" }).name, "gh");
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
  assert.equal(mergePrompt(gl, null), "Merge #12 into main?");
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
    check: glHeadArgs(gl.pr),
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

test("a kept GitLab draft is only published on retry", () => {
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gl, body: "Fix it", publishOnly: true }), {
    name: "glab",
    args: ["mr", "note", "draft", "publish", "12", "-R", GL_URL, "--reviewer-state=requested_changes", "--yes"],
    check: glHeadArgs(gl.pr),
  });
  // A publish still needs the comment that was drafted, so an empty box refuses.
  assert.deepEqual(actionCommand({ kind: "request_changes", detail: gl, body: " ", publishOnly: true }), { error: "Write a comment first." });
  // Only GitLab Request changes has a draft step.
  assert.deepEqual(actionCommand({ kind: "comment", detail: gl, body: "ok", publishOnly: true }).args.slice(0, 3), ["mr", "note", "create"]);
});

test("draftListArgs lists the user's pending comments as JSON", () => {
  assert.deepEqual(draftListArgs(gl), ["mr", "note", "draft", "list", "12", "-R", GL_URL, "-F", "json"]);
});

test("draftPlan: no pending comment creates and publishes", () => {
  assert.deepEqual(draftPlan("[]", null, "Fix it"), { publishOnly: false });
  // A kept draft that is gone from GitLab is drafted again.
  assert.deepEqual(draftPlan("[]", "Fix it", "Fix it"), { publishOnly: false });
});

test("draftPlan: the kept draft with the same text is only published", () => {
  assert.deepEqual(draftPlan('[{"id": 1}]', "Fix it", "  Fix it\n"), { publishOnly: true });
});

test("draftPlan: a changed text after a kept draft refuses", () => {
  assert.deepEqual(draftPlan('[{"id": 1}]', "Fix it", "Fix this instead"), { error: DRAFT_TEXT });
});

test("draftPlan: other pending comments refuse, so a publish sends only this one", () => {
  assert.deepEqual(draftPlan('[{"id": 1}]', null, "Fix it"), { error: pendingDrafts(1) });
  assert.deepEqual(draftPlan('[{"id": 1}, {"id": 2}]', "Fix it", "Fix it"), { error: pendingDrafts(2) });
  assert.match(pendingDrafts(1), /1 pending review comment on/);
  assert.match(pendingDrafts(2), /2 pending review comments on/);
});

test("draftPlan: an unreadable list refuses", () => {
  assert.deepEqual(draftPlan("not json", null, "Fix it"), { error: DRAFTS_UNREAD });
  assert.deepEqual(draftPlan('{"id": 1}', null, "Fix it"), { error: DRAFTS_UNREAD });
});

test("confirmedDetail merges the head the confirm was shown for", () => {
  const moved = { ...gh, headSha: "def456" };
  assert.equal(confirmedDetail(moved, { method: "squash", headSha: "abc123" }).headSha, "abc123");
  assert.equal(actionCommand({ kind: "merge", detail: confirmedDetail(moved, { method: "squash", headSha: "abc123" }), body: "", method: "squash" }).args.at(-1), "abc123");
});

test("clearsComment only clears a box that still holds the sent text", () => {
  const ok = afterAction("comment", true);
  assert.equal(clearsComment(ok, "Looks fine", "Looks fine"), true);
  assert.equal(clearsComment(ok, "Looks fine", "Looks fine, and one more"), false);
  assert.equal(clearsComment(afterAction("comment", false), "Looks fine", "Looks fine"), false);
  assert.equal(clearsComment(afterAction("approve", true), "", ""), false);
});

test("loginFresh keeps a login, or a failed read, for LOGIN_TTL per gh setting", () => {
  const cache = { setting: "", value: "octo-user", at: 1000 };
  assert.equal(loginFresh(cache, "", 1000 + LOGIN_TTL - 1), true);
  assert.equal(loginFresh(cache, "", 1000 + LOGIN_TTL), false);
  assert.equal(loginFresh(cache, "/opt/gh", 1000), false);
  assert.equal(loginFresh({ ...cache, value: null }, "", 1000), true);
  assert.equal(loginFresh(null, "", 1000), false);
});

test("running actions are shared by every copy and expire after RUN_LIMIT", () => {
  const one = withRunning({}, "pr-a", "merge", 1000);
  assert.equal(runningOf(one, "pr-a", 1000 + RUN_LIMIT - 1), "merge");
  assert.equal(runningOf(one, "pr-a", 1000 + RUN_LIMIT), null);
  assert.equal(runningOf(one, "pr-b", 1000), null);
  assert.equal(runningOf(withoutRunning(one, "pr-a"), "pr-a", 1000), null);
  assert.equal(runningOf(null, "pr-a", 1000), null);
  assert.equal(runningOf({ "pr-a": "bad" }, "pr-a", 1000), null);
  // The maps are copies, so a shared value is never changed in place.
  assert.deepEqual(withRunning(one, "pr-b", "comment", 5), { "pr-a": { kind: "merge", at: 1000 }, "pr-b": { kind: "comment", at: 5 } });
  assert.deepEqual(one, { "pr-a": { kind: "merge", at: 1000 } });
});

test("actionFailure says when the draft is kept", () => {
  assert.equal(actionFailure("glab: boom", false), "glab: boom");
  assert.equal(actionFailure("glab: boom", true), `glab: boom ${DRAFT_KEPT}`);
});

test("a missing or empty sha refuses like null", () => {
  for (const headSha of [undefined, ""]) {
    assert.deepEqual(actionCommand({ kind: "merge", detail: { ...gh, headSha }, body: "", method: "merge" }), { error: NO_SHA });
    assert.deepEqual(actionCommand({ kind: "approve", detail: { ...gl, headSha }, body: "" }), { error: NO_SHA });
  }
});

test("an unknown merge method refuses", () => {
  for (const method of ["admin", "close", undefined, "SQUASH"]) {
    assert.deepEqual(actionCommand({ kind: "merge", detail: gh, body: "", method }), { error: NO_METHOD });
  }
});

test("mergePrompt for GitHub without a method names no method", () => {
  assert.equal(mergePrompt(gh, null), "Merge #12 into main?");
});

test("pickMergeMethod handles odd replies", () => {
  const r = (o) => JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, ...o });
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: "squash" })), "squash");
  assert.equal(pickMergeMethod(r({ viewerDefaultMergeMethod: "FAST_FORWARD" })), "merge");
  assert.equal(pickMergeMethod("[]"), null);
  assert.equal(pickMergeMethod(JSON.stringify({ mergeCommitAllowed: "true", squashMergeAllowed: false, rebaseMergeAllowed: true })), "rebase");
});

test("afterAction after a failed request changes keeps the comment", () => {
  assert.deepEqual(afterAction("request_changes", false), { reread: true, clearComment: false });
});

test("leavePr keeps the typed text and a running action, and drops the rest", () => {
  const idle = { running: null, error: null, confirm: null, text: "", draftText: null, menu: null, methods: null, composing: null };
  assert.equal(leavePr(idle, ""), null);
  assert.equal(leavePr({ ...idle, error: "gh: old" }, ""), null);
  assert.equal(leavePr({ ...idle, confirm: { method: "merge" } }, ""), null);
  assert.deepEqual(leavePr({ ...idle, error: "gh: old" }, "half a comment"), { ...idle, text: "half a comment" });
  // A running action keeps its state, so its result still lands there.
  assert.deepEqual(leavePr({ ...idle, running: "comment", confirm: { method: "merge" } }, "sent text"), { ...idle, running: "comment", text: "sent text" });
  assert.deepEqual(leavePr({ ...idle, draftText: "Fix it" }, ""), { ...idle, draftText: "Fix it" });
  // An open menu and the merge methods it read are dropped; the text stays.
  assert.deepEqual(leavePr({ ...idle, menu: "merge", methods: { loading: true }, text: "x" }, "x"), { ...idle, text: "x" });
  // An open comment field stays open with its text.
  assert.deepEqual(leavePr({ ...idle, composing: "request_changes", menu: "more" }, ""), { ...idle, composing: "request_changes" });
});

test("ownPr is true for the signed-in author of a GitHub pull request", () => {
  assert.equal(ownPr(gh.pr, "octo-user"), true);
  assert.equal(ownPr(gh.pr, "Octo-User"), true);
  assert.equal(ownPr(gh.pr, "review-user"), false);
  assert.equal(ownPr(gh.pr, null), false);
  // GitLab projects decide whether authors may approve, so the buttons stay.
  assert.equal(ownPr(gl.pr, "octo-user"), false);
});

test("mergePrompt on GitLab names the picked method", () => {
  assert.equal(mergePrompt({ ...gl, squash: false }, "squash"), "Merge #12 into main with squash?");
  assert.equal(mergePrompt({ ...gl, squash: true }, "merge"), "Merge #12 into main?");
  assert.equal(mergePrompt({ ...gl, squash: true }, null), "Merge #12 into main with squash?");
});

test("GitLab Merge sends no squash flag, because glab sends nothing for --squash=false", () => {
  assert.deepEqual(actionCommand({ kind: "merge", detail: { ...gl, squash: false }, body: "", method: "merge" }).args.slice(-2), ["--sha", "abc123"]);
});

test("RUN_LIMIT covers the longest action: a locate and four CLI runs", () => {
  assert.ok(RUN_LIMIT > 5 * CLI_TIMEOUT);
});
