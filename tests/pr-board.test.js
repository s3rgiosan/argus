import test from "node:test";
import assert from "node:assert/strict";
import {
  ageText,
  prPaneTitle,
  fetchedAtOf,
  keepStale,
  markStale,
  assembleBoard,
  buildGroups,
  checksText,
  groupOf,
  matchesFilter,
  normalizeBoard,
  normalizeScope,
  pickPairs,
  withoutFailedRepos,
  prsInScope,
  reviewLabel,
  scopeItems,
  scopeTitle,
  shortRepo,
} from "../mods/argus-pull-requests/board.js";

const checks = (passed, failed, running, total) => ({ passed, failed, running, total });

function pr(overrides = {}) {
  return {
    provider: "github",
    host: "github.com",
    repo: "example-org/example-repo",
    number: 101,
    title: "Example title",
    url: "https://github.com/example-org/example-repo/pull/101",
    author: "octo-user",
    headRef: "feature/one",
    baseRef: "main",
    isDraft: false,
    state: "open",
    reviewDecision: "approved",
    checks: checks(3, 0, 0, 3),
    mergeable: "mergeable",
    updatedAt: "2026-01-02T00:00:00Z",
    localPath: null,
    ...overrides,
  };
}

const project = {
  key: "github.com/example-org/example-repo",
  provider: "github",
  host: "github.com",
  repo: "example-org/example-repo",
  localPath: "/work/example-repo",
  folders: ["example-repo"],
};

const input = (overrides = {}) => ({
  projects: [project],
  folders: ["example-repo"],
  needsReview: [],
  mine: [],
  projectPrs: {},
  notes: [],
  readAt: 5,
  ...overrides,
});

test("groupOf: first match wins", () => {
  assert.equal(groupOf(pr({ isDraft: true, checks: checks(0, 1, 0, 1) })), "draft");
  assert.equal(groupOf(pr({ checks: checks(0, 1, 0, 1) })), "needsWork");
  assert.equal(groupOf(pr({ reviewDecision: "changes_requested" })), "needsWork");
  assert.equal(groupOf(pr({ mergeable: "conflicting" })), "needsWork");
  assert.equal(groupOf(pr()), "ready");
  assert.equal(groupOf(pr({ reviewDecision: null, checks: checks(0, 0, 0, 0) })), "ready");
  assert.equal(groupOf(pr({ checks: checks(2, 0, 1, 3) })), "waiting");
});

test("groupOf unknown", () => {
  assert.equal(groupOf(pr({ mergeable: "unknown" })), "waiting");
  assert.equal(groupOf(pr({ reviewDecision: "review_required", mergeable: "blocked" })), "waiting");
});

test("buildGroups orders groups and rows", () => {
  const groups = buildGroups([
    pr({ number: 1, isDraft: true }),
    pr({ number: 2, reviewDecision: "review_required" }),
    pr({ number: 3, checks: checks(0, 1, 0, 1) }),
    pr({ number: 4 }),
    pr({ number: 5, updatedAt: "2026-01-02T00:00:00Z" }),
    pr({ number: 6, updatedAt: "2026-01-03T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.id, g.title]),
    [
      ["ready", "Ready to merge"],
      ["needsWork", "Needs work"],
      ["waiting", "Waiting on review"],
      ["draft", "Draft"],
    ],
  );
  assert.deepEqual(groups[0].prs.map((p) => p.number), [6, 5, 4]);
  assert.deepEqual(buildGroups([pr()]).map((g) => g.id), ["ready"]);
});

test("assembleBoard dedupes", () => {
  const board = assembleBoard(input({ needsReview: [pr()], projectPrs: { [project.key]: [pr()] } }));
  assert.equal(board.prs.length, 1);
  const key = "github.com/example-org/example-repo#101";
  assert.deepEqual(board.scopes.needsReview, [key]);
  assert.deepEqual(board.scopes.projects[project.key], [key]);
  assert.equal(board.prs[0].localPath, "/work/example-repo");
});

test("assembleBoard keeps partial data", () => {
  const other = pr({ repo: "example-org/other-repo", number: 7 });
  const board = assembleBoard(input({ mine: [other], notes: ["gh failed"] }));
  assert.deepEqual(board.notes, ["gh failed"]);
  assert.deepEqual(board.scopes.projects[project.key], []);
  assert.equal(board.prs.length, 1);
  assert.equal(board.prs[0].localPath, null);
  assert.equal(board.readAt, 5);
});

test("normalizeBoard", () => {
  const board = assembleBoard(input({ mine: [pr()] }));
  assert.deepEqual(normalizeBoard(board), board);
  for (const bad of [null, 3, "x", [], {}, { ...board, readAt: "1" }, { ...board, prs: {} }]) {
    const empty = normalizeBoard(bad);
    assert.equal(empty.readAt, 0);
    assert.deepEqual(empty.prs, []);
    assert.deepEqual(empty.scopes, { needsReview: [], mine: [], projects: {} });
  }
});

test("pickPairs", () => {
  const { found, missing } = pickPairs(
    [pr()],
    [
      { host: "github.com", repo: "Example-Org/Example-Repo", number: 101 },
      { host: "github.com", repo: "example-org/other-repo", number: 7 },
    ],
  );
  assert.equal(found.length, 1);
  assert.deepEqual(missing, [{ host: "github.com", repo: "example-org/other-repo", number: 7 }]);
});

test("normalizeScope", () => {
  const def = { show: "needsReview", where: "all" };
  assert.deepEqual(normalizeScope(null), def);
  assert.deepEqual(normalizeScope({ show: "mine", where: "follow" }), { show: "mine", where: "follow" });
  assert.deepEqual(normalizeScope({ show: "all", where: "project", key: "k" }), { show: "all", where: "project", key: "k" });
  assert.deepEqual(normalizeScope({ show: "nope", where: "nope" }), def);
  assert.deepEqual(normalizeScope({ show: "mine", where: "project", key: "" }), { show: "mine", where: "all" });
  // Scopes saved before Show and In were separate.
  assert.deepEqual(normalizeScope({ kind: "needsReview" }), def);
  assert.deepEqual(normalizeScope({ kind: "mine" }), { show: "mine", where: "all" });
  assert.deepEqual(normalizeScope({ kind: "follow" }), { show: "all", where: "follow" });
  assert.deepEqual(normalizeScope({ kind: "project", key: "k" }), { show: "all", where: "project", key: "k" });
  assert.deepEqual(normalizeScope({ kind: "project", key: "" }), def);
});

test("prsInScope combines Show and In", () => {
  const other = pr({ repo: "example-org/other-repo", number: 7 });
  const board = assembleBoard(
    input({ needsReview: [pr(), other], mine: [pr({ number: 2 })], projectPrs: { [project.key]: [pr(), pr({ number: 2 }), pr({ number: 3 })] } }),
  );
  const numbers = (scope, followed = null) => prsInScope(board, scope, followed).map((p) => p.number).sort((a, b) => a - b);
  assert.deepEqual(numbers({ show: "needsReview", where: "all" }), [7, 101]);
  assert.deepEqual(numbers({ show: "needsReview", where: "follow" }, project.key), [101]);
  assert.deepEqual(numbers({ show: "needsReview", where: "follow" }, null), []);
  assert.deepEqual(numbers({ show: "mine", where: "project", key: project.key }), [2]);
  assert.deepEqual(numbers({ show: "all", where: "follow" }, project.key), [2, 3, 101]);
  assert.deepEqual(numbers({ show: "all", where: "all" }), [2, 3, 7, 101]);
  assert.deepEqual(numbers({ show: "all", where: "project", key: "nope" }), []);
  assert.deepEqual(numbers({ show: "needsReview", where: "project", key: "github.com/example-org/other-repo" }), [7]);
});

test("scopeItems counts each choice with the other one kept", () => {
  const second = { ...project, key: "github.com/example-org/another", repo: "example-org/another" };
  const board = assembleBoard(
    input({ projects: [project, second], needsReview: [pr()], mine: [pr({ number: 2 })], projectPrs: { [project.key]: [pr(), pr({ number: 2 })] } }),
  );
  const items = scopeItems(board, project.key, { show: "needsReview", where: "follow" });
  assert.deepEqual(items.show.map((i) => [i.label, i.count, i.current]), [
    ["Needs my review", 1, true],
    ["Mine", 1, false],
    ["All open", 2, false],
  ]);
  assert.deepEqual(items.where.map((i) => [i.label, i.count, i.current]), [
    ["Follow space", 1, true],
    ["All repos", 1, false],
  ]);
  assert.deepEqual(items.projects.map((i) => [i.label, i.count, i.current]), [
    ["example-org/another", 0, false],
    ["example-org/example-repo", 1, false],
  ]);
  // Picking a row changes its own choice and keeps the other.
  assert.deepEqual(items.show[1].scope, { show: "mine", where: "follow" });
  assert.deepEqual(items.projects[1].scope, { show: "needsReview", where: "project", key: project.key });
  assert.equal(scopeItems(board, null, { show: "all", where: "follow" }).where[0].count, 0);
});

test("scopeTitle names Show, and In when it is not all repos", () => {
  const board = assembleBoard(input());
  assert.equal(scopeTitle({ show: "needsReview", where: "all" }, board, null), "Needs my review");
  assert.equal(scopeTitle({ show: "mine", where: "all" }, board, null), "Mine");
  assert.equal(scopeTitle({ show: "needsReview", where: "follow" }, board, project.key), "Needs my review · example-org/example-repo");
  assert.equal(scopeTitle({ show: "all", where: "follow" }, board, null), "All open · Follow space");
  assert.equal(scopeTitle({ show: "all", where: "project", key: "gitlab.example.com/example-group/example-project" }, board, null), "All open · example-group/example-project");
  assert.equal(scopeTitle({ show: "mine", where: "project", key: project.key }, board, null), "Mine · example-org/example-repo");
});

test("matchesFilter", () => {
  const p = pr();
  assert.equal(matchesFilter(p, ""), true);
  assert.equal(matchesFilter(p, "  "), true);
  assert.equal(matchesFilter(p, "EXAMPLE"), true);
  assert.equal(matchesFilter(p, "#10"), true);
  assert.equal(matchesFilter(p, "10"), true);
  assert.equal(matchesFilter(p, "octo"), true);
  assert.equal(matchesFilter(p, "feature/one"), true);
  assert.equal(matchesFilter(p, "zzz"), false);
  assert.equal(matchesFilter(p, "#"), false);
});

test("ageText", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(ageText(ago(30), now), "now");
  assert.equal(ageText(ago(300), now), "5m");
  assert.equal(ageText(ago(3 * 3600), now), "3h");
  assert.equal(ageText(ago(2 * 86400), now), "2d");
  assert.equal(ageText(ago(45 * 86400), now), "1mo");
  assert.equal(ageText(ago(400 * 86400), now), "1y");
  assert.equal(ageText("bad", now), "");
});

test("checksText", () => {
  assert.equal(checksText(checks(0, 0, 0, 0)), "");
  assert.equal(checksText(checks(0, 1, 1, 2)), "✗ 1/2");
  assert.equal(checksText(checks(0, 0, 1, 1)), "● running");
  assert.equal(checksText(checks(3, 0, 0, 3)), "✓ 3/3");
});

test("reviewLabel and shortRepo", () => {
  assert.equal(reviewLabel("approved"), "approved");
  assert.equal(reviewLabel("changes_requested"), "changes requested");
  assert.equal(reviewLabel("review_required"), "review required");
  assert.equal(reviewLabel(null), null);
  assert.equal(shortRepo("example-group/example-sub/example-project"), "example-project");
});

test("withoutFailedRepos drops the pairs of repos whose list failed", () => {
  const pairs = [
    { host: "github.com", repo: "Example-Org/Example-Repo", number: 1 },
    { host: "github.com", repo: "example-org/other", number: 2 },
    { host: "github.com", repo: "example-org/example-repo", number: 3 },
  ];
  assert.deepEqual(withoutFailedRepos(pairs, new Set(["github.com/example-org/example-repo"])).map((pair) => pair.number), [2]);
  assert.deepEqual(withoutFailedRepos(pairs, new Set()).map((pair) => pair.number), [1, 2, 3]);
  assert.deepEqual(withoutFailedRepos([], new Set(["x"])), []);
});

test("markStale makes the board due for a read", () => {
  const board = { ...normalizeBoard(null), readAt: 1000 };
  assert.equal(fetchedAtOf(board), 1000);
  assert.equal(fetchedAtOf(markStale(board, 2000)), 0);
  assert.equal(fetchedAtOf({ ...board, staleAt: 500 }), 1000);
  assert.equal(fetchedAtOf({ ...board, staleAt: "x" }), 1000);
});

test("keepStale carries a mark made while a read ran", () => {
  const next = { ...normalizeBoard(null), readAt: 1000 };
  // Marked after the read started: the new board is still due.
  assert.equal(fetchedAtOf(keepStale(next, markStale(next, 1500), 1000)), 0);
  // Marked before the read started: this read covers it.
  assert.deepEqual(keepStale(next, markStale(next, 900), 1000), next);
  assert.deepEqual(keepStale(next, normalizeBoard(null), 1000), next);
});

test("scopeItems keeps a picked project that is no longer on the board, ticked", () => {
  const board = assembleBoard(input({ projects: [project] }));
  const items = scopeItems(board, null, { show: "all", where: "project", key: "github.com/example-org/gone" });
  assert.deepEqual(items.projects.map((i) => [i.label, i.count, i.current]), [
    ["example-org/example-repo", 0, false],
    ["example-org/gone", 0, true],
  ]);
});

test("prPaneTitle: the number and title of the shown pull request, else the panel name", () => {
  assert.equal(prPaneTitle({ number: 12, title: "Example title" }), "#12 · Example title");
  assert.equal(prPaneTitle(null), "Pull requests");
});

test("prPaneTitle: an empty title shows the number alone", () => {
  assert.equal(prPaneTitle({ number: 12, title: "" }), "#12");
});

test("assembleBoard and normalizeBoard keep the review runs", () => {
  const reviews = { "github.com/example-org/example-repo#1": [{ path: "/w", branch: "argus/review-1-a" }] };
  const board = assembleBoard(input({ reviews }));
  assert.deepEqual(board.reviews, reviews);
  assert.deepEqual(normalizeBoard(board).reviews, reviews);
  const { reviews: _drop, ...old } = board;
  assert.deepEqual(normalizeBoard(old).reviews, {});
  assert.deepEqual(normalizeBoard({ ...board, reviews: 5 }).reviews, {});
  assert.deepEqual(assembleBoard(input()).reviews, {});
});

test("normalizeBoard drops review runs with a malformed run", () => {
  const board = assembleBoard(input({ reviews: { "x#1": [{ path: 1, branch: "argus/review-1-a" }] } }));
  assert.deepEqual(normalizeBoard(board).reviews, {});
});
