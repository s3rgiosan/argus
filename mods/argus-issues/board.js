// Pure board logic for the issues board: assembling reads, scopes, groups, filter and row text.
// Issues are the objects built by model.js; the scope, group and
// kept-list rules shared with other forge boards come from lib/forge-board.js.

import { issueKey } from "./model.js";
import { projectKey } from "./remote.js";
import { isObject } from "./forge-cli.js";
import {
  KEEP_LIST_MS,
  emptyMessage as emptyText,
  groupItems,
  itemsByKeys,
  keptLists as keptItems,
  normalizeScope as normalizeShowWhere,
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
 * @typedef {{issues: Issue[], scopes: {assigned: string[], created: string[], mentions: string[], projects: Record<string, string[]>}, projects: Project[], folders: string[], readAt: number, notes: string[], listedAt: Record<string, number>}} Board
 *   `listedAt` holds the time of the last successful issue list of each project, keyed by `projectKey`.
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} Item
 */

/** The Show choices, as [id, label]; the first is the default. */
export const SHOWS = /** @type {Array<[Show, string]>} */ ([
  ["assigned", "Assigned to me"],
  ["created", "Created by me"],
  ["mentions", "Mentions me"],
  ["all", "All open"],
]);

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Board

/** @returns {Board} */
function emptyBoard() {
  return { issues: [], scopes: { assigned: [], created: [], mentions: [], projects: {} }, projects: [], folders: [], readAt: 0, notes: [], listedAt: {} };
}

/**
 * Builds the shared board from one read. Issues are deduplicated by key; the first copy read wins.
 * @param {{projects: Project[], folders: string[], assigned: Issue[], created: Issue[], mentions: Issue[], projectIssues: Record<string, Issue[]>, notes: string[], readAt: number, listedAt?: Record<string, number>}} input
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
  return { issues: [...byKey.values()], scopes, projects: input.projects, folders: input.folders, readAt: input.readAt, notes: input.notes, listedAt: input.listedAt ?? {} };
}

/**
 * A well-formed board, or the empty board for anything else. Bad list times mean none.
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
  return /** @type {Board} */ ({ ...value, listedAt });
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
 * One group per repo, repos A to Z; newest update first inside a group, then the higher number.
 * @param {Issue[]} issues
 * @returns {Array<{key: string, title: string, issues: Issue[]}>}
 */
export function buildGroups(issues) {
  const time = (issue) => Date.parse(issue.updatedAt) || 0;
  const newest = [...issues].sort((a, b) => time(b) - time(a) || b.number - a.number);
  return groupItems(newest, (issue) => [{ key: projectKey(issue), title: issue.repo }], { key: "", title: "" }).map((group) => ({ key: group.key, title: group.title, issues: group.items }));
}

/**
 * The issue keys in the order the board shows them for `scope`.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {string[]}
 */
export function shownOrder(board, scope, followed) {
  return orderOf(
    buildGroups(issuesInScope(board, scope, followed)).map((group) => group.issues),
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
 * @returns {string}
 */
export function emptyMessage(board, repos = []) {
  return emptyText(board, repos, { failed: "No issues could be read. See the messages above.", none: "No open issues here" });
}

/**
 * The title the pane header shows for the issue pane: the issue's number and title, the number
 * alone without a title, else the panel name.
 * @param {{number: number, title: string} | null} issue
 * @returns {string}
 */
export function issuePaneTitle(issue) {
  if (issue === null) return "Issues";
  return issue.title ? `#${issue.number} · ${issue.title}` : `#${issue.number}`;
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
