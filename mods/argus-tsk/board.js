// Pure board logic for the Tasks board: sections, scopes, labels and activity
// sentences. Rows are the camelCase objects built by model.js.

/**
 * @typedef {import("./model.js").TaskRow} TaskRow
 * @typedef {import("./model.js").Status} Status
 * @typedef {import("./model.js").Activity} Activity
 * @typedef {"needsYou"|"inMotion"|"onDeck"|"done"} SectionId
 * @typedef {{needsYou: TaskRow[], inMotion: TaskRow[], ready: TaskRow[], inbox: TaskRow[]}} BoardModel
 * @typedef {{kind: "desk"} | {kind: "all"} | {kind: "project", project: string}
 *   | {kind: "thread", name: string} | {kind: "assignee", name: string}} Scope
 *   The same shapes `listArgs` in tsk.js accepts.
 * @typedef {{key: string, label: string, scope: Scope, count: number}} SidebarItem
 * @typedef {{desk: SidebarItem, all: SidebarItem, projects: SidebarItem[],
 *   threads: SidebarItem[], assignees: SidebarItem[]}} SidebarModel
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
 * The rows a scope shows.
 * @param {TaskRow[]} rows
 * @param {Scope} scope
 * @returns {TaskRow[]}
 */
export function rowsInScope(rows, scope) {
  switch (scope.kind) {
    case "desk":
      return rows.filter(onDesk);
    case "project":
      return rows.filter((r) => r.project === scope.project);
    case "thread":
      return rows.filter((r) => r.thread === scope.name);
    case "assignee":
      return rows.filter((r) => r.assignee === scope.name);
    default:
      return [...rows];
  }
}

/**
 * A scope read back from shared state; anything malformed is the desk.
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const text = (x) => typeof x === "string" && x !== "";
  switch (v.kind) {
    case "all":
      return { kind: "all" };
    case "project":
      return text(v.project) ? { kind: "project", project: /** @type {string} */ (v.project) } : { kind: "desk" };
    case "thread":
    case "assignee":
      return text(v.name) ? { kind: v.kind, name: /** @type {string} */ (v.name) } : { kind: "desk" };
    default:
      return { kind: "desk" };
  }
}

/**
 * The sidebar for a live listing of every row; counts come from `rowsInScope`.
 * @param {TaskRow[]} allRows
 * @returns {SidebarModel}
 */
export function sidebarModel(allRows) {
  /** @type {(scope: Scope) => number} */
  const count = (scope) => rowsInScope(allRows, scope).length;
  const labels = projectLabelsOf(allRows);
  const projects = tally(allRows.map((r) => r.project))
    .map(([project]) => ({
      key: `project:${project}`,
      label: labels.get(project) ?? project,
      scope: { kind: "project", project },
      count: count({ kind: "project", project }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    desk: { key: "desk", label: "Desk", scope: { kind: "desk" }, count: count({ kind: "desk" }) },
    all: { key: "all", label: "All Projects", scope: { kind: "all" }, count: allRows.length },
    projects,
    threads: tally(allRows.map((r) => r.thread)).map(([name]) => ({
      key: `thread:${name}`,
      label: name,
      scope: { kind: "thread", name },
      count: count({ kind: "thread", name }),
    })),
    assignees: tally(allRows.map((r) => r.assignee)).map(([name]) => ({
      key: `assignee:${name}`,
      label: name,
      scope: { kind: "assignee", name },
      count: count({ kind: "assignee", name }),
    })),
  };
}

/**
 * True when both scopes name the same view, project, thread or assignee.
 * @param {Scope} a
 * @param {Scope} b
 * @returns {boolean}
 */
export function sameScope(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The name the sidebar gives a scope. A project with no rows left shows its folder name.
 * @param {Scope} scope
 * @param {SidebarModel} model
 * @returns {string}
 */
export function scopeTitle(scope, model) {
  switch (scope.kind) {
    case "desk":
      return model.desk.label;
    case "all":
      return model.all.label;
    case "project": {
      const item = model.projects.find((p) => p.key === `project:${scope.project}`);
      return item?.label ?? segments(scope.project).pop() ?? scope.project;
    }
    default:
      return scope.name;
  }
}

/**
 * Where a task captured from a scope lands: a project scope names the project, a thread
 * scope the thread, an assignee scope the assignee; the rest is the desk.
 * @param {Scope} scope
 * @returns {{project: ?string, thread: ?string, assignee: ?string}}
 */
export function captureTarget(scope) {
  const target = { project: null, thread: null, assignee: null };
  switch (scope.kind) {
    case "project":
      return { ...target, project: scope.project };
    case "thread":
      return { ...target, thread: scope.name };
    case "assignee":
      return { ...target, assignee: scope.name };
    default:
      return target;
  }
}

/**
 * Each project's label, keyed by path: the folder name, widened one parent folder at a time
 * until it differs from the other projects' labels.
 * @param {TaskRow[]} rows
 * @returns {Map<string, string>}
 */
export function projectLabelsOf(rows) {
  const paths = [...new Set(rows.map((r) => r.project).filter((p) => typeof p === "string" && p !== ""))];
  const parts = new Map(paths.map((path) => [path, segments(path)]));
  const depth = new Map(paths.map((path) => [path, 1]));
  const labelOf = (path) => {
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
    const byLabel = (labels.get(a.project) ?? a.project).localeCompare(labels.get(b.project) ?? b.project);
    return byLabel !== 0 ? byLabel : a.project.localeCompare(b.project);
  });
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
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
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
