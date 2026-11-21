import test from "node:test";
import assert from "node:assert/strict";
import {
  ageText,
  emptyMessage,
  scopeRepos,
  scopeProjects,
  mergedCounts,
  mergedInScope,
  mergedText,
  mergedListRead,
  openBranches,
  followStatus,
  withFolders,
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
  scopeWhereTitle,
  shortRepo,
} from "../mods/argus-pull-requests/board.js";
import { changesRequested, keptLists, withNote } from "../mods/argus-pull-requests/board.js";
import { KEEP_RUNS_MS } from "../mods/argus-pull-requests/review.js";

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

test("scopeWhereTitle names only the In part", () => {
  const board = assembleBoard(input());
  assert.equal(scopeWhereTitle({ show: "mine", where: "all" }, board, null), "All repos");
  assert.equal(scopeWhereTitle({ show: "mine", where: "follow" }, board, project.key), "example-org/example-repo");
  assert.equal(scopeWhereTitle({ show: "all", where: "follow" }, board, null), "Follow space");
  assert.equal(scopeWhereTitle({ show: "mine", where: "project", key: "gitlab.example.com/example-group/example-project" }, board, null), "example-group/example-project");
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

test("followStatus: followed, still being read, or not a repo", () => {
  const board = { ...assembleBoard(input({})), folders: ["/home/test/code/example-repo", "/home/test/notes"] };
  assert.equal(followStatus(board, "/home/test/code/example-repo", project.key), "followed");
  // A folder the board has not read yet is still being read, not "not a repo".
  assert.equal(followStatus(board, "/home/test/new-space", null), "pending");
  assert.equal(followStatus(board, "/home/test/notes", null), "none");
  // Before the first read, nothing is known yet.
  assert.equal(followStatus({ ...board, readAt: 0 }, "/home/test/notes", null), "pending");
  // With no folder to follow, there is nothing to read.
  assert.equal(followStatus(board, null, null), "none");
});

test("withFolders adds folders the board has not listed, once", () => {
  const board = { ...assembleBoard(input({})), folders: ["/a"] };
  assert.deepEqual(withFolders(board, ["/a", "/b"]).folders, ["/a", "/b"]);
  assert.equal(withFolders(board, ["/a"]), board);
  assert.deepEqual(board.folders, ["/a"]);
});

test("emptyMessage: an empty list after failed reads does not claim there are no pull requests", () => {
  const board = assembleBoard(input({}));
  assert.equal(emptyMessage({ ...board, readAt: 0 }), "Loading…");
  assert.equal(emptyMessage(board), "No pull requests here");
  assert.equal(emptyMessage({ ...board, notes: ["gh: error connecting to api.github.com"] }), "No pull requests could be read. See the messages above.");
  // A note that a list was cut is no failed read.
  assert.equal(emptyMessage({ ...board, notes: ["Showing the first 100 pull requests of example-org/example-repo."] }), "No pull requests here");
});

test("scopeRepos: the provider and host of the repos a scope shows", () => {
  const lab = { ...project, key: "gitlab.example.com/example-group/example-project", provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project" };
  const board = assembleBoard(input({ projects: [project, lab] }));
  const all = { show: "all", where: "all" };
  assert.deepEqual(scopeRepos(board, all, null), [{ provider: "github", host: "github.com" }, { provider: "gitlab", host: "gitlab.example.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "project", key: lab.key }, null), [{ provider: "gitlab", host: "gitlab.example.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "mine", where: "follow" }, project.key), [{ provider: "github", host: "github.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "follow" }, null), []);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "project", key: "unknown" }, null), []);
});

test("emptyMessage: only a failed read in the scope counts", () => {
  const board = assembleBoard(input({}));
  const gh = [{ provider: "github", host: "github.com" }];
  const gl = [{ provider: "gitlab", host: "gitlab.example.com" }];
  const failedGl = { ...board, notes: ["glab (gitlab.example.com): 401 Unauthorized"] };
  assert.equal(emptyMessage(failedGl, gh), "No pull requests here");
  assert.equal(emptyMessage(failedGl, gl), "No pull requests could be read. See the messages above.");
  assert.equal(emptyMessage({ ...board, notes: ["glab (other.example.com): timeout"] }, gl), "No pull requests here");
  const failedGh = { ...board, notes: ["gh: error connecting to api.github.com"] };
  assert.equal(emptyMessage(failedGh, gl), "No pull requests here");
  assert.equal(emptyMessage(failedGh, gh), "No pull requests could be read. See the messages above.");
  assert.equal(emptyMessage({ ...board, notes: ["gh not found. Install GitHub CLI, or set the gh command in Settings."] }, gh), "No pull requests could be read. See the messages above.");
  assert.equal(emptyMessage({ ...board, notes: ["glab not found. Install GitLab CLI, or set the glab command in Settings."] }, gh), "No pull requests here");
  // No known repos in scope: any failure counts.
  assert.equal(emptyMessage(failedGl, []), "No pull requests could be read. See the messages above.");
  assert.equal(emptyMessage(failedGl), "No pull requests could be read. See the messages above.");
  // A cut list never counts.
  assert.equal(emptyMessage({ ...board, notes: ["Showing the first 100 pull requests of example-org/example-repo."] }, gh), "No pull requests here");
});

test("scopeProjects: the projects a scope shows", () => {
  const lab = { ...project, key: "gitlab.example.com/example-group/example-project", provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project" };
  const board = assembleBoard(input({ projects: [project, lab] }));
  assert.deepEqual(scopeProjects(board, { show: "all", where: "all" }, null).map((p) => p.key), [project.key, lab.key]);
  assert.deepEqual(scopeProjects(board, { show: "all", where: "project", key: lab.key }, null).map((p) => p.key), [lab.key]);
  assert.deepEqual(scopeProjects(board, { show: "mine", where: "follow" }, project.key).map((p) => p.key), [project.key]);
  assert.deepEqual(scopeProjects(board, { show: "all", where: "follow" }, null), []);
});

test("openBranches: the head branches of a repo's open pull requests", () => {
  const board = assembleBoard(input({}));
  const pr = (number, headRef, state, repo = project.repo) => ({ ...board.prs[0], provider: project.provider, host: project.host, repo, number, headRef, state });
  const withPrs = { ...board, prs: [pr(1, "feat/a", "open"), pr(2, "feat/b", "merged"), pr(3, "feat/c", "open", "example-org/other-repo")] };
  assert.deepEqual([...openBranches(withPrs, project)], ["feat/a"]);
});

test("merged counts: kept on the board, checked when loaded", () => {
  const board = assembleBoard(input({}));
  assert.deepEqual(board.merged, {});
  assert.deepEqual(assembleBoard({ ...input({}), merged: { k: 2 } }).merged, { k: 2 });
  assert.deepEqual(normalizeBoard({ ...board, merged: undefined }).merged, {});
  assert.deepEqual(normalizeBoard({ ...board, merged: { k: -1 } }).merged, {});
  assert.deepEqual(normalizeBoard({ ...board, merged: { k: 1.5 } }).merged, {});
  assert.deepEqual(normalizeBoard({ ...board, merged: "x" }).merged, {});
  assert.deepEqual(normalizeBoard({ ...board, merged: { k: 3 } }).merged, { k: 3 });
});

test("mergedCounts: a failed read keeps the old count, an unread project goes", () => {
  const read = [{ key: "a", count: null }, { key: "b", count: 0 }, { key: "c", count: 3 }, { key: "d", count: null }];
  const result = mergedCounts({ a: 2, b: 1, gone: 4 }, { a: 1000, b: 1000, gone: 1000 }, read, 2000);
  assert.deepEqual(result, { merged: { a: 2, b: 0, c: 3 }, mergedSeen: { a: 1000, b: 2000, c: 2000 } });
});

test("mergedCounts: a failed read keeps the old count only for 15 minutes", () => {
  const read = [{ key: "a", count: null }];
  const edge = 15 * 60 * 1000;
  assert.deepEqual(mergedCounts({ a: 2 }, { a: 0 }, read, edge - 1), { merged: { a: 2 }, mergedSeen: { a: 0 } });
  assert.deepEqual(mergedCounts({ a: 2 }, { a: 0 }, read, edge), { merged: {}, mergedSeen: {} });
});

test("mergedCounts: a count with no seen time is dropped on a failed read", () => {
  assert.deepEqual(mergedCounts({ a: 2 }, {}, [{ key: "a", count: null }], 5), { merged: {}, mergedSeen: {} });
});

test("normalizeBoard: mergedSeen holds non-negative finite numbers, else none", () => {
  const board = assembleBoard(input());
  assert.deepEqual(normalizeBoard({ ...board, mergedSeen: { k: 5 } }).mergedSeen, { k: 5 });
  assert.deepEqual(normalizeBoard({ ...board, mergedSeen: { k: -1 } }).mergedSeen, {});
  assert.deepEqual(normalizeBoard({ ...board, mergedSeen: { k: Infinity } }).mergedSeen, {});
  assert.deepEqual(normalizeBoard({ ...board, mergedSeen: "x" }).mergedSeen, {});
  assert.deepEqual(normalizeBoard({ ...board, mergedSeen: undefined }).mergedSeen, {});
});

test("mergedInScope sums the counts of the scope's projects", () => {
  const lab = { ...project, key: "gitlab.example.com/example-group/example-project", provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project" };
  const board = { ...assembleBoard(input({ projects: [project, lab] })), merged: { [project.key]: 2, [lab.key]: 1 } };
  assert.equal(mergedInScope(board, { show: "all", where: "all" }, null), 3);
  assert.equal(mergedInScope(board, { show: "all", where: "project", key: lab.key }, null), 1);
  assert.equal(mergedInScope(board, { show: "all", where: "follow" }, null), 0);
});

test("mergedText: nothing at 0, singular and plural", () => {
  assert.equal(mergedText(0), null);
  assert.equal(mergedText(1), "1 merged worktree");
  assert.equal(mergedText(3), "3 merged worktrees");
});

test("mergedListRead: a project whose worktree list failed keeps its count", () => {
  assert.deepEqual(mergedListRead([{ key: "a", count: 2 }], ["b"]), [{ key: "a", count: 2 }, { key: "b", count: null }]);
  assert.deepEqual(mergedCounts({ b: 4 }, { b: 10 }, mergedListRead([{ key: "a", count: 2 }], ["b"]), 20).merged, { a: 2, b: 4 });
});

test("groupOf: a reviewer's request for changes moves the pull request to Needs work", () => {
  assert.equal(groupOf(pr({ reviewDecision: "approved", changesRequestedBy: ["review-user"] })), "needsWork");
  assert.equal(groupOf(pr({ reviewDecision: null, changesRequestedBy: ["review-user"] })), "needsWork");
  assert.equal(groupOf(pr({ isDraft: true, changesRequestedBy: ["review-user"] })), "draft");
  assert.equal(groupOf(pr({ changesRequestedBy: [] })), "ready");
  // A board saved before the field existed has none.
  assert.equal(groupOf(pr()), "ready");
  assert.equal(changesRequested(pr({ reviewDecision: "changes_requested" })), true);
  assert.equal(changesRequested(pr({ changesRequestedBy: "review-user" })), false);
});

test("openBranches matches the repo without regard to case", () => {
  const board = assembleBoard(input({ projectPrs: { [project.key]: [pr({ repo: "Example-Org/Example-Repo", headRef: "feat/a" })] } }));
  assert.deepEqual([...openBranches(board, project)], ["feat/a"]);
  assert.deepEqual([...openBranches(board, { ...project, repo: "EXAMPLE-ORG/example-repo" })], ["feat/a"]);
  assert.deepEqual([...openBranches(board, { ...project, repo: "example-org/other-repo" })], []);
  assert.deepEqual([...openBranches(board, { ...project, provider: "gitlab" })], []);
});

test("keptLists keeps a failed repo's pull requests from the previous board for KEEP_RUNS_MS", () => {
  const other = pr({ repo: "example-org/search-only", number: 7 });
  const previous = assembleBoard(
    input({
      projectPrs: { [project.key]: [pr({ number: 1 }), pr({ number: 2 })] },
      needsReview: [other],
      listedAt: { [project.key]: 1000, "github.com/example-org/search-only": 1000 },
    }),
  );
  const kept = keptLists(previous, [project.key, "github.com/example-org/search-only"], 1000 + KEEP_RUNS_MS - 1);
  assert.deepEqual(kept.prs.map((item) => item.number).sort(), [1, 2, 7]);
  assert.deepEqual(Object.keys(kept.projectPrs), [project.key]);
  assert.deepEqual(kept.projectPrs[project.key].map((item) => item.number), [1, 2]);
  assert.deepEqual(kept.listedAt, { [project.key]: 1000, "github.com/example-org/search-only": 1000 });
  // Too old, or never listed: nothing stays.
  assert.deepEqual(keptLists(previous, [project.key], 1000 + KEEP_RUNS_MS), { prs: [], projectPrs: {}, listedAt: {} });
  assert.deepEqual(keptLists(assembleBoard(input()), [project.key], 1000), { prs: [], projectPrs: {}, listedAt: {} });
  // A repo that did not fail keeps nothing from the previous board.
  assert.deepEqual(keptLists(previous, [], 1000), { prs: [], projectPrs: {}, listedAt: {} });
});

test("normalizeBoard keeps good listedAt times and drops bad ones", () => {
  const board = assembleBoard(input({ listedAt: { [project.key]: 5 } }));
  assert.deepEqual(normalizeBoard(board).listedAt, { [project.key]: 5 });
  assert.deepEqual(normalizeBoard({ ...board, listedAt: { [project.key]: "5" } }).listedAt, {});
  assert.deepEqual(normalizeBoard({ ...board, listedAt: undefined }).listedAt, {});
});

test("withNote adds a note once", () => {
  const board = assembleBoard(input({ notes: ["gh: boom"] }));
  assert.equal(withNote(board, "gh: boom"), board);
  assert.deepEqual(withNote(board, "Could not read").notes, ["gh: boom", "Could not read"]);
});

test("prRereadDue reads again only for a changed row or a silent board", async () => {
  const { prRereadDue, prSignature } = await import("../mods/argus-pull-requests/board.js");
  const row = { updatedAt: "t1", state: "open", isDraft: false, reviewDecision: null, mergeable: "mergeable", checks: { passed: 1, failed: 0, running: 0, total: 1 } };
  const seen = prSignature(row);
  const base = { row, seen, boardReadAt: 2000, shownReadAt: 1000, now: 3000, intervalMs: 600_000 };
  assert.equal(prRereadDue(base), false);
  assert.equal(prRereadDue({ ...base, row: { ...row, updatedAt: "t2" } }), true);
  assert.equal(prRereadDue({ ...base, row: { ...row, checks: { ...row.checks, failed: 1 } } }), true);
  assert.equal(prRereadDue({ ...base, row: undefined }), true);
  assert.equal(prRereadDue({ ...base, row: undefined, boardReadAt: 500 }), false);
  assert.equal(prRereadDue({ ...base, seen: undefined }), true);
  assert.equal(prRereadDue({ ...base, now: 2000 + 600_001, shownReadAt: 1000 }), true);
  assert.equal(prRereadDue({ ...base, now: 2000 + 600_001, shownReadAt: 2500 }), false);
  assert.equal(prSignature(null), null);
});
