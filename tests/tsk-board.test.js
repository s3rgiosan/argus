import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_LABELS,
  activitySentence,
  buildBoard,
  captureTarget,
  effectiveScope,
  inputToOn,
  liveNumbersOf,
  normalizeScope,
  onDesk,
  onToInput,
  projectLabelsOf,
  projectOf,
  taskPaneTitle,
  rowsInScope,
  scopeTitle,
  sectionOf,
  sidebarModel,
  sortByProject,
  titleChange,
} from "../mods/argus-tsk/board.js";

/** A scope with no thread or assignee unless `over` names one. */
const scope = (over) => ({ thread: null, assignee: null, ...over });
const whereItem = (m, key) => m.where.find((item) => item.key === key);

const row = (over = {}) => ({
  id: "id",
  number: 1,
  title: "Task",
  status: "open",
  project: null,
  thread: null,
  assignee: null,
  assigneeKind: null,
  base: null,
  after: [],
  before: [],
  archived: null,
  group: null,
  projectTitle: null,
  ...over,
});
const blockOn = (on) => ({ on });
const reviewOn = (on) => ({ on });
const numbers = (rows) => rows.map((r) => r.number);

// sections
test("sectionOf: block waiting on a live task is in motion", () => {
  assert.equal(sectionOf(row({ status: "blocked", block: blockOn("task:7") }), new Set([7])), "inMotion");
});
test("sectionOf: block waiting on a finished task needs you", () => {
  assert.equal(sectionOf(row({ status: "blocked", block: blockOn("task:7") }), new Set()), "needsYou");
});
test("sectionOf: review with no record needs you", () => {
  assert.equal(sectionOf(row({ status: "review" }), new Set()), "needsYou");
});
test("sectionOf: block waiting on you needs you", () => {
  assert.equal(sectionOf(row({ status: "blocked", block: blockOn("you") }), new Set()), "needsYou");
});
test("sectionOf: agent waits are in motion", () => {
  assert.equal(sectionOf(row({ status: "review", review: reviewOn("agent:builder") }), new Set()), "inMotion");
  assert.equal(sectionOf(row({ status: "blocked", block: blockOn("other:vendor") }), new Set()), "inMotion");
  assert.equal(sectionOf(row({ status: "review", review: reviewOn("builder") }), new Set()), "inMotion");
});
test("sectionOf: remaining statuses", () => {
  assert.equal(sectionOf(row({ status: "started" }), new Set()), "inMotion");
  assert.equal(sectionOf(row({ status: "ready" }), new Set()), "onDeck");
  assert.equal(sectionOf(row({ status: "open" }), new Set()), "onDeck");
  assert.equal(sectionOf(row({ status: "done" }), new Set()), "done");
});
test("sectionOf: unknown status goes to the inbox", () => {
  const board = buildBoard([row({ number: 1, status: "unknown" }), row({ number: 2, status: "ready" })], new Set());
  assert.deepEqual(numbers(board.inbox), [1]);
  assert.deepEqual(numbers(board.ready), [2]);
});
test("buildBoard: splits ready from the inbox", () => {
  const b = buildBoard([row({ number: 1, status: "open" }), row({ number: 2, status: "ready" })], new Set());
  assert.deepEqual(numbers(b.ready), [2]);
  assert.deepEqual(numbers(b.inbox), [1]);
});
test("buildBoard: keeps row order per section and drops done rows", () => {
  const b = buildBoard(
    [
      row({ number: 3, status: "started" }),
      row({ number: 1, status: "review" }),
      row({ number: 2, status: "started" }),
      row({ number: 4, status: "done" }),
    ],
    new Set(),
  );
  assert.deepEqual(numbers(b.inMotion), [3, 2]);
  assert.deepEqual(numbers(b.needsYou), [1]);
});
test("buildBoard: empty input gives four empty lists", () => {
  assert.deepEqual(buildBoard([], new Set()), { needsYou: [], inMotion: [], ready: [], inbox: [] });
});
test("buildBoard: all-done rows give empty sections", () => {
  const b = buildBoard([row({ number: 1, status: "done" }), row({ number: 2, status: "done" })], new Set());
  assert.deepEqual(b, { needsYou: [], inMotion: [], ready: [], inbox: [] });
});
test("liveNumbersOf: collects every non-done number", () => {
  const s = liveNumbersOf([row({ number: 1, status: "done" }), row({ number: 2, status: "open" })]);
  assert.deepEqual([...s], [2]);
});

// waits
test("onToInput: maps each stored form to a control kind", () => {
  assert.deepEqual(onToInput("you"), { kind: "you", value: "" });
  assert.deepEqual(onToInput("task:12"), { kind: "task", value: "T12" });
  assert.deepEqual(onToInput("other:ask legal"), { kind: "other", value: "ask legal" });
  assert.deepEqual(onToInput("agent:builder"), { kind: "agent", value: "builder" });
  assert.deepEqual(onToInput("claude"), { kind: "agent", value: "claude" });
});
test("inputToOn: round trip sends a value tsk stores identically", () => {
  const sent = (on) => {
    const { kind, value } = onToInput(on);
    return inputToOn(kind, value);
  };
  assert.equal(sent("you"), "you");
  assert.equal(sent("task:12"), "T12");
  assert.equal(sent("other:ask legal"), "ask legal");
  assert.equal(sent("agent:builder"), "builder");
  assert.equal(sent("claude"), "claude");
});
test("inputToOn: null for the default or an empty value", () => {
  assert.equal(inputToOn("default", ""), null);
  assert.equal(inputToOn("other", ""), null);
});

// sidebar
test("sidebarModel: disambiguates colliding basenames", () => {
  const m = sidebarModel([row({ project: "/home/test/work/site" }), row({ project: "/home/test/client/site" })]);
  assert.deepEqual(m.projects.map((p) => p.label), ["client/site", "work/site"]);
  assert.deepEqual(m.projects[0].scope, { where: "project", project: "/home/test/client/site", thread: null, assignee: null });
});
test("sidebarModel: widens colliding labels until unique", () => {
  const m = sidebarModel(
    [
      row({ project: "/home/test/a/x/app" }),
      row({ project: "/home/test/b/x/app" }),
      row({ project: "/home/test/c/y/app" }),
      row({ project: "/home/test/tool" }),
    ]
  );
  assert.deepEqual(m.projects.map((p) => p.label), ["a/x/app", "b/x/app", "tool", "y/app"]);
});
test("sidebarModel: counts the desk like the terminal desk", () => {
  const m = sidebarModel(
    [
      row({ project: "/p", status: "started" }),
      row({ project: "/p", status: "ready" }),
      row({ project: null, status: "open" }),
    ]
  );
  assert.equal(whereItem(m, "desk").count, 2);
  assert.equal(whereItem(m, "all").count, 3);
});
test("sidebarModel: labels the cross-project view All Projects", () => {
  assert.equal(whereItem(sidebarModel([]), "all").label, "All Projects");
});
test("sidebarModel: sorts projects by label and counts rows", () => {
  const m = sidebarModel([row({ project: "/x/beta" }), row({ project: "/x/alpha" }), row({ project: "/x/beta" })]);
  assert.deepEqual(m.projects.map((p) => [p.label, p.count]), [["alpha", 1], ["beta", 2]]);
});
test("sidebarModel: sorted thread and assignee items, skipping empty ones", () => {
  const m = sidebarModel(
    [
      row({ thread: "zeta", assignee: "bob" }),
      row({ thread: "alpha", assignee: "amy" }),
      row({ thread: "alpha" }),
    ]
  );
  assert.deepEqual(m.threads.map((t) => [t.label, t.count]), [["Any thread", 3], ["alpha", 2], ["zeta", 1]]);
  assert.deepEqual(m.threads[1].scope, { where: "follow", thread: "alpha", assignee: null });
  assert.deepEqual(m.assignees.map((a) => a.label), ["Anyone", "amy", "bob"]);
  assert.deepEqual(m.assignees[1].scope, { where: "follow", thread: null, assignee: "amy" });
});
test("sidebarModel: desk and all items carry their scopes and keys", () => {
  const m = sidebarModel([]);
  assert.deepEqual(whereItem(m, "desk"), { key: "desk", label: "Desk", scope: { where: "desk", thread: null, assignee: null }, count: 0, current: false });
  assert.deepEqual(whereItem(m, "all").scope, { where: "all", thread: null, assignee: null });
});

test("scopeTitle: names the views", () => {
  const model = sidebarModel([]);
  assert.equal(scopeTitle(scope({ where: "desk" }), model), "Desk");
  assert.equal(scopeTitle(scope({ where: "all" }), model), "All Projects");
});
test("scopeTitle: names a project as the sidebar does", () => {
  const model = sidebarModel([row({ project: "/home/test/work/site" }), row({ project: "/home/test/client/site" })]);
  assert.equal(scopeTitle(scope({ where: "project", project: "/home/test/work/site" }), model), "work/site");
});
test("scopeTitle: names a project with no rows by its folder", () => {
  const model = sidebarModel([row({ project: "/home/test/work/site" })]);
  assert.equal(scopeTitle(scope({ where: "project", project: "/home/test/empty" }), model), "empty");
});
test("scopeTitle: adds the thread and the assignee after the place", () => {
  const model = sidebarModel([]);
  assert.equal(scopeTitle(scope({ where: "all", thread: "launch" }), model), "All Projects · launch");
  assert.equal(scopeTitle(scope({ where: "desk", assignee: "ana" }), model), "Desk · ana");
  assert.equal(scopeTitle(scope({ where: "follow", thread: "launch", assignee: "ana" }), model, null), "Follow space · Desk · launch · ana");
});

test("projectLabelsOf: maps each project path to its sidebar label", () => {
  const labels = projectLabelsOf(
    [row({ project: "/home/test/a/wp-content" }), row({ project: "/home/test/b/other" }), row({ project: null })]
  );
  assert.deepEqual(
    labels,
    new Map([
      ["/home/test/a/wp-content", "wp-content"],
      ["/home/test/b/other", "other"],
    ]),
  );
});
test("sortByProject: keeps projects that share a label apart", () => {
  const rows = [
    row({ number: 1, project: "/home/test/a" }),
    row({ number: 2, project: "/home/test/b" }),
    row({ number: 3, project: "/home/test/a" }),
  ];
  const labels = new Map([
    ["/home/test/a", "Site"],
    ["/home/test/b", "Site"],
  ]);
  assert.deepEqual(numbers(sortByProject(rows, labels)), [1, 3, 2]);
});
test("onDesk: unknown status on the desk like an open one", () => {
  assert.equal(onDesk(row({ status: "unknown", project: null })), true);
  assert.equal(onDesk(row({ status: "unknown", project: "/home/test/alpha" })), false);
});
test("onDesk: started rows from any project; done rows never", () => {
  assert.equal(onDesk(row({ status: "started", project: "/p" })), true);
  assert.equal(onDesk(row({ status: "done", project: null })), false);
});

test("rowsInScope: filters rows by scope", () => {
  const rows = [
    row({ number: 1, status: "started", project: "/p", thread: "t", assignee: "amy" }),
    row({ number: 2, status: "ready", project: "/p" }),
    row({ number: 3, status: "open", project: null, thread: "t" }),
    row({ number: 4, status: "open", project: "/q", assignee: "amy" }),
  ];
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "all" }))), [1, 2, 3, 4]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "desk" }))), [1, 3]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "project", project: "/p" }))), [1, 2]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "all", thread: "t" }))), [1, 3]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "all", assignee: "amy" }))), [1, 4]);
});
test("rowsInScope: the place, the thread and the assignee combine", () => {
  const rows = [
    row({ number: 1, project: "/p", thread: "t", assignee: "amy" }),
    row({ number: 2, project: "/p", thread: "t" }),
    row({ number: 3, project: "/q", thread: "t", assignee: "amy" }),
    row({ number: 4, project: "/p", assignee: "amy" }),
  ];
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "project", project: "/p", thread: "t" }))), [1, 2]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "project", project: "/p", thread: "t", assignee: "amy" }))), [1]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "follow", assignee: "amy" }), "/p")), [1, 4]);
  assert.deepEqual(numbers(rowsInScope(rows, scope({ where: "follow", thread: "t" }), null)), []);
});
test("rowsInScope: counts match the sidebar items", () => {
  const rows = [row({ project: "/p", thread: "t" }), row({ project: "/p" }), row({ status: "started", assignee: "amy" })];
  for (const current of [scope({ where: "follow" }), scope({ where: "project", project: "/p", thread: "t" }), scope({ where: "desk", assignee: "amy" })]) {
    const m = sidebarModel(rows, "/p", current);
    for (const item of [...m.where, ...m.projects, ...m.threads, ...m.assignees]) {
      assert.equal(rowsInScope(rows, item.scope, "/p").length, item.count, item.key);
    }
  }
});

// status
test("STATUS_LABELS: names every status", () => {
  assert.deepEqual(STATUS_LABELS, {
    open: "Open",
    ready: "Ready",
    started: "Started",
    blocked: "Blocked",
    review: "In Review",
    done: "Done",
    unknown: "Unknown",
  });
});

// activity
const at = [0, 0];
test("activitySentence: names the person who acted", () => {
  assert.equal(activitySentence({ at, by: "alex", kind: "created", detail: null }), "alex added this task");
});
test("activitySentence: reads without a person", () => {
  assert.equal(
    activitySentence({ at, by: null, kind: "status_set", detail: { from: "ready", to: "started" } }),
    "Status changed to Started",
  );
});
test("activitySentence: status set without a readable target", () => {
  assert.equal(activitySentence({ at, by: null, kind: "status_set", detail: null }), "Status changed");
});
test("activitySentence: a status word reads as a status change", () => {
  assert.equal(
    activitySentence({ at, by: "claude", kind: "blocked", detail: { on: "human" } }),
    "claude changed the status to Blocked",
  );
});
test("activitySentence: unknown verb shows as tsk wrote it", () => {
  assert.equal(activitySentence({ at, by: "alex", kind: "base_set", detail: "main" }), "alex base_set: main");
  assert.equal(activitySentence({ at, by: null, kind: "cleaned", detail: null }), "cleaned");
});
test("activitySentence: assigned uses the target", () => {
  assert.equal(activitySentence({ at, by: "alex", kind: "assigned", detail: { to: "amy" } }), "alex assigned this to amy");
  assert.equal(activitySentence({ at, by: null, kind: "assigned", detail: null }), "Assignee changed");
});

test("captureTarget: a project scope captures into that project", () => {
  assert.deepEqual(captureTarget(scope({ where: "project", project: "/work/alpha" })), { project: "/work/alpha", thread: null, assignee: null });
});

test("captureTarget: the thread and the assignee go with the task", () => {
  assert.deepEqual(captureTarget(scope({ where: "all", thread: "release" })), { project: null, thread: "release", assignee: null });
  assert.deepEqual(captureTarget(scope({ where: "desk", assignee: "claude" })), { project: null, thread: null, assignee: "claude" });
  assert.deepEqual(captureTarget(scope({ where: "project", project: "/work/alpha", thread: "release", assignee: "claude" })), {
    project: "/work/alpha",
    thread: "release",
    assignee: "claude",
  });
});

test("captureTarget: desk and all capture onto the desk", () => {
  const desk = { project: null, thread: null, assignee: null };
  assert.deepEqual(captureTarget(scope({ where: "desk" })), desk);
  assert.deepEqual(captureTarget(scope({ where: "all" })), desk);
});

test("normalizeScope keeps a valid scope and falls back to the desk", () => {
  assert.deepEqual(normalizeScope({ where: "project", project: "/work/alpha", thread: "release", assignee: null }), scope({ where: "project", project: "/work/alpha", thread: "release" }));
  assert.deepEqual(normalizeScope({ where: "follow", assignee: "claude", extra: 1 }), scope({ where: "follow", assignee: "claude" }));
  assert.deepEqual(normalizeScope({ where: "all", thread: "", assignee: 3 }), scope({ where: "all" }));
  assert.deepEqual(normalizeScope({ where: "project" }), scope({ where: "desk" }));
  assert.deepEqual(normalizeScope({ where: "elsewhere", thread: "t" }), scope({ where: "desk", thread: "t" }));
  assert.deepEqual(normalizeScope("all"), scope({ where: "desk" }));
});
test("normalizeScope: a scope saved as one kind maps onto the new choices", () => {
  assert.deepEqual(normalizeScope({ kind: "follow" }), scope({ where: "follow" }));
  assert.deepEqual(normalizeScope({ kind: "desk" }), scope({ where: "desk" }));
  assert.deepEqual(normalizeScope({ kind: "all" }), scope({ where: "all" }));
  assert.deepEqual(normalizeScope({ kind: "project", project: "/work/alpha" }), scope({ where: "project", project: "/work/alpha" }));
  assert.deepEqual(normalizeScope({ kind: "thread", name: "release" }), scope({ where: "all", thread: "release" }));
  assert.deepEqual(normalizeScope({ kind: "assignee", name: "claude" }), scope({ where: "all", assignee: "claude" }));
  assert.deepEqual(normalizeScope({ kind: "project" }), scope({ where: "desk" }));
  assert.deepEqual(normalizeScope({ kind: "thread", name: "" }), scope({ where: "desk" }));
});
test("normalizeScope: no stored scope follows the space", () => {
  assert.deepEqual(normalizeScope(null), scope({ where: "follow" }));
  assert.deepEqual(normalizeScope(undefined), scope({ where: "follow" }));
});

// project titles
test("sidebarModel: a titled project shows its title and sorts by it", () => {
  const m = sidebarModel([
    row({ project: "/home/test/sites/alpha/wp-content", projectTitle: "Zulu Site" }),
    row({ project: "/home/test/tools/beta" }),
  ]);
  assert.deepEqual(m.projects.map((p) => p.label), ["beta", "Zulu Site"]);
  assert.deepEqual(m.projects[1].scope, scope({ where: "project", project: "/home/test/sites/alpha/wp-content" }));
  assert.equal(m.projects[1].title, "Zulu Site");
  assert.equal(m.projects[1].folder, "wp-content");
  assert.equal(m.projects[0].title, null);
  assert.equal(m.projects[0].folder, "beta");
});
test("sidebarModel: rows without projectTitle keep the folder labels", () => {
  const { projectTitle: _drop, ...old } = row({ project: "/home/test/work/site" });
  const m = sidebarModel([old, row({ project: "/home/test/client/site" })]);
  assert.deepEqual(m.projects.map((p) => p.label), ["client/site", "work/site"]);
});
test("projectLabelsOf: a title replaces the folder label and stops a collision", () => {
  const labels = projectLabelsOf([
    row({ project: "/home/test/a/wp-content", projectTitle: "Site A" }),
    row({ project: "/home/test/b/wp-content" }),
  ]);
  assert.deepEqual(
    labels,
    new Map([
      ["/home/test/a/wp-content", "Site A"],
      ["/home/test/b/wp-content", "wp-content"],
    ]),
  );
});
test("projectLabelsOf: a folder label that matches a title widens", () => {
  const labels = projectLabelsOf([
    row({ project: "/home/test/a/app", projectTitle: "site" }),
    row({ project: "/home/test/b/site" }),
  ]);
  assert.equal(labels.get("/home/test/a/app"), "site");
  assert.equal(labels.get("/home/test/b/site"), "b/site");
});
test("scopeTitle: names a titled project by its title", () => {
  const model = sidebarModel([row({ project: "/home/test/sites/alpha", projectTitle: "Alpha Site" })]);
  assert.equal(scopeTitle(scope({ where: "project", project: "/home/test/sites/alpha" }), model), "Alpha Site");
});
test("sortByProject: sorts by the shown name", () => {
  const rows = [
    row({ number: 1, project: "/home/test/aaa", projectTitle: "Zulu" }),
    row({ number: 2, project: "/home/test/bbb" }),
    row({ number: 3, project: null }),
  ];
  assert.deepEqual(numbers(sortByProject(rows, projectLabelsOf(rows))), [2, 1, 3]);
});
test("titleChange: an unchanged prefill saves nothing", () => {
  assert.equal(titleChange({ title: null, folder: "wp-content" }, "wp-content"), null);
  assert.equal(titleChange({ title: "Site A", folder: "wp-content" }, "  Site A "), null);
});
test("titleChange: a new name sets the title, trimmed", () => {
  assert.deepEqual(titleChange({ title: null, folder: "wp-content" }, "  Site A "), { title: "Site A" });
  assert.deepEqual(titleChange({ title: "Site A", folder: "wp-content" }, "Site B"), { title: "Site B" });
});
test("titleChange: an empty field clears a title, and saves nothing without one", () => {
  assert.deepEqual(titleChange({ title: "Site A", folder: "wp-content" }, "  "), { title: null });
  assert.equal(titleChange({ title: null, folder: "wp-content" }, ""), null);
});

// name order
test("sidebarModel: projects, threads and assignees sort without regard to case", () => {
  const m = sidebarModel([
    row({ project: "/home/test/cli", thread: "b", assignee: "ana" }),
    row({ project: "/home/test/x", projectTitle: "Taken Name", thread: "A", assignee: "Ana" }),
    row({ project: "/home/test/alpha", thread: "a", assignee: "Bob" }),
  ]);
  assert.deepEqual(m.projects.map((p) => p.label), ["alpha", "cli", "Taken Name"]);
  assert.deepEqual(m.threads.slice(1).map((t) => t.label), ["A", "a", "b"]);
  assert.deepEqual(m.assignees.slice(1).map((a) => a.label), ["Ana", "ana", "Bob"]);
});
test("sortByProject: sorts shown names without regard to case", () => {
  const rows = [
    row({ number: 1, project: "/home/test/x", projectTitle: "Taken Name" }),
    row({ number: 2, project: "/home/test/cli" }),
    row({ number: 3, project: "/home/test/Alpha" }),
  ];
  assert.deepEqual(numbers(sortByProject(rows, projectLabelsOf(rows))), [3, 2, 1]);
});

// follow the focused space
test("effectiveScope: follow becomes the followed project, else the desk, and keeps the filters", () => {
  assert.deepEqual(effectiveScope(scope({ where: "follow", thread: "t" }), "/home/test/site"), scope({ where: "project", project: "/home/test/site", thread: "t" }));
  assert.deepEqual(effectiveScope(scope({ where: "follow", assignee: "amy" }), null), scope({ where: "desk", assignee: "amy" }));
  assert.deepEqual(effectiveScope(scope({ where: "all" }), "/home/test/site"), scope({ where: "all" }));
  assert.deepEqual(effectiveScope(scope({ where: "project", project: "/x" }), null), scope({ where: "project", project: "/x" }));
});

test("scopeTitle: follow names what it follows", () => {
  const rows = [row({ project: "/home/test/sites/alpha", projectTitle: "Alpha Site" })];
  const model = sidebarModel(rows);
  assert.equal(scopeTitle(scope({ where: "follow" }), model, "/home/test/sites/alpha"), "Follow space · Alpha Site");
  assert.equal(scopeTitle(scope({ where: "follow" }), model, null), "Follow space · Desk");
});
test("sidebarModel: a follow item heads the list and is current by default", () => {
  const m = sidebarModel([]);
  assert.deepEqual(m.where[0], { key: "follow", label: "Follow space", scope: scope({ where: "follow" }), count: 0, current: true });
  assert.deepEqual(m.where.map((i) => i.key), ["follow", "desk", "all"]);
});
test("sidebarModel: the follow item counts what it follows", () => {
  const rows = [row({ project: "/home/test/p" }), row({ project: "/home/test/p" }), row({ project: null, status: "open" }), row({ project: "/home/test/q", status: "ready" })];
  assert.equal(whereItem(sidebarModel(rows, "/home/test/p"), "follow").count, 2);
  assert.equal(whereItem(sidebarModel(rows, null), "follow").count, 1);
});

// combined scopes
test("sidebarModel: each row changes only its own choice and marks the current one", () => {
  const rows = [row({ project: "/p", thread: "t", assignee: "amy" }), row({ project: "/p", thread: "u" })];
  const current = scope({ where: "follow", thread: "t", assignee: "amy" });
  const m = sidebarModel(rows, "/p", current);
  assert.deepEqual(whereItem(m, "all").scope, scope({ where: "all", thread: "t", assignee: "amy" }));
  assert.deepEqual(m.projects[0].scope, scope({ where: "project", project: "/p", thread: "t", assignee: "amy" }));
  assert.deepEqual(m.threads.map((i) => [i.label, i.count, i.current]), [["Any thread", 1, false], ["t", 1, true], ["u", 0, false]]);
  assert.deepEqual(m.threads[0].scope, scope({ where: "follow", assignee: "amy" }));
  assert.deepEqual(m.assignees.map((i) => [i.label, i.count, i.current]), [["Anyone", 1, false], ["amy", 1, true]]);
  assert.deepEqual(m.where.map((i) => i.current), [true, false, false]);
  assert.equal(m.projects[0].current, false);
});
test("sidebarModel: a picked project is current, and Follow space is not", () => {
  const m = sidebarModel([row({ project: "/p" })], "/p", scope({ where: "project", project: "/p" }));
  assert.equal(m.projects[0].current, true);
  assert.equal(whereItem(m, "follow").current, false);
});
test("sidebarModel: a picked thread or assignee with no rows left stays in the list", () => {
  const m = sidebarModel([row({ thread: "t" })], null, scope({ where: "all", thread: "gone", assignee: "left" }));
  assert.deepEqual(m.threads.map((i) => [i.label, i.count, i.current]), [["Any thread", 0, false], ["gone", 0, true], ["t", 0, false]]);
  assert.deepEqual(m.assignees.map((i) => [i.label, i.count, i.current]), [["Anyone", 0, false], ["left", 0, true]]);
});

test("projectOf: only a project row names a project, even when the scope is a project", () => {
  const m = sidebarModel([row({ project: "/p", thread: "t", assignee: "amy" })], null, scope({ where: "project", project: "/p" }));
  assert.equal(projectOf(m.projects[0]), "/p");
  for (const item of [...m.where, ...m.threads, ...m.assignees]) assert.equal(projectOf(item), null, item.key);
});

test("sidebarModel: a picked project with no rows left stays in the list, ticked", () => {
  const m = sidebarModel([row({ project: "/home/test/b" })], null, scope({ where: "project", project: "/home/test/gone" }));
  assert.deepEqual(m.projects.map((p) => [p.label, p.count, p.current]), [["b", 1, false], ["gone", 0, true]]);
  assert.equal(projectOf(m.projects[1]), "/home/test/gone");
});

test("normalizeScope: each call gives its own scope object", () => {
  const a = normalizeScope(null);
  a.thread = "changed";
  assert.deepEqual(normalizeScope(null), scope({ where: "follow" }));
  assert.notEqual(normalizeScope({ kind: "follow" }), normalizeScope({ kind: "follow" }));
});

test("taskPaneTitle: the number and title of the shown task, else the panel name", () => {
  assert.equal(taskPaneTitle(12, "Example task"), "T12 · Example task");
  assert.equal(taskPaneTitle(12, null), "T12");
  assert.equal(taskPaneTitle(12, ""), "T12");
  assert.equal(taskPaneTitle(null, null), "Tasks");
});
