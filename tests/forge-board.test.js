import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_ORDERS,
  DEFAULT_INTERVAL,
  INTERVALS,
  KEEP_LIST_MS,
  KNOWN_BOTS,
  ageText,
  displayName,
  emptyMessage,
  followStatus,
  groupItems,
  itemsByKeys,
  keptLists,
  keyRepo,
  noteIsFor,
  normalizeScope,
  normalizeSettings,
  positionIn,
  rereadDue,
  rowSignature,
  scopeItems,
  scopeProjects,
  scopeRepos,
  scopeTitle,
  scopeWhereTitle,
  shownOrder,
  uniqueKeys,
  whereKey,
  withFolders,
  withNote,
} from "../lib/forge-board.js";

const project = {
  key: "github.com/example-org/example-repo",
  provider: "github",
  host: "github.com",
  repo: "example-org/example-repo",
  localPath: "/work/example-repo",
  folders: ["example-repo"],
};
const lab = { ...project, key: "gitlab.example.com/example-group/example-project", provider: "gitlab", host: "gitlab.example.com", repo: "example-group/example-project" };

/** A board with one GitHub project, read once. */
const makeBoard = (overrides = {}) => ({ items: [], scopes: { projects: {} }, projects: [project], folders: ["example-repo"], notes: [], readAt: 5, ...overrides });

const SHOWS = [
  ["assigned", "Assigned to me"],
  ["all", "All open"],
];

const item = (number, repo = project.repo, host = project.host) => ({ host, repo, number });
const keyOf = (entry) => `${entry.host}/${entry.repo}#${entry.number}`.toLowerCase();

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


test("followStatus: followed, still being read, or not a repo", () => {
  const board = { ...makeBoard(), folders: ["/home/test/code/example-repo", "/home/test/notes"] };
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
  const board = { ...makeBoard(), folders: ["/a"] };
  assert.deepEqual(withFolders(board, ["/a", "/b"]).folders, ["/a", "/b"]);
  assert.equal(withFolders(board, ["/a"]), board);
  assert.deepEqual(board.folders, ["/a"]);
});


test("withNote adds a note once", () => {
  const board = makeBoard({ notes: ["gh: boom"] });
  assert.equal(withNote(board, "gh: boom"), board);
  assert.deepEqual(withNote(board, "Could not read").notes, ["gh: boom", "Could not read"]);
});


test("scopeWhereTitle names only the In part", () => {
  const b = makeBoard();
  assert.equal(scopeWhereTitle({ show: "mine", where: "all" }, b, null), "All repos");
  assert.equal(scopeWhereTitle({ show: "mine", where: "follow" }, b, project.key), "example-org/example-repo");
  assert.equal(scopeWhereTitle({ show: "all", where: "follow" }, b, null), "Follow space");
  assert.equal(scopeWhereTitle({ show: "mine", where: "project", key: "gitlab.example.com/example-group/example-project" }, b, null), "example-group/example-project");
});


test("scopeRepos: the provider and host of the repos a scope shows", () => {
  const board = makeBoard({ projects: [project, lab] });
  const all = { show: "all", where: "all" };
  assert.deepEqual(scopeRepos(board, all, null), [{ provider: "github", host: "github.com" }, { provider: "gitlab", host: "gitlab.example.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "project", key: lab.key }, null), [{ provider: "gitlab", host: "gitlab.example.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "mine", where: "follow" }, project.key), [{ provider: "github", host: "github.com" }]);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "follow" }, null), []);
  assert.deepEqual(scopeRepos(board, { show: "all", where: "project", key: "unknown" }, null), []);
});


test("scopeProjects: the projects a scope shows", () => {
  const board = makeBoard({ projects: [project, lab] });
  assert.deepEqual(scopeProjects(board, { show: "all", where: "all" }, null).map((p) => p.key), [project.key, lab.key]);
  assert.deepEqual(scopeProjects(board, { show: "all", where: "project", key: lab.key }, null).map((p) => p.key), [lab.key]);
  assert.deepEqual(scopeProjects(board, { show: "mine", where: "follow" }, project.key).map((p) => p.key), [project.key]);
  assert.deepEqual(scopeProjects(board, { show: "all", where: "follow" }, null), []);
});


test("positionIn", () => {
  assert.deepEqual(positionIn(["a", "b", "c"], "b"), { index: 2, total: 3, prev: "a", next: "c" });
  assert.deepEqual(positionIn(["a", "b", "c"], "a"), { index: 1, total: 3, prev: null, next: "b" });
  assert.deepEqual(positionIn(["a", "b", "c"], "c").next, null);
  assert.equal(positionIn(["a", "b", "c"], "z"), null);
});


test("displayName: the forge's name, else a known bot's name, else the login", () => {
  assert.equal(displayName("octo-user", { "octo-user": "Octo User" }), "Octo User");
  assert.equal(displayName("copilot-pull-request-reviewer", {}), "Copilot");
  assert.equal(displayName("app/dependabot", {}), "Dependabot");
  // Another app shows without the app/ prefix that gh adds.
  assert.equal(displayName("app/example-bot", {}), "example-bot");
  assert.equal(displayName("cli-triage", {}), "cli-triage");
  assert.equal(displayName("octo-user", undefined), "octo-user");
});


test("displayName: a login that matches an Object property is a plain name", () => {
  assert.equal(displayName("constructor", {}), "constructor");
  assert.equal(displayName("constructor", { constructor: "C Name" }), "C Name");
  assert.equal(displayName("app/constructor", undefined), "constructor");
  assert.equal(displayName("__proto__", {}), "__proto__");
  assert.equal(displayName("toString", {}), "toString");
});


test("INTERVALS are the refresh choices, 3 minutes by default", () => {
  assert.deepEqual(INTERVALS, [1, 3, 5, 10, 15]);
  assert.equal(DEFAULT_INTERVAL, 3);
});

test("normalizeScope keeps a known Show and a valid In, else the first Show and All repos", () => {
  assert.deepEqual(normalizeScope(null, SHOWS), { show: "assigned", where: "all" });
  assert.deepEqual(normalizeScope({ show: "all", where: "follow" }, SHOWS), { show: "all", where: "follow" });
  assert.deepEqual(normalizeScope({ show: "mine", where: "project", key: project.key }, SHOWS), { show: "assigned", where: "project", key: project.key });
  assert.deepEqual(normalizeScope({ show: "all", where: "project", key: "" }, SHOWS), { show: "all", where: "all" });
  assert.deepEqual(normalizeScope({ show: "all", where: "elsewhere" }, SHOWS), { show: "all", where: "all" });
});

test("whereKey and keyRepo", () => {
  assert.equal(whereKey({ show: "all", where: "all" }, project.key), null);
  assert.equal(whereKey({ show: "all", where: "follow" }, project.key), project.key);
  assert.equal(whereKey({ show: "all", where: "follow" }, null), undefined);
  assert.equal(whereKey({ show: "all", where: "project", key: lab.key }, null), lab.key);
  assert.equal(keyRepo(lab.key), "example-group/example-project");
});

test("scopeItems counts each choice with the other one kept, and keeps a picked project that left the board", () => {
  const board = makeBoard({ projects: [lab, project] });
  const count = (scope) => (scope.show === "assigned" ? 1 : 2) + (scope.where === "project" ? 10 : 0);
  const scope = { show: "assigned", where: "project", key: "github.com/example-org/gone-repo" };
  const items = scopeItems(board, null, scope, { shows: SHOWS, count });
  assert.deepEqual(items.show.map((entry) => [entry.key, entry.label, entry.count, entry.current]), [["assigned", "Assigned to me", 11, true], ["all", "All open", 12, false]]);
  assert.deepEqual(items.show[1].scope, { show: "all", where: "project", key: scope.key });
  assert.deepEqual(items.where.map((entry) => [entry.key, entry.count, entry.current]), [["follow", 1, false], ["all", 1, false]]);
  assert.deepEqual(items.projects.map((entry) => [entry.label, entry.current]), [["example-group/example-project", false], ["example-org/example-repo", false], ["example-org/gone-repo", true]]);
});

test("scopeTitle names Show, and In when it is not All repos", () => {
  const board = makeBoard();
  assert.equal(scopeTitle({ show: "all", where: "all" }, board, null, SHOWS), "All open");
  assert.equal(scopeTitle({ show: "unknown", where: "all" }, board, null, SHOWS), "Assigned to me");
  assert.equal(scopeTitle({ show: "all", where: "follow" }, board, project.key, SHOWS), "All open · example-org/example-repo");
  assert.equal(scopeTitle({ show: "all", where: "follow" }, board, null, SHOWS), "All open · Follow space");
  assert.equal(scopeTitle({ show: "assigned", where: "project", key: lab.key }, board, null, SHOWS), "Assigned to me · example-group/example-project");
});

test("noteIsFor matches gh notes to GitHub and glab notes to their host", () => {
  const github = { provider: "github", host: "github.com" };
  const gitlab = { provider: "gitlab", host: "gitlab.example.com" };
  assert.equal(noteIsFor("gh: HTTP 401", github), true);
  assert.equal(noteIsFor("gh not found. Install GitHub CLI, or set the gh command in Settings.", github), true);
  assert.equal(noteIsFor("glab (gitlab.example.com): 401", github), false);
  assert.equal(noteIsFor("glab (gitlab.example.com): 401", gitlab), true);
  assert.equal(noteIsFor("glab (gitlab.com): 401", gitlab), false);
  assert.equal(noteIsFor("glab not found. Install GitLab CLI, or set the glab command in Settings.", gitlab), true);
});

test("emptyMessage gives the caller's texts after a read", () => {
  const texts = { failed: "No issues could be read. See the messages above.", none: "No open issues here" };
  const github = [{ provider: "github", host: "github.com" }];
  assert.equal(emptyMessage(makeBoard({ readAt: 0 }), github, texts), "Loading…");
  assert.equal(emptyMessage(makeBoard(), github, texts), "No open issues here");
  assert.equal(emptyMessage(makeBoard({ notes: ["gh: HTTP 401"] }), github, texts), texts.failed);
  assert.equal(emptyMessage(makeBoard({ notes: ["glab (gitlab.example.com): 401"] }), github, texts), texts.none);
  assert.equal(emptyMessage(makeBoard({ notes: ["glab (gitlab.example.com): 401"] }), [], texts), texts.failed);
  assert.equal(emptyMessage(makeBoard({ notes: ["Showing the first 100 issues of example-org/example-repo."] }), github, texts), texts.none);
});

test("itemsByKeys follows the order of the keys and skips unknown keys", () => {
  const list = [item(1), item(2), item(3)];
  assert.deepEqual(itemsByKeys(list, [keyOf(item(3)), "missing", keyOf(item(1))], keyOf), [item(3), item(1)]);
});

test("keptLists keeps a failed repo's items for keepMs after its last list", () => {
  const other = "github.com/example-org/other-repo";
  const previous = {
    scopes: { projects: { [project.key]: [keyOf(item(2)), keyOf(item(1))] } },
    listedAt: { [project.key]: 1_000, [other]: 100 },
  };
  const items = [item(1), item(2), item(7, "example-org/other-repo")];
  const kept = keptLists(previous, [project.key, project.key, other, "github.com/example-org/new-repo"], 1_500, { items, keyOf, keepMs: 1_000 });
  assert.deepEqual(kept.items, [item(1), item(2)]);
  assert.deepEqual(kept.projectItems, { [project.key]: [item(2), item(1)] });
  assert.deepEqual(kept.listedAt, { [project.key]: 1_000 });
  assert.deepEqual(keptLists(previous, [project.key], 2_000, { items, keyOf, keepMs: 1_000 }).items, []);
  assert.deepEqual(keptLists({ scopes: { projects: {} } }, [project.key], 2_000, { items, keyOf, keepMs: 1_000 }).items, []);
});

test("shownOrder lists the keys group by group", () => {
  assert.deepEqual(shownOrder([[item(2), item(1)], [], [item(5)]], keyOf), [keyOf(item(2)), keyOf(item(1)), keyOf(item(5))]);
});

test("shownOrder counts an item in several groups once, at its first place", () => {
  assert.deepEqual(shownOrder([[item(2), item(1)], [item(1), item(5)]], keyOf), [keyOf(item(2)), keyOf(item(1)), keyOf(item(5))]);
});

test("groupItems puts an item in the group of each of its values, A to Z, with the none group last", () => {
  const items = [
    { id: 1, tags: ["beta", "Alpha"] },
    { id: 2, tags: [] },
    { id: 3, tags: ["beta"] },
  ];
  const valuesOf = (entry) => entry.tags.map((tag) => ({ key: tag.toLowerCase(), title: tag }));
  const groups = groupItems(items, valuesOf, { key: "none", title: "No tag" });
  assert.deepEqual(
    groups.map((group) => [group.key, group.title, group.items.map((entry) => entry.id)]),
    [
      ["alpha", "Alpha", [1]],
      ["beta", "beta", [1, 3]],
      ["none", "No tag", [2]],
    ],
  );
});

test("groupItems keeps the first title of a key, counts an item once per group and leaves out an empty none group", () => {
  const items = [
    { id: 1, tags: ["Bug", "bug"] },
    { id: 2, tags: ["BUG"] },
  ];
  const groups = groupItems(items, (entry) => entry.tags.map((tag) => ({ key: tag.toLowerCase(), title: tag })), { key: "none", title: "No tag" });
  assert.deepEqual(
    groups.map((group) => [group.key, group.title, group.items.map((entry) => entry.id)]),
    [["bug", "Bug", [1, 2]]],
  );
  assert.deepEqual(groupItems([], () => [], { key: "none", title: "No tag" }), []);
});

test("groupItems sorts groups of the same title by key", () => {
  const items = [
    { id: 1, owner: { key: "b", title: "same" } },
    { id: 2, owner: { key: "a", title: "same" } },
  ];
  const groups = groupItems(items, (entry) => [entry.owner], { key: "none", title: "None" });
  assert.deepEqual(groups.map((group) => group.key), ["a", "b"]);
});

test("normalizeSettings of a forge board: defaults", () => {
  assert.deepEqual(normalizeSettings(null), { interval: DEFAULT_INTERVAL, conversation: "oldest" });
  assert.deepEqual(CONVERSATION_ORDERS, ["oldest", "newest"]);
});

test("normalizeSettings of a forge board keeps a valid interval and leaves the commands to the shared forge settings", () => {
  assert.equal(normalizeSettings({ interval: 4 }).interval, DEFAULT_INTERVAL);
  assert.deepEqual(normalizeSettings({ interval: 10, gh: " ~/bin/gh " }), { interval: 10, conversation: "oldest" });
});

test("normalizeSettings of a forge board keeps a known conversation order only", () => {
  assert.equal(normalizeSettings({ conversation: "newest" }).conversation, "newest");
  assert.equal(normalizeSettings({ conversation: "sideways" }).conversation, "oldest");
});

test("KEEP_LIST_MS is 15 minutes", () => {
  assert.equal(KEEP_LIST_MS, 15 * 60 * 1000);
});

test("displayName is safe without a login or names", () => {
  assert.equal(displayName(undefined, undefined), "");
  assert.equal(displayName(null, { "": "x" }), "x");
  assert.equal(KNOWN_BOTS.dependabot, "Dependabot");
});

test("uniqueKeys marks repeats in order", () => {
  assert.deepEqual(uniqueKeys(["a", "b", "a", "a"]), ["a", "b", "a~2", "a~3"]);
});

test("rowSignature joins the parts of a row, null without a row", () => {
  assert.equal(rowSignature({ a: 1, b: "x" }, (row) => [row.a, row.b, null]), "1|x|");
  assert.equal(rowSignature(null, () => ["x"]), null);
  assert.equal(rowSignature(undefined, () => ["x"]), null);
});

test("rereadDue reads again only for a changed row or a silent board", () => {
  const base = { signature: "t1|open", seen: "t1|open", boardReadAt: 2000, shownReadAt: 1000, now: 3000, intervalMs: 600_000 };
  assert.equal(rereadDue(base), false);
  assert.equal(rereadDue({ ...base, signature: "t2|open" }), true);
  assert.equal(rereadDue({ ...base, signature: null }), true);
  assert.equal(rereadDue({ ...base, signature: null, boardReadAt: 500 }), false);
  assert.equal(rereadDue({ ...base, seen: undefined }), true);
  assert.equal(rereadDue({ ...base, now: 2000 + 600_001, shownReadAt: 1000 }), true);
  assert.equal(rereadDue({ ...base, now: 2000 + 600_001, shownReadAt: 2500 }), false);
});
