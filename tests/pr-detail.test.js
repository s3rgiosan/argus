import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationItems, ghMergeMethods, glMergeMethods, mergeAllowed, mergeMenuNote, positionIn, shownOrder, statusRows, summaryOf } from "../mods/argus-pull-requests/detail.js";
import { NO_METHOD } from "../mods/argus-pull-requests/actions.js";
import { assembleBoard } from "../mods/argus-pull-requests/board.js";

const basePr = {
  provider: "github", host: "github.com", repo: "example-org/example-repo", number: 12, title: "Example", url: "", author: "octo-user",
  headRef: "feature/example", baseRef: "main", isDraft: false, state: "open", reviewDecision: null,
  checks: { passed: 0, failed: 0, running: 0, total: 0 }, mergeable: "mergeable", updatedAt: "2026-01-01T00:00:00Z", localPath: null,
};
const check = (state, n) => Array.from({ length: n }, (_, i) => ({ name: `${state}-${i}`, state }));
const detail = (over = {}) => ({
  pr: { ...basePr, ...(over.pr ?? {}) }, body: "", headSha: "0123456789abcdef0123456789abcdef01234567", squash: false, checks: [], reviewers: [],
  merge: { state: "mergeable", reason: null }, conversation: [], threads: [], threadsError: null, threadsNote: null, squashLocked: false,
  ...over, pr: { ...basePr, ...(over.pr ?? {}) },
});
const entry = (author, at, extra = {}) => ({ author, body: "text", at, kind: "comment", state: null, id: null, ...extra });
const thread = (path, line, at, extra = {}) => ({ path, line, resolved: false, reviewId: null, comments: [{ author: "review-user", body: "note", at }], ...extra });

test("statusRows: checks", () => {
  assert.deepEqual(statusRows(detail({ checks: check("passed", 14) }), [], true).checks, { icon: "pass", title: "Checks passed", note: "14 passed" });
  assert.deepEqual(statusRows(detail({ checks: [...check("passed", 12), ...check("failed", 2)] }), [], true).checks, { icon: "fail", title: "Checks failed", note: "2 of 14 failed" });
  assert.deepEqual(statusRows(detail({ checks: [...check("passed", 11), ...check("running", 3)] }), [], true).checks, { icon: "run", title: "Checks running", note: "3 of 14 running" });
  assert.deepEqual(statusRows(detail(), [], true).checks, { icon: "none", title: "No checks", note: "" });
});

test("statusRows: review, merge and agent", () => {
  assert.equal(statusRows(detail(), [], true).review.title, "No review yet");
  assert.equal(statusRows(detail({ pr: { reviewDecision: "changes_requested" } }), [], true).review.title, "Changes requested");
  assert.equal(statusRows(detail({ pr: { reviewDecision: "approved" } }), [], true).review.title, "Approved");
  assert.equal(statusRows(detail({ pr: { reviewDecision: "review_required" } }), [], true).review.title, "Review required");
  assert.deepEqual(statusRows(detail({ merge: { state: "blocked", reason: null } }), [], true).merge, { icon: "fail", title: "Merge blocked", note: "Open into main" });
  assert.equal(statusRows(detail({ merge: { state: "conflicting", reason: "Has merge conflicts." } }), [], true).merge.note, "Has merge conflicts.");
  assert.equal(statusRows(detail(), [], false).agent.title, "No local checkout");
  assert.equal(statusRows(detail(), [], true).agent.title, "No agent yet");
  assert.equal(statusRows(detail(), [{ path: "/w", branch: "b" }], true).agent.title, "1 review agent worktree");
  assert.equal(statusRows(detail(), [{ path: "/w", branch: "b" }, { path: "/x", branch: "c" }], true).agent.title, "2 review agent worktrees");
});

test("summaryOf: requested changes, open threads, comments and people", () => {
  const d = detail({
    reviewers: [{ name: "a", state: "changes_requested" }, { name: "b", state: "approved" }],
    conversation: [entry("A", "1"), entry("B", "2", { kind: "review", state: "approved", body: "" }), entry("B", "3", { kind: "review", state: "commented", body: "x" })],
    threads: [
      { path: "a.js", line: 1, resolved: false, reviewId: null, comments: [{ author: "A", body: "y", at: "4" }, { author: "C", body: "z", at: "5" }] },
      { path: "b.js", line: 2, resolved: true, reviewId: null, comments: [] },
    ],
  });
  assert.deepEqual(summaryOf(d), { requested: 1, openThreads: 1, comments: 4, people: 3 });
});

test("summaryOf: only empty approvals count no comments", () => {
  const d = detail({ conversation: [entry("A", "1", { kind: "review", state: "approved", body: "" })] });
  assert.deepEqual(summaryOf(d), { requested: 0, openThreads: 0, comments: 0, people: 0 });
});

test("conversationItems: threads under their review, by path then line; an orphan thread by its time", () => {
  const review = entry("B", "2026-01-02", { kind: "review", state: "changes_requested", id: "PRR_example1", body: "" });
  const d = detail({
    conversation: [entry("A", "2026-01-01"), review, entry("C", "2026-01-04")],
    threads: [
      thread("b.js", 3, "2026-01-02", { reviewId: "PRR_example1" }),
      thread("a.js", 9, "2026-01-02", { reviewId: "PRR_example1" }),
      thread("c.js", 1, "2026-01-03", { reviewId: "PRR_missing" }),
    ],
  });
  const items = conversationItems(d, "oldest");
  assert.deepEqual(items.map((i) => [i.kind, i.at]), [["comment", "2026-01-01"], ["review", "2026-01-02"], ["thread", "2026-01-03"], ["comment", "2026-01-04"]]);
  assert.deepEqual(items[1].threads.map((t) => t.path), ["a.js", "b.js"]);
  assert.deepEqual(items[2].threads.map((t) => t.path), ["c.js"]);
  assert.deepEqual(conversationItems(d, "newest").map((i) => i.at), ["2026-01-04", "2026-01-03", "2026-01-02", "2026-01-01"]);
});

test("conversationItems: GitLab threads have no review and show by time", () => {
  const d = detail({ conversation: [entry("A", "2026-01-02")], threads: [thread("a.js", 2, "2026-01-01")] });
  assert.deepEqual(conversationItems(d, "oldest").map((i) => i.kind), ["thread", "comment"]);
});

test("positionIn", () => {
  assert.deepEqual(positionIn(["a", "b", "c"], "b"), { index: 2, total: 3, prev: "a", next: "c" });
  assert.deepEqual(positionIn(["a", "b", "c"], "a"), { index: 1, total: 3, prev: null, next: "b" });
  assert.deepEqual(positionIn(["a", "b", "c"], "c").next, null);
  assert.equal(positionIn(["a", "b", "c"], "z"), null);
});

test("shownOrder follows the board's groups: ready before draft", () => {
  const project = { key: "github.com/example-org/example-repo", provider: "github", host: "github.com", repo: "example-org/example-repo", localPath: "/c", folders: ["/c"] };
  const ready = { ...basePr, number: 1, reviewDecision: "approved", checks: { passed: 1, failed: 0, running: 0, total: 1 } };
  const draft = { ...basePr, number: 2, isDraft: true, updatedAt: "2026-06-01T00:00:00Z" };
  const board = assembleBoard({ projects: [project], folders: ["/c"], needsReview: [], mine: [], projectPrs: { [project.key]: [draft, ready] }, notes: [], readAt: 1 });
  assert.deepEqual(shownOrder(board, { show: "all", where: "all" }, null), ["github.com/example-org/example-repo#1", "github.com/example-org/example-repo#2"]);
});

test("ghMergeMethods: the allowed methods, the default marked", () => {
  const r = (o) => JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, viewerDefaultMergeMethod: "SQUASH", ...o });
  assert.deepEqual(ghMergeMethods(r({})), {
    methods: [
      { method: "merge", label: "Merge commit", isDefault: false },
      { method: "squash", label: "Squash and merge", isDefault: true },
      { method: "rebase", label: "Rebase and merge", isDefault: false },
    ],
  });
  assert.deepEqual(ghMergeMethods(r({ mergeCommitAllowed: false, squashMergeAllowed: false })).methods, [{ method: "rebase", label: "Rebase and merge", isDefault: true }]);
  assert.deepEqual(ghMergeMethods(r({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false })), { error: NO_METHOD });
  assert.ok("error" in ghMergeMethods("not json"));
});

test("glMergeMethods: an enforced squash setting offers one method", () => {
  assert.deepEqual(glMergeMethods(detail({ squashLocked: true, squash: true })).methods, [{ method: "squash", label: "Squash and merge", isDefault: true }]);
  assert.deepEqual(glMergeMethods(detail({ squashLocked: true, squash: false })).methods, [{ method: "merge", label: "Merge", isDefault: true }]);
  // A merge request set to squash cannot be merged without squash through glab, so only squash is offered.
  assert.deepEqual(glMergeMethods(detail({ squashLocked: false, squash: true })).methods, [{ method: "squash", label: "Squash and merge", isDefault: true }]);
  assert.deepEqual(glMergeMethods(detail({ squashLocked: false, squash: false })).methods, [
    { method: "merge", label: "Merge", isDefault: true },
    { method: "squash", label: "Squash and merge", isDefault: false },
  ]);
});

test("statusRows: with no decision, the review row follows the reviewers", () => {
  assert.equal(statusRows(detail({ reviewers: [{ name: "a", state: "approved" }] }), [], true).review.title, "Approved");
  assert.equal(statusRows(detail({ reviewers: [{ name: "a", state: "approved" }, { name: "b", state: "changes_requested" }] }), [], true).review.title, "Changes requested");
  assert.equal(statusRows(detail({ reviewers: [{ name: "a", state: "requested" }] }), [], true).review.title, "No review yet");
});

test("statusRows: a merged or closed pull request says so in the merge row", () => {
  assert.deepEqual(statusRows(detail({ pr: { state: "merged" }, merge: { state: "unknown", reason: null } }), [], true).merge, { icon: "pass", title: "Merged", note: "" });
  assert.deepEqual(statusRows(detail({ pr: { state: "closed" }, merge: { state: "unknown", reason: null } }), [], true).merge, { icon: "none", title: "Closed", note: "" });
});

test("conversationItems: an empty commented review with no threads is left out", () => {
  const reply = entry("B", "2026-01-02", { kind: "review", state: "commented", id: "PRR_reply", body: "" });
  const approval = entry("C", "2026-01-03", { kind: "review", state: "approved", id: "PRR_ok", body: "" });
  const withThread = entry("D", "2026-01-04", { kind: "review", state: "commented", id: "PRR_t", body: "" });
  const d = detail({ conversation: [reply, approval, withThread], threads: [thread("a.js", 1, "2026-01-04", { reviewId: "PRR_t" })] });
  assert.deepEqual(conversationItems(d, "oldest").map((i) => i.entry?.id), ["PRR_ok", "PRR_t"]);
});

test("statusRows: the forge's decision wins over the reviewers, and dismissed or commented reviews give no state", () => {
  assert.equal(statusRows(detail({ pr: { reviewDecision: "review_required" }, reviewers: [{ name: "a", state: "approved" }] }), [], true).review.title, "Review required");
  assert.equal(statusRows(detail({ reviewers: [{ name: "a", state: "dismissed" }, { name: "b", state: "commented" }, { name: "c", state: "pending" }] }), [], true).review.title, "No review yet");
});

test("conversationItems keeps empty commented reviews when the thread list was cut", () => {
  const reply = entry("B", "2026-01-02", { kind: "review", state: "commented", id: "PRR_reply", body: "" });
  assert.equal(conversationItems(detail({ conversation: [reply], threadsNote: "Showing the first 100 file comment threads." }), "oldest").length, 1);
});

test("mergeAllowed: a GitLab confirm is good only while its method is still offered", () => {
  const gl = (over) => detail({ pr: { provider: "gitlab", host: "gitlab.example.com" }, ...over });
  assert.equal(mergeAllowed(gl({ squash: false }), "merge"), true);
  assert.equal(mergeAllowed(gl({ squash: true }), "merge"), false);
  assert.equal(mergeAllowed(gl({ squash: true }), "squash"), true);
  assert.equal(mergeAllowed(gl({ squashLocked: true, squash: false }), "squash"), false);
  // GitHub methods come from the repo read, which the confirm already used.
  assert.equal(mergeAllowed(detail(), "rebase"), true);
});

test("mergeMenuNote explains a missing Merge on a GitLab merge request set to squash", () => {
  const gl = (over) => detail({ pr: { provider: "gitlab", host: "gitlab.example.com" }, ...over });
  assert.match(mergeMenuNote(gl({ squash: true, squashLocked: false })), /set to squash/);
  assert.equal(mergeMenuNote(gl({ squash: true, squashLocked: true })), null);
  assert.equal(mergeMenuNote(gl({ squash: false })), null);
  assert.equal(mergeMenuNote(detail({ squash: true })), null);
});
