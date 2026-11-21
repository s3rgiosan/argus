// Pure board logic for the issues board: assembling reads, scopes, groups, filter and row text.
// Issues are the objects built by model.js.

import { compareNames } from "./follow.js";
import { issueKey } from "./model.js";
import { projectKey } from "./remote.js";

/**
 * @typedef {import("./model.js").Issue} Issue
 * @typedef {import("./remote.js").Project} Project
 * @typedef {"assigned" | "created" | "mentions" | "all"} Show
 * @typedef {{show: Show, where: "all" | "follow"} | {show: Show, where: "project", key: string}} Scope
 * @typedef {{issues: Issue[], scopes: {assigned: string[], created: string[], mentions: string[], projects: Record<string, string[]>}, projects: Project[], folders: string[], readAt: number, notes: string[]}} Board
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} Item
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const SHOWS = /** @type {const} */ ([
  ["assigned", "Assigned to me"],
  ["created", "Created by me"],
  ["mentions", "Mentions me"],
  ["all", "All open"],
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Board

/** @returns {Board} */
function emptyBoard() {
  return { issues: [], scopes: { assigned: [], created: [], mentions: [], projects: {} }, projects: [], folders: [], readAt: 0, notes: [] };
}

/**
 * Builds the shared board from one read. Issues are deduplicated by key; the first copy read wins.
 * @param {{projects: Project[], folders: string[], assigned: Issue[], created: Issue[], mentions: Issue[], projectIssues: Record<string, Issue[]>, notes: string[], readAt: number}} input
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
  return { issues: [...byKey.values()], scopes, projects: input.projects, folders: input.folders, readAt: input.readAt, notes: input.notes };
}

/**
 * A well-formed board, or the empty board for anything else.
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
  return valid ? /** @type {Board} */ (value) : emptyBoard();
}

// Scopes

/**
 * The scope: which issues to show (Show) and from which repos (In).
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  if (!isObject(value)) return { show: "assigned", where: "all" };
  const show = SHOWS.some(([id]) => id === value.show) ? /** @type {Show} */ (value.show) : "assigned";
  switch (value.where) {
    case "follow":
      return { show, where: "follow" };
    case "project":
      return typeof value.key === "string" && value.key !== "" ? { show, where: "project", key: value.key } : { show, where: "all" };
    default:
      return { show, where: "all" };
  }
}

/**
 * The project key a scope limits to, null for all repos, or undefined when it
 * follows a space that is not a project.
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {string|null|undefined}
 */
function whereKey(scope, followed) {
  switch (scope.where) {
    case "follow":
      return followed ?? undefined;
    case "project":
      return scope.key;
    default:
      return null;
  }
}

/**
 * @param {Board} board
 * @param {string[]} keys
 * @returns {Issue[]}
 */
function issuesByKeys(board, keys) {
  const byKey = new Map(board.issues.map((issue) => [issueKey(issue), issue]));
  return keys.map((key) => byKey.get(key)).filter((issue) => issue !== undefined);
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
      issues = issuesByKeys(board, board.scopes[scope.show]);
      break;
    default:
      issues = where === null ? board.issues : issuesByKeys(board, board.scopes.projects[where] ?? []);
  }
  return where === null ? issues : issues.filter((issue) => projectKey(issue) === where);
}

/**
 * The rows of the scope list: the Show choices, then In (Follow space, All repos and each
 * project). Each row's count keeps the other choice as it is, and picking it changes only its own choice.
 * @param {Board} board
 * @param {?string} followed
 * @param {Scope} scope The current scope.
 * @returns {{show: Item[], where: Item[], projects: Item[]}}
 */
export function scopeItems(board, followed, scope) {
  const item = (key, label, next, current) => ({ key, label, scope: next, count: issuesInScope(board, next, followed).length, current });
  const keep = scope.where === "project" ? { where: "project", key: scope.key } : { where: scope.where };
  const show = SHOWS.map(([id, label]) => item(id, label, /** @type {Scope} */ ({ show: id, ...keep }), scope.show === id));
  const where = [
    item("follow", "Follow space", { show: scope.show, where: "follow" }, scope.where === "follow"),
    item("all", "All repos", { show: scope.show, where: "all" }, scope.where === "all"),
  ];
  const listed = board.projects.map((project) => ({ key: project.key, repo: project.repo }));
  // A picked project no longer on the board stays in the list, so its row keeps the tick.
  if (scope.where === "project" && !listed.some((project) => project.key === scope.key)) {
    listed.push({ key: scope.key, repo: keyRepo(scope.key) });
  }
  const projects = listed
    .sort((a, b) => compareNames(a.repo, b.repo))
    .map((project) => {
      const next = /** @type {Scope} */ ({ show: scope.show, where: "project", key: project.key });
      return item(project.key, project.repo, next, scope.where === "project" && scope.key === project.key);
    });
  return { show, where, projects };
}

/** The repo part of a project key (`host/owner/name`). */
function keyRepo(key) {
  return key.split("/").slice(1).join("/");
}

/**
 * The scope button text: the Show choice, then the repo when In is not All repos.
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeTitle(scope, board, followed) {
  const show = SHOWS.find(([id]) => id === scope.show)?.[1] ?? "Assigned to me";
  const repoOf = (key) => board.projects.find((p) => p.key === key)?.repo ?? null;
  switch (scope.where) {
    case "follow": {
      const repo = followed === null ? null : repoOf(followed);
      return `${show} · ${repo ?? "Follow space"}`;
    }
    case "project":
      return `${show} · ${repoOf(scope.key) ?? keyRepo(scope.key)}`;
    default:
      return show;
  }
}

/**
 * The projects a scope shows: all of them, one project, or the followed space's project.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {Project[]}
 */
export function scopeProjects(board, scope, followed) {
  const where = whereKey(scope, followed);
  if (where === undefined) return [];
  return where === null ? board.projects : board.projects.filter((project) => project.key === where);
}

/**
 * The provider and host of each repo that `scope` shows. Empty when the scope has no known repo.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {Array<{provider: string, host: string}>}
 */
export function scopeRepos(board, scope, followed) {
  const seen = new Set();
  const repos = [];
  for (const { provider, host } of scopeProjects(board, scope, followed)) {
    const id = `${provider} ${host}`;
    if (seen.has(id)) continue;
    seen.add(id);
    repos.push({ provider, host });
  }
  return repos;
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

/**
 * What Follow space shows for the focused folder: its project ("followed"), a wait while the
 * board has not read that folder yet ("pending"), or that the folder is no GitHub or GitLab repo ("none").
 * @param {Board} board
 * @param {string|null} folder The focused space's folder (`followFolder`).
 * @param {string|null} followed The project key of that folder (`followProjectKey`).
 * @returns {"followed"|"pending"|"none"}
 */
export function followStatus(board, folder, followed) {
  if (followed !== null) return "followed";
  if (folder === null) return "none";
  if (board.readAt === 0 || !board.folders.includes(folder)) return "pending";
  return "none";
}

/**
 * The board with `folders` added to the folders it lists, or the board itself when it lists them all.
 * @param {Board} board
 * @param {string[]} folders
 * @returns {Board}
 */
export function withFolders(board, folders) {
  const missing = folders.filter((folder) => !board.folders.includes(folder));
  return missing.length === 0 ? board : { ...board, folders: [...board.folders, ...missing] };
}

// Groups

/**
 * One group per repo, repos A to Z; newest update first inside a group, then the higher number.
 * @param {Issue[]} issues
 * @returns {Array<{key: string, title: string, issues: Issue[]}>}
 */
export function buildGroups(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = projectKey(issue);
    if (!groups.has(key)) groups.set(key, { key, title: issue.repo, issues: [] });
    groups.get(key).issues.push(issue);
  }
  const time = (issue) => Date.parse(issue.updatedAt) || 0;
  const newest = (a, b) => time(b) - time(a) || b.number - a.number;
  const list = [...groups.values()].sort((a, b) => compareNames(a.title, b.title) || compareNames(a.key, b.key));
  for (const group of list) group.issues.sort(newest);
  return list;
}

/**
 * The issue keys in the order the board shows them for `scope`.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {string[]}
 */
export function shownOrder(board, scope, followed) {
  return buildGroups(issuesInScope(board, scope, followed)).flatMap((group) => group.issues.map(issueKey));
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
 * @param {string} iso
 * @param {number} now Milliseconds since the epoch.
 * @returns {string}
 */
export function ageText(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  const days = Math.floor(seconds / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
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

/** True when a failure note comes from a read for `repo`: `gh` notes for GitHub, `glab (<host>)` notes for GitLab. */
function noteIsFor(note, repo) {
  if (repo.provider === "github") return note.startsWith("gh: ") || note.startsWith("gh not found");
  if (note.startsWith("glab not found")) return true;
  return note.startsWith(`glab (${repo.host}): `);
}

/**
 * The text of an empty list: loading before the first read, a pointer to the notes when a read
 * for the scope failed, else that the scope has none. With no known repo in the scope, any failure
 * counts. A note that a list was cut reports no failure.
 * @param {Board} board
 * @param {Array<{provider: string, host: string}>} [repos] The repos the scope shows (`scopeRepos`).
 * @returns {string}
 */
export function emptyMessage(board, repos = []) {
  if (board.readAt === 0) return "Loading…";
  const failed = board.notes
    .filter((note) => !note.startsWith("Showing the first "))
    .some((note) => repos.length === 0 || repos.some((repo) => noteIsFor(note, repo)));
  if (failed) return "No issues could be read. See the messages above.";
  return "No open issues here";
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
