// Pure board logic for the Tasks board: sections, scopes, labels and activity
// sentences. Rows are the camelCase objects built by model.js.

import { compareNames, followFolder, followedProject } from "./follow.js";

export { compareNames, followFolder, followedProject };

/**
 * @typedef {import("./model.js").TaskRow} TaskRow
 * @typedef {import("./model.js").Status} Status
 * @typedef {import("./model.js").Activity} Activity
 * @typedef {"needsYou"|"inMotion"|"onDeck"|"done"} SectionId
 * @typedef {{needsYou: TaskRow[], inMotion: TaskRow[], ready: TaskRow[], inbox: TaskRow[]}} BoardModel
 * @typedef {{where: "follow"|"desk"|"all", thread: ?string, assignee: ?string}
 *   | {where: "project", project: string, thread: ?string, assignee: ?string}} Scope
 *   `where` is the place: the project of the focused space, the desk, every project or
 *   one project. A thread or an assignee, when set, keeps only the rows that have it.
 *   `effectiveScope` turns `follow` into a project or the desk.
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} SidebarItem
 *   `scope` is the current scope with only this row's choice changed.
 * @typedef {SidebarItem & {title: ?string, folder: string}} ProjectItem `title` is the
 *   project's title, null when it has none; `folder` is its folder name.
 * @typedef {{where: SidebarItem[], projects: ProjectItem[], threads: SidebarItem[],
 *   assignees: SidebarItem[]}} SidebarModel
 * @typedef {"default"|"you"|"task"|"agent"|"other"} WaitsKind
 */

/** The name each status shows under, wherever a status is named. */
export const STATUS_LABELS = {
  open: "Open",
  ready: "Ready",
  started: "Started",
  blocked: "Blocked",
  review: "In Review",
  done: "Done",
  unknown: "Unknown",
};

// Sections

/**
 * The section a row belongs to.
 * @param {TaskRow} row
 * @param {ReadonlySet<number>} liveNumbers
 * @returns {SectionId}
 */
export function sectionOf(row, liveNumbers) {
  switch (row.status) {
    case "blocked":
    case "review":
      return waitSection((row.block ?? row.review)?.on, liveNumbers);
    case "started":
      return "inMotion";
    case "done":
      return "done";
    default:
      return "onDeck";
  }
}

/**
 * Splits rows into the four board lists, keeping row order. Done rows are dropped.
 * @param {TaskRow[]} rows
 * @param {ReadonlySet<number>} liveNumbers
 * @returns {BoardModel}
 */
export function buildBoard(rows, liveNumbers) {
  const board = { needsYou: [], inMotion: [], ready: [], inbox: [] };
  for (const row of rows) {
    switch (sectionOf(row, liveNumbers)) {
      case "needsYou":
        board.needsYou.push(row);
        break;
      case "inMotion":
        board.inMotion.push(row);
        break;
      case "onDeck":
        if (row.status === "ready") {
          board.ready.push(row);
        } else {
          board.inbox.push(row);
        }
        break;
      default:
        break;
    }
  }
  return board;
}

/**
 * Numbers of every non-done row in the `--all` live listing.
 * @param {TaskRow[]} allRows
 * @returns {Set<number>}
 */
export function liveNumbersOf(allRows) {
  return new Set(allRows.filter((r) => r.status !== "done").map((r) => r.number));
}

/** @returns {SectionId} */
function waitSection(on, liveNumbers) {
  if (on === undefined || on === "you") {
    return "needsYou";
  }
  const match = /^task:(\d+)$/.exec(on);
  if (match) {
    return liveNumbers.has(Number(match[1])) ? "inMotion" : "needsYou";
  }
  return "inMotion";
}

// Waits

/**
 * Splits a stored `block.on` / `review.on` into a control kind and the value tsk accepts back.
 * @param {string} on
 * @returns {{kind: WaitsKind, value: string}}
 */
export function onToInput(on) {
  if (on === "you") return { kind: "you", value: "" };
  const task = /^task:(\d+)$/.exec(on);
  if (task) return { kind: "task", value: `T${task[1]}` };
  if (on.startsWith("other:")) return { kind: "other", value: on.slice("other:".length) };
  if (on.startsWith("agent:")) return { kind: "agent", value: on.slice("agent:".length) };
  return { kind: "agent", value: on };
}

/**
 * The `--on` value for a control state, or null to leave it unset.
 * @param {WaitsKind} kind
 * @param {string} value
 * @returns {?string}
 */
export function inputToOn(kind, value) {
  switch (kind) {
    case "you":
      return "you";
    case "default":
      return null;
    default:
      return value === "" ? null : value;
  }
}

// Scopes and sidebar

/**
 * True when the row is on the terminal desk: blocked, review and started rows from every
 * project, plus desk rows that are ready or open. An unknown status counts as open.
 * @param {TaskRow} row
 * @returns {boolean}
 */
export function onDesk(row) {
  switch (row.status) {
    case "blocked":
    case "review":
    case "started":
      return true;
    case "ready":
    case "open":
    case "unknown":
      return row.project === null;
    default:
      return false;
  }
}

/**
 * The scope when nothing is stored: the focused space, with no thread or assignee.
 * @returns {Scope}
 */
function follow() {
  return { where: "follow", thread: null, assignee: null };
}

/**
 * The rows a scope shows. Follow shows the rows of `followed`, else the desk.
 * @param {TaskRow[]} rows
 * @param {Scope} scope
 * @param {?string} [followed] the project the focused space is in
 * @returns {TaskRow[]}
 */
export function rowsInScope(rows, scope, followed = null) {
  const shown = effectiveScope(scope, followed);
  return rows.filter((r) => {
    if (shown.thread !== null && r.thread !== shown.thread) return false;
    if (shown.assignee !== null && r.assignee !== shown.assignee) return false;
    switch (shown.where) {
      case "desk":
        return onDesk(r);
      case "project":
        return r.project === shown.project;
      default:
        return true;
    }
  });
}

/**
 * A scope read back from shared state. No stored scope follows the space, and
 * anything malformed is the desk. A scope saved as one `kind` maps onto the place
 * and the filters: a thread or an assignee kind shows that one across all projects.
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  if (value === null || value === undefined) return follow();
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const text = (x) => (typeof x === "string" && x !== "" ? x : null);
  const desk = /** @type {Scope} */ ({ where: "desk", thread: null, assignee: null });
  if (typeof v.kind === "string") {
    switch (v.kind) {
      case "follow":
        return follow();
      case "all":
        return { where: "all", thread: null, assignee: null };
      case "project": {
        const project = text(v.project);
        return project === null ? desk : { where: "project", project, thread: null, assignee: null };
      }
      case "thread":
      case "assignee": {
        const name = text(v.name);
        if (name === null) return desk;
        return { where: "all", thread: v.kind === "thread" ? name : null, assignee: v.kind === "assignee" ? name : null };
      }
      default:
        return desk;
    }
  }
  const filters = { thread: text(v.thread), assignee: text(v.assignee) };
  switch (v.where) {
    case "follow":
    case "all":
      return { where: v.where, ...filters };
    case "project": {
      const project = text(v.project);
      return project === null ? { where: "desk", ...filters } : { where: "project", project, ...filters };
    }
    default:
      return { where: "desk", ...filters };
  }
}

/**
 * The scope list for a live listing of every row: the places, the projects, then the
 * threads and the assignees, each led by a row that clears it. Each row keeps the
 * other choices of `scope` as they are, and its count is what picking it shows. A
 * thread or an assignee that is picked but has no rows left stays in its list.
 * @param {TaskRow[]} allRows
 * @param {?string} [followed] the project the focused space is in
 * @param {Scope} [scope] the current scope
 * @returns {SidebarModel}
 */
export function sidebarModel(allRows, followed = null, scope = follow()) {
  const key = JSON.stringify([followed, scope]);
  if (sidebarMemo !== null && sidebarMemo.rows === allRows && sidebarMemo.key === key) return sidebarMemo.model;
  const model = buildSidebarModel(allRows, followed, scope);
  sidebarMemo = { rows: allRows, key, model };
  return model;
}

/** The last `sidebarModel` result, reused while its rows, followed project and scope are the same. */
let sidebarMemo = null;

function buildSidebarModel(allRows, followed, scope) {
  const filters = { thread: scope.thread, assignee: scope.assignee };
  const item = (key, label, next, current) => ({ key, label, scope: next, count: rowsInScope(allRows, next, followed).length, current });
  const labels = projectLabelsOf(allRows);
  const titles = projectTitlesOf(allRows);
  const paths = tally(allRows.map((r) => r.project)).map(([project]) => project);
  // A picked project with no rows left stays in the list, so its row keeps the tick.
  if (scope.where === "project" && !paths.includes(scope.project)) paths.push(scope.project);
  const projects = paths
    .map((project) => ({
      ...item(
        `project:${project}`,
        labels.get(project) ?? segments(project).pop() ?? project,
        /** @type {Scope} */ ({ where: "project", project, ...filters }),
        scope.where === "project" && scope.project === project,
      ),
      title: titles.get(project) ?? null,
      folder: segments(project).pop() ?? project,
    }))
    .sort((a, b) => compareNames(a.label, b.label));
  const place = (where, label) => item(where, label, /** @type {Scope} */ ({ where, ...filters }), scope.where === where);
  /**
   * @param {"thread"|"assignee"} field
   * @param {string} anyLabel
   */
  const filterItems = (field, anyLabel) => {
    const names = tally(allRows.map((r) => r[field])).map(([name]) => name);
    const picked = scope[field];
    if (picked !== null && !names.includes(picked)) names.push(picked);
    names.sort(compareNames);
    return [
      item(`${field}:`, anyLabel, { ...scope, [field]: null }, picked === null),
      ...names.map((name) => item(`${field}:${name}`, name, { ...scope, [field]: name }, picked === name)),
    ];
  };
  return {
    where: [place("follow", "Follow space"), place("desk", "Desk"), place("all", "All Projects")],
    projects,
    threads: filterItems("thread", "Any thread"),
    assignees: filterItems("assignee", "Anyone"),
  };
}

/**
 * The project a scope list row picks, or null for a row that is not a project. A
 * thread or assignee row keeps a project place too, so the row's key decides.
 * @param {SidebarItem} item
 * @returns {?string}
 */
export function projectOf(item) {
  return item.key.startsWith("project:") && item.scope.where === "project" ? item.scope.project : null;
}

/**
 * The scope button text: the place, then the thread and the assignee when set. A
 * project with no rows left shows its folder name. Follow adds the name of what it follows.
 * @param {Scope} scope
 * @param {SidebarModel} model
 * @param {?string} [followed] the project the focused space is in
 * @returns {string}
 */
export function scopeTitle(scope, model, followed = null) {
  const labelOf = (where) => model.where.find((i) => i.key === where)?.label ?? where;
  let place;
  switch (scope.where) {
    case "follow": {
      const shown = effectiveScope(scope, followed);
      place = `${labelOf("follow")} · ${shown.where === "project" ? projectLabel(shown.project, model) : labelOf("desk")}`;
      break;
    }
    case "project":
      place = projectLabel(scope.project, model);
      break;
    default:
      place = labelOf(scope.where);
  }
  return [place, scope.thread, scope.assignee].filter((part) => part !== null).join(" · ");
}

/**
 * The name the scope list gives a project, or its folder name when it has no rows left.
 * @param {string} project
 * @param {SidebarModel} model
 * @returns {string}
 */
function projectLabel(project, model) {
  const item = model.projects.find((p) => p.key === `project:${project}`);
  return item?.label ?? segments(project).pop() ?? project;
}

/**
 * The scope the board lists: follow becomes the followed project, else the desk.
 * The thread and the assignee stay.
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {Scope}
 */
export function effectiveScope(scope, followed) {
  if (scope.where !== "follow") return scope;
  const filters = { thread: scope.thread, assignee: scope.assignee };
  return followed ? { where: "project", project: followed, ...filters } : { where: "desk", ...filters };
}

/**
 * Where a task captured from a scope lands: the project of a project scope, else the
 * desk, with the scope's thread and assignee.
 * @param {Scope} scope
 * @returns {{project: ?string, thread: ?string, assignee: ?string}}
 */
export function captureTarget(scope) {
  return { project: scope.where === "project" ? scope.project : null, thread: scope.thread, assignee: scope.assignee };
}

/**
 * Each project's label, keyed by path: its title when it has one, else the folder name,
 * widened one parent folder at a time until it differs from the other projects' labels.
 * @param {TaskRow[]} rows
 * @returns {Map<string, string>}
 */
export function projectLabelsOf(rows) {
  const titles = projectTitlesOf(rows);
  const paths = [...new Set(rows.map((r) => r.project).filter((p) => typeof p === "string" && p !== ""))];
  const parts = new Map(paths.map((path) => [path, segments(path)]));
  const depth = new Map(paths.map((path) => [path, 1]));
  const labelOf = (path) => {
    const title = titles.get(path);
    if (title !== undefined) return title;
    const own = parts.get(path) ?? [];
    return own.length === 0 ? path : own.slice(-(depth.get(path) ?? 1)).join("/");
  };
  let widened = true;
  while (widened) {
    widened = false;
    const groups = new Map();
    for (const path of paths) {
      const label = labelOf(path);
      groups.set(label, [...(groups.get(label) ?? []), path]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const path of group) {
        // A title is fixed, so only a folder label widens.
        if (titles.has(path)) continue;
        const current = depth.get(path) ?? 1;
        if (current < (parts.get(path) ?? []).length) {
          depth.set(path, current + 1);
          widened = true;
        }
      }
    }
  }
  return new Map(paths.map((path) => [path, labelOf(path)]));
}

/**
 * Rows sorted A-Z by project label, desk rows last. Rows of one project stay together, in order.
 * @param {TaskRow[]} rows
 * @param {Map<string, string>} labels
 * @returns {TaskRow[]}
 */
export function sortByProject(rows, labels) {
  return [...rows].sort((a, b) => {
    if (a.project === b.project) return 0;
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    const byLabel = compareNames(labels.get(a.project) ?? a.project, labels.get(b.project) ?? b.project);
    return byLabel !== 0 ? byLabel : compareNames(a.project, b.project);
  });
}

/**
 * What the field in the scopes popup saves for a project: null when there is nothing
 * to save (the prefill is unchanged, or an empty field for a project without a title),
 * else the new title, null to clear it. The prefill is the title, else the folder name.
 * @param {{title: ?string, folder: string}} item
 * @param {string} value the field's text
 * @returns {?{title: ?string}}
 */
export function titleChange(item, value) {
  const next = String(value ?? "").trim();
  const prefill = item.title ?? item.folder;
  if (next === prefill) return null;
  if (next === "") return item.title === null ? null : { title: null };
  return { title: next };
}

/**
 * Why tsk would refuse a project title, or null when it is fine. tsk reads a title
 * that starts with "-" as an option.
 * @param {?string} title null clears the title
 * @returns {?string}
 */
export function titleError(title) {
  if (title !== null && title.startsWith("-")) return "A title cannot start with a dash.";
  return null;
}

/** Each titled project's title, keyed by path. Rows read before tsk 0.14 have none. */
function projectTitlesOf(rows) {
  const titles = new Map();
  for (const row of rows) {
    const title = row.projectTitle;
    if (typeof row.project === "string" && typeof title === "string" && title !== "" && !titles.has(row.project)) {
      titles.set(row.project, title);
    }
  }
  return titles;
}

function segments(path) {
  return path.split(/[\\/]+/).filter((s) => s !== "");
}

/** Distinct non-empty values with their counts, sorted A-Z by value. */
function tally(values) {
  const counts = new Map();
  for (const v of values) {
    if (typeof v === "string" && v !== "") {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a], [b]) => compareNames(a, b));
}

// Activity

/** A field of an entry's detail when it is a string. */
function field(detail, name) {
  if (typeof detail !== "object" || detail === null) return null;
  const value = detail[name];
  return typeof value === "string" ? value : null;
}

function statusName(value) {
  return value !== null && Object.hasOwn(STATUS_LABELS, value) ? STATUS_LABELS[value] : null;
}

/**
 * What an activity verb says: `by` reads as "alex added this task", `alone` has no person.
 * Null for a verb this table does not know.
 * @returns {?{by: string, alone: string}}
 */
function phrase(kind, detail) {
  switch (kind) {
    case "created":
      return { by: "added this task", alone: "Task added" };
    case "status_set": {
      const to = statusName(field(detail, "to"));
      return to === null
        ? { by: "changed the status", alone: "Status changed" }
        : { by: `changed the status to ${to}`, alone: `Status changed to ${to}` };
    }
    case "completed":
      return { by: "marked this done", alone: "Marked done" };
    case "reopened":
      return { by: "reopened this task", alone: "Reopened" };
    case "archived":
      return { by: "archived this task", alone: "Archived" };
    case "unarchived":
    case "restored":
      return { by: "restored this task", alone: "Restored" };
    case "step_added":
      return { by: "added a step", alone: "Step added" };
    case "step_checked":
      return { by: "checked a step", alone: "Step checked" };
    case "step_unchecked":
      return { by: "unchecked a step", alone: "Step unchecked" };
    case "step_renamed":
      return { by: "renamed a step", alone: "Step renamed" };
    case "step_removed":
      return { by: "removed a step", alone: "Step removed" };
    case "assigned": {
      const to = field(detail, "to") ?? field(detail, "assignee");
      return to === null
        ? { by: "changed the assignee", alone: "Assignee changed" }
        : { by: `assigned this to ${to}`, alone: `Assigned to ${to}` };
    }
    case "dispatched":
      return { by: "launched an agent", alone: "Agent launched" };
    case "replied":
      return { by: "replied", alone: "Reply added" };
    case "block_edited":
      return { by: "edited the block", alone: "Block edited" };
    case "review_edited":
      return { by: "edited the review", alone: "Review edited" };
    case "on_set":
      return { by: "changed who it waits on", alone: "Waiting on changed" };
    default: {
      const status = statusName(kind);
      return status === null ? null : { by: `changed the status to ${status}`, alone: `Status changed to ${status}` };
    }
  }
}

/**
 * An activity entry as a sentence. An unknown verb shows as tsk wrote it.
 * @param {Activity} entry
 * @returns {string}
 */
export function activitySentence(entry) {
  const known = phrase(entry.kind, entry.detail);
  if (known === null) {
    const detail = typeof entry.detail === "string" ? `: ${entry.detail}` : "";
    return `${entry.by ? `${entry.by} ` : ""}${entry.kind}${detail}`;
  }
  return entry.by ? `${entry.by} ${known.by}` : known.alone;
}

/**
 * The title the pane header shows for the task pane: the shown task's number and
 * title, the number alone while the title is not known, else the panel name.
 * @param {?number} number
 * @param {?string} title
 * @returns {string}
 */
export function taskPaneTitle(number, title) {
  if (number === null) return "Tasks";
  return title ? `T${number} · ${title}` : `T${number}`;
}
