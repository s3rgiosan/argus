import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleBoard,
  normalizeBoard,
  normalizeScope,
  issuesInScope,
  scopeItems,
  scopeTitle,
  mentionsNote,
  buildGroups,
  shownOrder,
  matchesFilter,
  rowDetail,
  assigneesText,
  emptyMessage,
  issuePaneTitle,
  issueSignature,
  keptLists,
  normalizeGrouping,
  GROUPINGS,
  worktreeTarget,
  worktreeState,
  NO_CLONE,
} from "../mods/argus-issues/board.js";
import { stateText, namesOf, openedLine, commentItems, sectionSummaries, hiddenText } from "../mods/argus-issues/detail.js";
import { displayName, KEEP_LIST_MS } from "../lib/forge-board.js";

function issue(overrides = {}) {
  return {
    provider: "github",
    host: "github.com",
    repo: "example-org/example-repo",
    number: 1,
    title: "Example title",
    url: "https://github.com/example-org/example-repo/issues/1",
    author: "octo-user",
    authorName: "",
    assignees: [],
    labels: [],
    state: "open",
    stateReason: null,
    confidential: false,
    comments: null,
    milestone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const github = { key: "github.com/example-org/example-repo", provider: "github", host: "github.com", repo: "example-org/example-repo", localPath: "/home/test/repo", folders: ["/home/test/repo"] };
const gitlab = { key: "gitlab.example.com/example-group/example-project", provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project", localPath: "/home/test/project", folders: ["/home/test/project"] };

const mine = issue({ number: 1, updatedAt: "2026-01-02T00:00:00Z" });
const other = issue({ number: 2, updatedAt: "2026-01-03T00:00:00Z" });
const elsewhere = issue({ repo: "example-org/another-repo", number: 3 });
const gl = issue({ provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project", number: 4 });

function board() {
  return assembleBoard({
    projects: [github, gitlab],
    folders: ["/home/test/repo", "/home/test/project"],
    assigned: [mine, elsewhere, gl],
    created: [other],
    mentions: [mine],
    projectIssues: { [github.key]: [mine, other], [gitlab.key]: [gl] },
    notes: [],
    readAt: 5,
  });
}

test("assembleBoard keeps one copy of each issue and the keys of each list", () => {
  const b = board();
  assert.equal(b.issues.length, 4);
  assert.deepEqual(b.scopes.assigned, ["github.com/example-org/example-repo#1", "github.com/example-org/another-repo#3", "gitlab.example.com/example-group/example-project#4"]);
  assert.deepEqual(b.scopes.projects[github.key], ["github.com/example-org/example-repo#1", "github.com/example-org/example-repo#2"]);
});

test("normalizeBoard keeps a valid board and drops anything else", () => {
  const b = board();
  assert.deepEqual(normalizeBoard(b), b);
  assert.equal(normalizeBoard({ ...b, readAt: "x" }).readAt, 0);
  assert.deepEqual(normalizeBoard(null).issues, []);
});

test("normalizeBoard keeps good list times only", () => {
  const b = board();
  assert.deepEqual(normalizeBoard({ ...b, listedAt: { [github.key]: 10 } }).listedAt, { [github.key]: 10 });
  assert.deepEqual(normalizeBoard({ ...b, listedAt: { [github.key]: -1 } }).listedAt, {});
  assert.deepEqual(normalizeBoard({ ...b, listedAt: undefined }).listedAt, {});
});

test("keptLists keeps the issues of a failed project list for a while after its last good list", () => {
  const previous = assembleBoard({
    projects: [github, gitlab],
    folders: [],
    assigned: [],
    created: [],
    mentions: [],
    projectIssues: { [github.key]: [mine, other], [gitlab.key]: [gl] },
    notes: [],
    readAt: 5,
    listedAt: { [github.key]: 1_000, [gitlab.key]: 1_000 },
  });
  const kept = keptLists(previous, [github.key], 1_000 + KEEP_LIST_MS - 1);
  assert.deepEqual(kept.projectIssues[github.key].map((i) => i.number), [1, 2]);
  assert.deepEqual(kept.listedAt, { [github.key]: 1_000 });
  assert.equal(kept.projectIssues[gitlab.key], undefined);
  assert.deepEqual(keptLists(previous, [github.key], 1_000 + KEEP_LIST_MS), { issues: [], projectIssues: {}, listedAt: {} });
});

test("issueSignature changes with the row parts the pane shows", () => {
  const base = issue({ labels: ["bug"], assignees: [{ login: "octo-user", name: "" }], comments: 1 });
  assert.equal(issueSignature(null), null);
  assert.equal(issueSignature(base), issueSignature({ ...base }));
  for (const change of [{ updatedAt: "2026-01-05T00:00:00Z" }, { title: "Other title" }, { comments: 2 }, { labels: [] }, { assignees: [] }, { state: "closed" }]) {
    assert.notEqual(issueSignature({ ...base, ...change }), issueSignature(base));
  }
});

test("normalizeScope defaults to Assigned to me in All repos", () => {
  assert.deepEqual(normalizeScope(undefined), { show: "assigned", where: "all" });
  assert.deepEqual(normalizeScope({ show: "mentions", where: "follow" }), { show: "mentions", where: "follow" });
  assert.deepEqual(normalizeScope({ show: "x", where: "project", key: "" }), { show: "assigned", where: "all" });
  assert.deepEqual(normalizeScope({ show: "all", where: "project", key: github.key }), { show: "all", where: "project", key: github.key });
});

test("issuesInScope combines Show and In", () => {
  const b = board();
  const numbers = (scope, followed = null) => issuesInScope(b, scope, followed).map((i) => i.number);
  assert.deepEqual(numbers({ show: "assigned", where: "all" }), [1, 3, 4]);
  assert.deepEqual(numbers({ show: "assigned", where: "project", key: github.key }), [1]);
  assert.deepEqual(numbers({ show: "all", where: "all" }), [1, 3, 4, 2]);
  assert.deepEqual(numbers({ show: "all", where: "project", key: github.key }), [1, 2]);
  assert.deepEqual(numbers({ show: "created", where: "follow" }, github.key), [2]);
  assert.deepEqual(numbers({ show: "created", where: "follow" }, null), []);
});

test("scopeItems counts each row with the other choice kept, and keeps a picked project that left", () => {
  const b = board();
  const items = scopeItems(b, github.key, { show: "assigned", where: "project", key: "github.com/example-org/gone" });
  assert.deepEqual(items.show.map((i) => [i.key, i.count, i.current]), [
    ["assigned", 0, true],
    ["created", 0, false],
    ["mentions", 0, false],
    ["all", 0, false],
  ]);
  assert.deepEqual(items.where.map((i) => [i.key, i.count]), [
    ["follow", 1],
    ["all", 3],
  ]);
  assert.deepEqual(items.projects.map((i) => [i.label, i.current]), [
    ["example-group/example-project", false],
    ["example-org/example-repo", false],
    ["example-org/gone", true],
  ]);
});

test("scopeTitle names the Show choice and the repo", () => {
  const b = board();
  assert.equal(scopeTitle({ show: "assigned", where: "all" }, b, null), "Assigned to me");
  assert.equal(scopeTitle({ show: "mentions", where: "follow" }, b, github.key), "Mentions me · example-org/example-repo");
  assert.equal(scopeTitle({ show: "all", where: "follow" }, b, null), "All open · Follow space");
  assert.equal(scopeTitle({ show: "created", where: "project", key: "github.com/example-org/gone" }, b, null), "Created by me · example-org/gone");
});

test("mentionsNote speaks only for Mentions me with a GitLab project in scope", () => {
  const b = board();
  assert.match(mentionsNote(b, { show: "mentions", where: "all" }, null) ?? "", /GitLab has no search for mentions/);
  assert.equal(mentionsNote(b, { show: "mentions", where: "project", key: github.key }, null), null);
  assert.equal(mentionsNote(b, { show: "assigned", where: "all" }, null), null);
});

test("buildGroups makes one group per repo, A to Z, newest first inside", () => {
  const groups = buildGroups([mine, elsewhere, other, gl]);
  assert.deepEqual(groups.map((g) => [g.title, g.issues.map((i) => i.number)]), [
    ["example-group/example-project", [4]],
    ["example-org/another-repo", [3]],
    ["example-org/example-repo", [2, 1]],
  ]);
  assert.deepEqual(shownOrder(board(), { show: "all", where: "project", key: github.key }, null), ["github.com/example-org/example-repo#2", "github.com/example-org/example-repo#1"]);
});

test("normalizeGrouping defaults to Repo", () => {
  assert.deepEqual(GROUPINGS.map(([id]) => id), ["repo", "assignee", "label"]);
  assert.equal(normalizeGrouping(undefined), "repo");
  assert.equal(normalizeGrouping("label"), "label");
  assert.equal(normalizeGrouping("__proto__"), "repo");
});

test("buildGroups by assignee shows an issue under each assignee, and No assignee last", () => {
  const both = issue({ number: 5, updatedAt: "2026-01-05T00:00:00Z", assignees: [{ login: "octo-user", name: "" }, { login: "other-user", name: "" }] });
  const one = issue({ number: 6, updatedAt: "2026-01-06T00:00:00Z", assignees: [{ login: "other-user", name: "" }] });
  const none = issue({ number: 7 });
  const sameLogin = issue({ provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project", number: 8, assignees: [{ login: "octo-user", name: "" }] });
  const groups = buildGroups([none, both, one, sameLogin], "assignee");
  assert.deepEqual(groups.map((g) => [g.key, g.title, g.issues.map((i) => i.number)]), [
    ["github.com/octo-user", "octo-user", [5]],
    ["gitlab.example.com/octo-user", "octo-user", [8]],
    ["github.com/other-user", "other-user", [6, 5]],
    ["", "No assignee", [7]],
  ]);
});

test("buildGroups by label shows an issue under each label, one group per name in any case, and No label last", () => {
  const groups = buildGroups([issue({ number: 1, labels: ["bug", "docs"] }), issue({ repo: "example-org/another-repo", number: 2, labels: ["Bug"] }), issue({ number: 3 })], "label");
  assert.deepEqual(groups.map((g) => [g.title, g.issues.map((i) => i.number)]), [
    ["Bug", [2, 1]],
    ["docs", [1]],
    ["No label", [3]],
  ]);
});

test("shownOrder counts an issue in several groups once", () => {
  const b = assembleBoard({
    projects: [github],
    folders: [],
    assigned: [],
    created: [],
    mentions: [],
    projectIssues: { [github.key]: [issue({ number: 1, updatedAt: "2026-01-02T00:00:00Z", labels: ["a", "b"] }), issue({ number: 2, labels: ["b"] })] },
    notes: [],
    readAt: 5,
  });
  assert.deepEqual(shownOrder(b, { show: "all", where: "all" }, null, "label"), ["github.com/example-org/example-repo#1", "github.com/example-org/example-repo#2"]);
});

test("worktreeTarget takes the board project of the issue's repo when it has a local checkout", () => {
  assert.deepEqual(worktreeTarget([gitlab, github], issue()), { project: github, reason: null });
  assert.deepEqual(worktreeTarget([github], issue({ repo: "Example-Org/Example-Repo" })), { project: github, reason: null });
  assert.deepEqual(worktreeTarget([github], elsewhere), { project: null, reason: NO_CLONE });
  assert.deepEqual(worktreeTarget([{ ...github, localPath: "" }], issue()), { project: null, reason: NO_CLONE });
  assert.deepEqual(worktreeTarget([], issue()), { project: null, reason: NO_CLONE });
});

test("worktreeState shows the reason, the running start and the last outcome of the issue", () => {
  const ready = { project: github, reason: null };
  assert.deepEqual(worktreeState(ready, undefined, false), { reason: null, running: false, busy: false, error: null, note: null });
  assert.deepEqual(worktreeState(ready, { running: true, error: null, note: null }, false), { reason: null, running: true, busy: true, error: null, note: null });
  assert.deepEqual(worktreeState(ready, undefined, true), { reason: null, running: false, busy: true, error: null, note: null });
  assert.deepEqual(worktreeState(ready, { running: false, error: "git: Example error", note: null }, false), { reason: null, running: false, busy: false, error: "git: Example error", note: null });
  assert.deepEqual(worktreeState({ project: null, reason: NO_CLONE }, { running: false, error: null, note: "Example note" }, false), { reason: NO_CLONE, running: false, busy: false, error: null, note: "Example note" });
});

test("matchesFilter looks at title, number, author, labels and assignees", () => {
  const i = issue({ number: 42, title: "Fix the parser", labels: ["bug"], assignees: [{ login: "other-user", name: "Other Person" }] });
  assert.ok(matchesFilter(i, ""));
  assert.ok(matchesFilter(i, "PARSER"));
  assert.ok(matchesFilter(i, "#4"));
  assert.ok(matchesFilter(i, "42"));
  assert.ok(matchesFilter(i, "octo"));
  assert.ok(matchesFilter(i, "bug"));
  assert.ok(matchesFilter(i, "other-user"));
  assert.ok(matchesFilter(i, "person"));
  assert.ok(!matchesFilter(i, "#5"));
  assert.ok(!matchesFilter(i, "nothing"));
});

test("row text shows the author, the labels and the assignees", () => {
  assert.equal(rowDetail(issue({ labels: ["bug", "docs"] })), "by octo-user · bug, docs");
  assert.equal(rowDetail(issue({ author: "" })), "");
  assert.equal(assigneesText(issue()), "");
  assert.equal(assigneesText(issue({ assignees: [{ login: "a", name: "" }] })), "a");
  assert.equal(assigneesText(issue({ assignees: [{ login: "a", name: "" }, { login: "b", name: "" }, { login: "c", name: "" }] })), "a +2");
});

test("emptyMessage points to failed reads of the scope only", () => {
  const b = board();
  assert.equal(emptyMessage({ ...b, readAt: 0 }), "Loading…");
  assert.equal(emptyMessage(b, [{ provider: "github", host: "github.com" }]), "No open issues here");
  const failed = { ...b, notes: ["glab (gitlab.example.com): Example error", "Showing the first 100 issues of a/b."] };
  assert.equal(emptyMessage(failed, [{ provider: "github", host: "github.com" }]), "No open issues here");
  assert.equal(emptyMessage(failed, [{ provider: "gitlab", host: "gitlab.example.com" }]), "No issues could be read. See the messages above.");
  assert.equal(emptyMessage(failed, []), "No issues could be read. See the messages above.");
});

test("emptyMessage shows the normal text when another read of the scope worked", () => {
  const b = { ...board(), notes: ["gh: Example error"], worked: ["gh"] };
  assert.equal(emptyMessage(b, [{ provider: "github", host: "github.com" }], ["gh"]), "No open issues here");
  assert.equal(emptyMessage(b, [{ provider: "github", host: "github.com" }], [github.key]), "No issues could be read. See the messages above.");
});

test("assembleBoard and normalizeBoard keep the reads that worked", () => {
  const b = assembleBoard({ projects: [], folders: [], assigned: [], created: [], mentions: [], projectIssues: {}, notes: [], readAt: 5, worked: ["gh", github.key] });
  assert.deepEqual(b.worked, ["gh", github.key]);
  assert.deepEqual(normalizeBoard(b).worked, ["gh", github.key]);
  assert.deepEqual(normalizeBoard({ ...b, worked: [1] }).worked, []);
  assert.deepEqual(normalizeBoard({ ...b, worked: undefined }).worked, []);
  assert.deepEqual(board().worked, []);
});

test("issuePaneTitle shows the number and title", () => {
  assert.equal(issuePaneTitle(null), "Issues");
  assert.equal(issuePaneTitle({ number: 3, title: "" }), "#3");
  assert.equal(issuePaneTitle({ number: 3, title: "Example title" }), "#3 · Example title");
});

function detail(overrides = {}) {
  return {
    issue: issue({ authorName: "Octo User", assignees: [{ login: "other-user", name: "Other Person" }] }),
    body: "",
    closedAt: null,
    comments: [
      { author: "third-user", name: "Third Person", body: "A", at: "2026-01-02T00:00:00Z", hidden: null, internal: false },
      { author: "other-user", name: "", body: "B", at: "2026-01-03T00:00:00Z", hidden: null, internal: false },
    ],
    commentsNote: null,
    ...overrides,
  };
}

test("stateText names the closed reason", () => {
  assert.deepEqual(stateText(issue()), { text: "Open", open: true });
  assert.deepEqual(stateText(issue({ state: "closed", stateReason: "not_planned" })), { text: "Closed as not planned", open: false });
  assert.deepEqual(stateText(issue({ state: "closed", stateReason: "constructor" })), { text: "Closed", open: false });
});

test("namesOf gives the forge's names to displayName", () => {
  const names = namesOf(detail());
  assert.deepEqual(names, { "octo-user": "Octo User", "other-user": "Other Person", "third-user": "Third Person" });
  assert.equal(displayName("other-user", names), "Other Person");
  assert.equal(displayName("app/example-bot", names), "example-bot");
  assert.equal(displayName("__proto__", namesOf(detail({ comments: [{ author: "__proto__", name: "Odd", body: "x", at: "", hidden: null, internal: false }] }))), "Odd");
});

test("openedLine says who opened it and when it changed", () => {
  const now = Date.parse("2026-01-04T00:00:00Z");
  const i = issue({ createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-03T00:00:00Z" });
  assert.equal(openedLine(i, { "octo-user": "Octo User" }, now), "Octo User opened 3d ago · updated 1d ago");
  assert.equal(openedLine({ ...i, createdAt: "", updatedAt: "" }, {}, now), "opened by octo-user");
});

test("commentItems follows the Conversation setting", () => {
  assert.deepEqual(commentItems(detail(), "oldest").map((c) => c.body), ["A", "B"]);
  assert.deepEqual(commentItems(detail(), "newest").map((c) => c.body), ["B", "A"]);
});

test("sectionSummaries counts the comments", () => {
  assert.deepEqual(sectionSummaries(detail()), { description: "None", comments: "2 comments" });
  assert.equal(sectionSummaries(detail({ comments: [detail().comments[0]], body: "x" })).comments, "1 comment");
});

test("hiddenText names the reason when there is one", () => {
  assert.equal(hiddenText(""), "Hidden by GitHub.");
  assert.equal(hiddenText("spam"), "Hidden by GitHub as spam.");
});
