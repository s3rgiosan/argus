// Pure board logic for the issues board: assembling reads, scopes, groups, filter and row text.
// Issues are the objects built by model.js; the scope, group and
// kept-list rules shared with other forge boards come from lib/forge-board.js.

import { issueKey } from "./model.js";
import { projectKey } from "./remote.js";
import { isObject, isStringArray } from "./forge-cli.js";
import {
  KEEP_LIST_MS,
  emptyMessage as emptyText,
  groupItems,
  itemsByKeys,
  keptLists as keptItems,
  normalizeScope as normalizeShowWhere,
  paneTitle,
  rowSignature,
  scopeItems as scopeRows,
  scopeProjects,
  scopeTitle as titleOf,
  shownOrder as orderOf,
  whereKey,
} from "./forge-board.js";

/**
 * @typedef {import("./model.js").Issue} Issue
 * @typedef {import("./remote.js").Project} Project
 * @typedef {"assigned" | "created" | "mentions" | "all"} Show
 * @typedef {{show: Show, where: "all" | "follow"} | {show: Show, where: "project", key: string}} Scope
 * @typedef {"repo" | "assignee" | "label"} Grouping
 * @typedef {{issues: Issue[], scopes: {assigned: string[], created: string[], mentions: string[], projects: Record<string, string[]>}, projects: Project[], folders: string[], readAt: number, notes: string[], listedAt: Record<string, number>, worked: string[]}} Board
 *   `listedAt` holds the time of the last successful issue list of each project, keyed by `projectKey`.
 *   `worked` holds the ids of the reads that worked in the last read: the project key of a project list, `searchRead` of a search.
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} Item
 */

/** The Show choices, as [id, label]; the first is the default. */
export const SHOWS = /** @type {Array<[Show, string]>} */ ([
  ["assigned", "Assigned to me"],
  ["created", "Created by me"],
  ["mentions", "Mentions me"],
  ["all", "All open"],
]);

/** The Group by choices, as [id, label]; the first is the default. */
export const GROUPINGS = /** @type {Array<[Grouping, string]>} */ ([
  ["repo", "Repo"],
  ["assignee", "Assignee"],
  ["label", "Label"],
]);

// Board

/** @returns {Board} */
function emptyBoard() {
  return { issues: [], scopes: { assigned: [], created: [], mentions: [], projects: {} }, projects: [], folders: [], readAt: 0, notes: [], listedAt: {}, worked: [] };
}

/**
 * Builds the shared board from one read. Issues are deduplicated by key; the first copy read wins.
 * @param {{projects: Project[], folders: string[], assigned: Issue[], created: Issue[], mentions: Issue[], projectIssues: Record<string, Issue[]>, notes: string[], readAt: number, listedAt?: Record<string, number>, worked?: string[]}} input
 * @returns {Board}
 */
export function assembleBoard(input) {
  const byKey = new Map();
  const keysOf = (list) => {
    const keys = [];
    for (const issue of list) {
      const key = issueKey(issue);
      if (keys.includes(key)) continue;
      keys.push(key);
      if (!byKey.has(key)) byKey.set(key, issue);
    }
    return keys;
  };
  const scopes = { assigned: keysOf(input.assigned), created: keysOf(input.created), mentions: keysOf(input.mentions), projects: {} };
  for (const project of input.projects) scopes.projects[project.key] = keysOf(input.projectIssues[project.key] ?? []);
  return { issues: [...byKey.values()], scopes, projects: input.projects, folders: input.folders, readAt: input.readAt, notes: input.notes, listedAt: input.listedAt ?? {}, worked: input.worked ?? [] };
}

/**
 * A well-formed board, or the empty board for anything else. Bad list times and a bad list of reads that worked mean none.
 * @param {unknown} value
 * @returns {Board}
 */
export function normalizeBoard(value) {
  if (!isObject(value) || !isObject(value.scopes)) return emptyBoard();
  const { scopes } = value;
  const valid =
    Array.isArray(value.issues) &&
    value.issues.every(isObject) &&
    Array.isArray(value.projects) &&
    value.projects.every(isObject) &&
    isStringArray(value.folders) &&
    isStringArray(value.notes) &&
    typeof value.readAt === "number" &&
    isStringArray(scopes.assigned) &&
    isStringArray(scopes.created) &&
    isStringArray(scopes.mentions) &&
    isObject(scopes.projects) &&
    Object.values(scopes.projects).every(isStringArray);
  if (!valid) return emptyBoard();
  const listedAt = isObject(value.listedAt) && Object.values(value.listedAt).every((time) => Number.isFinite(time) && time >= 0) ? value.listedAt : {};
  const worked = isStringArray(value.worked) ? value.worked : [];
  return /** @type {Board} */ ({ ...value, listedAt, worked });
}

/**
 * The issues of the previous board for the projects whose list failed in this read, kept for
 * KEEP_LIST_MS after their last successful list (`keptLists` in lib/forge-board.js).
 * @param {Board} previous
 * @param {string[]} failedKeys Project keys whose list failed.
 * @param {number} now
 * @returns {{issues: Issue[], projectIssues: Record<string, Issue[]>, listedAt: Record<string, number>}}
 */
export function keptLists(previous, failedKeys, now) {
  const kept = keptItems(previous, failedKeys, now, { items: previous.issues, keyOf: issueKey, keepMs: KEEP_LIST_MS });
  return { issues: kept.items, projectIssues: kept.projectItems, listedAt: kept.listedAt };
}

// Scopes

/**
 * The scope: which issues to show (Show) and from which repos (In).
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  return /** @type {Scope} */ (normalizeShowWhere(value, SHOWS));
}

/**
 * The issues a scope shows. All open in all repos is every issue on the board.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Issue[]}
 */
export function issuesInScope(board, scope, followed) {
  const where = whereKey(scope, followed);
  if (where === undefined) return [];
  let issues;
  switch (scope.show) {
    case "assigned":
    case "created":
    case "mentions":
      issues = itemsByKeys(board.issues, board.scopes[scope.show], issueKey);
      break;
    default:
      issues = where === null ? board.issues : itemsByKeys(board.issues, board.scopes.projects[where] ?? [], issueKey);
  }
  return where === null ? issues : issues.filter((issue) => projectKey(issue) === where);
}

/**
 * The rows of the scope list, with the count of issues each choice shows.
 * @param {Board} board
 * @param {?string} followed
 * @param {Scope} scope The current scope.
 * @returns {{show: Item[], where: Item[], projects: Item[]}}
 */
export function scopeItems(board, followed, scope) {
  return /** @type {{show: Item[], where: Item[], projects: Item[]}} */ (scopeRows(board, followed, scope, { shows: SHOWS, count: (next) => issuesInScope(board, /** @type {Scope} */ (next), followed).length }));
}

/**
 * The scope button text: the Show choice, then the repo when In is not All repos.
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeTitle(scope, board, followed) {
  return titleOf(scope, board, followed, SHOWS);
}

/**
 * The note for Mentions me when the scope holds a GitLab project: GitLab has no mention search
 * for issues, so its issues do not show there. Null otherwise.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {string|null}
 */
export function mentionsNote(board, scope, followed) {
  if (scope.show !== "mentions") return null;
  const gitlab = scopeProjects(board, scope, followed).some((project) => project.provider === "gitlab");
  return gitlab ? "GitLab has no search for mentions, so GitLab issues do not show here." : null;
}

// Groups

/**
 * The Group by choice: "repo" (the default), "assignee" or "label".
 * @param {unknown} value
 * @returns {Grouping}
 */
export function normalizeGrouping(value) {
  const found = GROUPINGS.find(([id]) => id === value);
  return found ? found[0] : GROUPINGS[0][0];
}

/**
 * The groups an issue shows in for a Group by choice: its repo, each of its assignees, or each of
 * its labels. An assignee is one login on one host. Labels of the same name in any case share a group.
 * @param {Issue} issue
 * @param {Grouping} by
 * @returns {Array<{key: string, title: string}>}
 */
function groupsOf(issue, by) {
  switch (by) {
    case "assignee":
      return issue.assignees.map((person) => ({ key: `${issue.host}/${person.login}`.toLowerCase(), title: person.login }));
    case "label":
      return issue.labels.map((label) => ({ key: label.toLowerCase(), title: label }));
    default:
      return [{ key: projectKey(issue), title: issue.repo }];
  }
}

/** The group of the issues that have no assignee or no label, by Group by choice. */
const NONE_GROUPS = { assignee: "No assignee", label: "No label" };

/**
 * The board's groups for a Group by choice, A to Z, each with its issues newest update first
 * (then the higher number). An issue with several assignees or labels shows under each one; an
 * issue with none shows under "No assignee" or "No label", the last group.
 * @param {Issue[]} issues
 * @param {Grouping} [by]
 * @returns {Array<{key: string, title: string, issues: Issue[]}>}
 */
export function buildGroups(issues, by = "repo") {
  const time = (issue) => Date.parse(issue.updatedAt) || 0;
  const newest = [...issues].sort((a, b) => time(b) - time(a) || b.number - a.number);
  const none = { key: "", title: Object.hasOwn(NONE_GROUPS, by) ? NONE_GROUPS[by] : "" };
  return groupItems(newest, (issue) => groupsOf(issue, by), none).map((group) => ({ key: group.key, title: group.title, issues: group.items }));
}

/**
 * The issue keys in the order the board shows them for `scope` and `by`. An issue in several
 * groups counts once, at its first place.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @param {Grouping} [by]
 * @returns {string[]}
 */
export function shownOrder(board, scope, followed, by = "repo") {
  return orderOf(
    buildGroups(issuesInScope(board, scope, followed), by).map((group) => group.issues),
    issueKey,
  );
}

// Filter and row text

/**
 * True when the filter text is in the title, the author, a label or an assignee, or starts the number.
 * @param {Issue} issue
 * @param {string} text
 * @returns {boolean}
 */
export function matchesFilter(issue, text) {
  const needle = text.trim().toLowerCase();
  if (needle === "") return true;
  const fields = [issue.title, issue.author, issue.authorName, ...issue.labels, ...issue.assignees.flatMap((person) => [person.login, person.name])];
  if (fields.some((field) => String(field ?? "").toLowerCase().includes(needle))) return true;
  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  return digits !== "" && String(issue.number).startsWith(digits);
}

/**
 * The second line of a row: the author, then the labels.
 * @param {Issue} issue
 * @returns {string}
 */
export function rowDetail(issue) {
  const by = issue.author === "" ? "" : `by ${issue.author}`;
  return [by, issue.labels.join(", ")].filter((part) => part !== "").join(" · ");
}

/**
 * The assignees of a row: the first login, then how many more; "" with none.
 * @param {Issue} issue
 * @returns {string}
 */
export function assigneesText(issue) {
  const [first, ...rest] = issue.assignees;
  if (!first) return "";
  return rest.length === 0 ? first.login : `${first.login} +${rest.length}`;
}

/**
 * The text of an empty issue list, as `emptyMessage` in lib/forge-board.js gives it.
 * @param {Board} board
 * @param {Array<{provider: string, host: string}>} [repos] The repos the scope shows (`scopeRepos`).
 * @param {string[]} [reads] The reads that give the scope's issues (`scopeReads`).
 * @returns {string}
 */
export function emptyMessage(board, repos = [], reads = []) {
  return emptyText(board, repos, { failed: "No issues could be read. See the messages above.", none: "No open issues here" }, reads);
}

/**
 * The title the pane header shows for the issue pane: the issue's number and title, the number
 * alone without a title, else the panel name.
 * @param {{number: number, title: string} | null} issue
 * @returns {string}
 */
export function issuePaneTitle(issue) {
  return paneTitle(issue, "Issues");
}

/**
 * A text for the parts of a board row that the issue pane shows, or null when there is no row.
 * A change of it makes the pane read its issue again (`rereadDue`).
 * @param {Issue|null|undefined} issue
 * @returns {string|null}
 */
export function issueSignature(issue) {
  return rowSignature(issue, (row) => [row.updatedAt, row.state, row.title, row.comments, row.labels.join(","), row.assignees.map((person) => person.login).join(",")]);
}

// New worktree

/** The reason the pane gives when no open space holds a clone of the issue's repo. */
export const NO_CLONE = "No local checkout of this repo is open, so no worktree can start here.";

/**
 * The project that New worktree starts the issue's worktree in: the board's project of the
 * issue's repo when it has a local checkout. Else `project` is null and `reason` says why.
 * @param {Project[]} projects
 * @param {{host: string, repo: string}} issue
 * @returns {{project: Project, reason: null} | {project: null, reason: string}}
 */
export function worktreeTarget(projects, issue) {
  const key = projectKey(issue);
  const project = projects.find((entry) => entry.key === key && typeof entry.localPath === "string" && entry.localPath !== "");
  return project ? { project, reason: null } : { project: null, reason: NO_CLONE };
}

/**
 * What the pane footer shows for New worktree: why it cannot start (or null), whether a start
 * for this issue runs, whether any start of this pane runs (`busy`, one at a time), and the
 * error and note of the last start for this issue.
 * @param {{reason: string|null}} target `worktreeTarget` of the issue.
 * @param {{running: boolean, error: string|null, note: string|null}|undefined} run This pane's last start for the issue.
 * @param {boolean} busy
 * @returns {{reason: string|null, running: boolean, busy: boolean, error: string|null, note: string|null}}
 */
export function worktreeState(target, run, busy) {
  const running = run?.running === true;
  return { reason: target.reason, running, busy: busy || running, error: run?.error ?? null, note: run?.note ?? null };
}
