import test from "node:test";
import assert from "node:assert/strict";
import {
  ageText,
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
  assert.deepEqual(normalizeScope(null), { kind: "needsReview" });
  assert.deepEqual(normalizeScope({ kind: "project", key: "" }), { kind: "needsReview" });
  assert.deepEqual(normalizeScope({ kind: "follow" }), { kind: "follow" });
  assert.deepEqual(normalizeScope({ kind: "mine" }), { kind: "mine" });
  assert.deepEqual(normalizeScope({ kind: "project", key: "k" }), { kind: "project", key: "k" });
});

test("scopeItems", () => {
  const second = { ...project, key: "github.com/example-org/another", repo: "example-org/another" };
  const board = assembleBoard(
    input({ projects: [project, second], mine: [pr()], projectPrs: { [project.key]: [pr(), pr({ number: 2 })] } }),
  );
  const items = scopeItems(board, project.key);
  assert.equal(items.needsReview.label, "Needs my review");
  assert.equal(items.mine.label, "Mine");
  assert.equal(items.mine.count, 1);
  assert.equal(items.follow.label, "Follow space");
  assert.equal(items.follow.count, 2);
  assert.equal(scopeItems(board, null).follow.count, 0);
  assert.deepEqual(items.projects.map((p) => [p.label, p.count]), [
    ["example-org/another", 0],
    ["example-org/example-repo", 2],
  ]);
});

test("scopeTitle", () => {
  const board = assembleBoard(input());
  assert.equal(scopeTitle({ kind: "follow" }, board, project.key), "Follow space · example-org/example-repo");
  assert.equal(scopeTitle({ kind: "follow" }, board, null), "Follow space");
  assert.equal(scopeTitle({ kind: "project", key: "gitlab.example.com/example-group/example-project" }, board, null), "example-group/example-project");
  assert.equal(scopeTitle({ kind: "project", key: project.key }, board, null), "example-org/example-repo");
});

test("prsInScope", () => {
  const board = assembleBoard(input({ mine: [pr()], projectPrs: { [project.key]: [pr()] } }));
  assert.deepEqual(prsInScope(board, { kind: "follow" }, null), []);
  assert.equal(prsInScope(board, { kind: "follow" }, project.key).length, 1);
  assert.equal(prsInScope(board, { kind: "mine" }, null).length, 1);
  assert.deepEqual(prsInScope(board, { kind: "needsReview" }, null), []);
  assert.deepEqual(prsInScope(board, { kind: "project", key: "nope" }, null), []);
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
