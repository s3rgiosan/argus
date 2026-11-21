// Pure board logic for the pull request board: assembling reads, scopes, groups, filter and
// row text. Pull requests are the objects built by model.js.

import { compareNames } from "./follow.js";
import { prKey } from "./model.js";
import { localPathFor, projectKey } from "./remote.js";
import { KEEP_RUNS_MS } from "./review.js";
import { LOCK_MS, holdsLock } from "./sync.js";

export { compareNames };

/**
 * @typedef {import("./model.js").Pr} Pr
 * @typedef {import("./model.js").Checks} Checks
 * @typedef {import("./remote.js").Project} Project
 * @typedef {"needsReview" | "mine" | "all"} Show
 * @typedef {{show: Show, where: "all" | "follow"} | {show: Show, where: "project", key: string}} Scope
 * @typedef {{prs: Pr[], scopes: {needsReview: string[], mine: string[], projects: Record<string, string[]>}, projects: Project[], folders: string[], readAt: number, notes: string[], staleAt?: number, reviews: Record<string, Run[]>, merged?: Record<string, number>, mergedSeen?: Record<string, number>, listedAt?: Record<string, number>}} Board
 * `reviews` holds the review runs of each pull request, keyed by `prKey`. `listedAt` holds the time
 * of the last successful pull request list of each repo, keyed by `projectKey`.
 * @typedef {{path: string, branch: string}} Run
 * @typedef {"ready"|"needsWork"|"waiting"|"draft"} GroupId
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} Item
 */

const GROUPS = [
  { id: "ready", title: "Ready to merge" },
  { id: "needsWork", title: "Needs work" },
  { id: "waiting", title: "Waiting on review" },
  { id: "draft", title: "Draft" },
];

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

// Board

/** @returns {Board} */
function emptyBoard() {
  return {
    prs: [],
    scopes: { needsReview: [], mine: [], projects: {} },
    projects: [],
    folders: [],
    readAt: 0,
    notes: [],
    reviews: {},
  };
}

/**
 * Builds the shared board from one read. Pull requests are deduplicated by key and carry the
 * local checkout path of their repository.
 * @param {{projects: Project[], folders: string[], needsReview: Pr[], mine: Pr[], projectPrs: Record<string, Pr[]>, notes: string[], readAt: number, reviews?: Record<string, Run[]>, merged?: Record<string, number>, mergedSeen?: Record<string, number>, listedAt?: Record<string, number>}} input
 * @returns {Board}
 */
export function assembleBoard(input) {
  const { projects, folders, needsReview, mine, projectPrs, notes, readAt } = input;
  const byKey = new Map();
  const keysOf = (list) => {
    const keys = [];
    for (const pr of list) {
      const key = prKey(pr);
      keys.push(key);
      if (!byKey.has(key)) {
        byKey.set(key, { ...pr, localPath: localPathFor(projects, pr.host, pr.repo) });
      }
    }
    return keys;
  };
  const scopes = { needsReview: keysOf(needsReview), mine: keysOf(mine), projects: {} };
  for (const project of projects) {
    scopes.projects[project.key] = keysOf(projectPrs[project.key] ?? []);
  }
  return { prs: [...byKey.values()], scopes, projects, folders, readAt, notes, reviews: input.reviews ?? {}, merged: input.merged ?? {}, mergedSeen: input.mergedSeen ?? {}, listedAt: input.listedAt ?? {} };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** True when `value` is a review run: a path and a branch. */
function isRun(value) {
  return isObject(value) && typeof value.path === "string" && typeof value.branch === "string";
}

/**
 * A well-formed board, with no review runs when its runs are missing or malformed;
 * the empty board for anything else.
 * @param {unknown} value
 * @returns {Board}
 */
export function normalizeBoard(value) {
  if (!isObject(value) || !isObject(value.scopes)) return emptyBoard();
  const { scopes } = value;
  const projectScopes = scopes.projects;
  const valid =
    Array.isArray(value.prs) &&
    value.prs.every(isObject) &&
    Array.isArray(value.projects) &&
    value.projects.every(isObject) &&
    isStringArray(value.folders) &&
    isStringArray(value.notes) &&
    typeof value.readAt === "number" &&
    isStringArray(scopes.needsReview) &&
    isStringArray(scopes.mine) &&
    isObject(projectScopes) &&
    Object.values(projectScopes).every(isStringArray);
  if (!valid) return emptyBoard();
  // A board from an older version has no review runs.
  const reviews = isObject(value.reviews) && Object.values(value.reviews).every((runs) => Array.isArray(runs) && runs.every(isRun)) ? value.reviews : {};
  // A board saved before merged counts existed, or with bad counts, has none.
  const merged = isObject(value.merged) && Object.values(value.merged).every((count) => Number.isInteger(count) && count >= 0) ? value.merged : {};
  // The time of each project's last successful count; bad times mean none.
  const mergedSeen = isObject(value.mergedSeen) && Object.values(value.mergedSeen).every((time) => Number.isFinite(time) && time >= 0) ? value.mergedSeen : {};
  // The time of each repo's last successful list; bad times mean none.
  const listedAt = isObject(value.listedAt) && Object.values(value.listedAt).every((time) => Number.isFinite(time) && time >= 0) ? value.listedAt : {};
  return /** @type {Board} */ ({ ...value, reviews, merged, mergedSeen, listedAt });
}

/**
 * Splits `prs` into the ones named by `pairs` and the pairs that are not in the list.
 * @param {Pr[]} prs
 * @param {Array<{host: string, repo: string, number: number}>} pairs
 * @returns {{found: Pr[], missing: Array<{host: string, repo: string, number: number}>}}
 */
export function pickPairs(prs, pairs) {
  const byKey = new Map(prs.map((pr) => [prKey(pr), pr]));
  const found = [];
  const missing = [];
  for (const pair of pairs) {
    const pr = byKey.get(prKey(pair));
    if (pr) found.push(pr);
    else missing.push(pair);
  }
  return { found, missing };
}

/**
 * The pairs whose repo did not fail to list. A repo that failed already has a
 * note, and asking for its pull requests one by one would fail the same way.
 * @param {Array<{host: string, repo: string, number: number}>} pairs
 * @param {Set<string>} failed Project keys (`projectKey`) of the repos whose list failed.
 */
export function withoutFailedRepos(pairs, failed) {
  return pairs.filter((pair) => !failed.has(projectKey(pair)));
}

/**
 * The pull requests of the previous board for the repos whose list failed in this read, so one
 * failed read does not hide them. A repo keeps them for KEEP_RUNS_MS after its last successful
 * list, so a repo whose list always fails does not keep them forever.
 * `prs` holds every kept pull request of those repos. `projectPrs` holds the project lists of the
 * failed repos that are projects. `listedAt` holds the time of the last successful list of each kept repo.
 * @param {Board} previous
 * @param {string[]} failedKeys Repo keys (`projectKey`) whose list failed.
 * @param {number} now
 * @returns {{prs: Pr[], projectPrs: Record<string, Pr[]>, listedAt: Record<string, number>}}
 */
export function keptLists(previous, failedKeys, now) {
  const seen = previous.listedAt ?? {};
  /** @type {Pr[]} */
  const prs = [];
  /** @type {Record<string, Pr[]>} */
  const projectPrs = {};
  /** @type {Record<string, number>} */
  const listedAt = {};
  for (const key of new Set(failedKeys)) {
    if (!Object.hasOwn(seen, key) || now - seen[key] >= KEEP_RUNS_MS) continue;
    listedAt[key] = seen[key];
    prs.push(...previous.prs.filter((pr) => projectKey(pr) === key));
    if (Object.hasOwn(previous.scopes.projects, key)) projectPrs[key] = prsByKeys(previous, previous.scopes.projects[key]);
  }
  return { prs, projectPrs, listedAt };
}

/**
 * The board with one more note, or the board itself when it has the note already.
 * @param {Board} board
 * @param {string} text
 * @returns {Board}
 */
export function withNote(board, text) {
  return board.notes.includes(text) ? board : { ...board, notes: [...board.notes, text] };
}

// Scopes

const SHOWS = /** @type {const} */ ([
  ["needsReview", "Needs my review"],
  ["mine", "Mine"],
  ["all", "All open"],
]);

/**
 * The scope: which pull requests to show (Show) and from which repos (In).
 * Scopes saved as one `kind` map onto the two choices.
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  const fallback = /** @type {Scope} */ ({ show: "needsReview", where: "all" });
  if (!isObject(value)) return fallback;
  if (typeof value.kind === "string") {
    switch (value.kind) {
      case "mine":
        return { show: "mine", where: "all" };
      case "follow":
        return { show: "all", where: "follow" };
      case "project":
        return typeof value.key === "string" && value.key !== "" ? { show: "all", where: "project", key: value.key } : fallback;
      default:
        return fallback;
    }
  }
  const show = SHOWS.some(([id]) => id === value.show) ? /** @type {Show} */ (value.show) : "needsReview";
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
 * @param {Board} board
 * @param {string[]} keys
 * @returns {Pr[]}
 */
function prsByKeys(board, keys) {
  const byKey = new Map(board.prs.map((pr) => [prKey(pr), pr]));
  return keys.map((key) => byKey.get(key)).filter((pr) => pr !== undefined);
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
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Pr[]}
 */
export function prsInScope(board, scope, followed) {
  const where = whereKey(scope, followed);
  if (where === undefined) return [];
  let prs;
  switch (scope.show) {
    case "needsReview":
      prs = prsByKeys(board, board.scopes.needsReview);
      break;
    case "mine":
      prs = prsByKeys(board, board.scopes.mine);
      break;
    default:
      prs = where === null ? board.prs : prsByKeys(board, board.scopes.projects[where] ?? []);
  }
  return where === null ? prs : prs.filter((pr) => projectKey(pr) === where);
}

/**
 * The rows of the scope list: the Show choices, then In (follow space, all repos and
 * each project). Each row's count keeps the other choice as it is, and picking it
 * changes only its own choice.
 * @param {Board} board
 * @param {?string} followed
 * @param {Scope} scope The current scope.
 * @returns {{show: Item[], where: Item[], projects: Item[]}}
 */
export function scopeItems(board, followed, scope) {
  const sameWhere = (next) => next.where === scope.where && (next.where !== "project" || next.key === scope.key);
  const item = (key, label, next, current) => ({ key, label, scope: next, count: prsInScope(board, next, followed).length, current });
  const keep = scope.where === "project" ? { where: "project", key: scope.key } : { where: scope.where };
  const show = SHOWS.map(([id, label]) => item(id, label, /** @type {Scope} */ ({ show: id, ...keep }), scope.show === id));
  const where = [
    item("follow", "Follow space", { show: scope.show, where: "follow" }, scope.where === "follow"),
    item("all", "All repos", { show: scope.show, where: "all" }, scope.where === "all"),
  ];
  const listed = board.projects.map((project) => ({ key: project.key, repo: project.repo }));
  // A picked project no longer on the board stays in the list, so its row keeps the tick.
  if (scope.where === "project" && !listed.some((project) => project.key === scope.key)) {
    listed.push({ key: scope.key, repo: scope.key.split("/").slice(1).join("/") });
  }
  const projects = listed
    .sort((a, b) => compareNames(a.repo, b.repo))
    .map((project) => {
      const next = /** @type {Scope} */ ({ show: scope.show, where: "project", key: project.key });
      return item(project.key, project.repo, next, sameWhere(next));
    });
  return { show, where, projects };
}

/**
 * The scope button text: the Show choice, then the repo when In is not all repos.
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeTitle(scope, board, followed) {
  const show = SHOWS.find(([id]) => id === scope.show)?.[1] ?? "Needs my review";
  const repoOf = (key) => board.projects.find((p) => p.key === key)?.repo ?? null;
  switch (scope.where) {
    case "follow": {
      const repo = followed === null ? null : repoOf(followed);
      return `${show} · ${repo ?? "Follow space"}`;
    }
    case "project":
      return `${show} · ${repoOf(scope.key) ?? scope.key.split("/").slice(1).join("/")}`;
    default:
      return show;
  }
}

/**
 * The In part of the scope: All repos, the followed or picked repo, or Follow space.
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeWhereTitle(scope, board, followed) {
  const repoOf = (key) => board.projects.find((p) => p.key === key)?.repo ?? null;
  switch (scope.where) {
    case "follow": {
      const repo = followed === null ? null : repoOf(followed);
      return repo ?? "Follow space";
    }
    case "project":
      return repoOf(scope.key) ?? scope.key.split("/").slice(1).join("/");
    default:
      return "All repos";
  }
}

// Groups

/**
 * True when the review decision requests changes, or when a reviewer's latest review requests
 * changes. The review decision may not show every request for changes.
 * @param {Pr} pr
 * @returns {boolean}
 */
export function changesRequested(pr) {
  return pr.reviewDecision === "changes_requested" || (Array.isArray(pr.changesRequestedBy) && pr.changesRequestedBy.length > 0);
}

/**
 * @param {Pr} pr
 * @returns {GroupId}
 */
export function groupOf(pr) {
  if (pr.isDraft) return "draft";
  if (pr.checks.failed > 0 || changesRequested(pr) || pr.mergeable === "conflicting") {
    return "needsWork";
  }
  const reviewed = pr.reviewDecision === "approved" || pr.reviewDecision === null;
  if (reviewed && pr.checks.running === 0 && pr.mergeable === "mergeable") return "ready";
  return "waiting";
}

/**
 * Non-empty groups in display order; newest first inside a group, then higher number.
 * @param {Pr[]} prs
 * @returns {Array<{id: GroupId, title: string, prs: Pr[]}>}
 */
export function buildGroups(prs) {
  const time = (pr) => Date.parse(pr.updatedAt) || 0;
  const newest = (a, b) => time(b) - time(a) || b.number - a.number;
  return GROUPS.map(({ id, title }) => ({
    id,
    title,
    prs: prs.filter((pr) => groupOf(pr) === id).sort(newest),
  })).filter((group) => group.prs.length > 0);
}

// Filter and row text

/**
 * @param {Pr} pr
 * @param {string} text
 * @returns {boolean}
 */
export function matchesFilter(pr, text) {
  const needle = text.trim().toLowerCase();
  if (needle === "") return true;
  const fields = [pr.title, pr.author, pr.headRef];
  if (fields.some((field) => String(field).toLowerCase().includes(needle))) return true;
  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  return digits !== "" && String(pr.number).startsWith(digits);
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
 * @param {Checks} checks
 * @returns {string}
 */
export function checksText(checks) {
  if (checks.total === 0) return "";
  if (checks.failed > 0) return `✗ ${checks.failed}/${checks.total}`;
  if (checks.running > 0) return "● running";
  return `✓ ${checks.passed}/${checks.total}`;
}

/**
 * @param {Pr["reviewDecision"]} decision
 * @returns {?string}
 */
export function reviewLabel(decision) {
  switch (decision) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes requested";
    case "review_required":
      return "review required";
    default:
      return null;
  }
}

/**
 * The last path segment of a repository.
 * @param {string} repo
 * @returns {string}
 */
export function shortRepo(repo) {
  return repo.split("/").pop() ?? repo;
}

/**
 * The board with a mark that makes it due for a read, for example after a review action.
 * @param {Board} board
 * @param {number} now
 * @returns {Board}
 */
export function markStale(board, now) {
  return { ...board, staleAt: now };
}

/**
 * When the board counts as read: its `readAt`, or 0 when a stale mark is newer.
 * @param {Board} board
 * @returns {number}
 */
export function fetchedAtOf(board) {
  const staleAt = typeof board.staleAt === "number" ? board.staleAt : 0;
  return staleAt > board.readAt ? 0 : board.readAt;
}

/**
 * The board to write after a read that started at `startedAt`. A stale mark made
 * while the read ran stays on it, so the next tick reads again.
 * @param {Board} next
 * @param {Board} current The board in `shared` when the read ends.
 * @param {number} startedAt
 * @returns {Board}
 */
export function keepStale(next, current, startedAt) {
  const staleAt = typeof current.staleAt === "number" ? current.staleAt : 0;
  return staleAt > startedAt ? { ...next, staleAt } : next;
}

/**
 * The title the pane header shows for the pull request pane: the shown pull
 * request's number and title, the number alone without a title, else the panel name.
 * @param {{number: number, title: string} | null} pr
 * @returns {string}
 */
export function prPaneTitle(pr) {
  if (pr === null) return "Pull requests";
  return pr.title ? `#${pr.number} · ${pr.title}` : `#${pr.number}`;
}

/**
 * What Follow space shows for the focused folder: its project ("followed"), a wait while the
 * board has not read that folder yet ("pending"), or that the folder is no GitHub or GitLab
 * repo ("none"). A new space's folder is unknown until a read or the folder watch lists it.
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
 * The folder watch uses it for folders that are no repo, so Follow space can say so without a read.
 * @param {Board} board
 * @param {string[]} folders
 * @returns {Board}
 */
export function withFolders(board, folders) {
  const missing = folders.filter((folder) => !board.folders.includes(folder));
  return missing.length === 0 ? board : { ...board, folders: [...board.folders, ...missing] };
}

/**
 * The projects a scope shows: all of them, one project, or the followed space's project.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Project[]}
 */
export function scopeProjects(board, scope, followed) {
  const where = whereKey(scope, followed);
  if (where === undefined) return [];
  return where === null ? board.projects : board.projects.filter((project) => project.key === where);
}

/**
 * The head branches of the open pull requests of a project's repo.
 * @param {Board} board
 * @param {Project} project
 * @returns {Set<string>}
 */
export function openBranches(board, project) {
  const branches = new Set();
  for (const pr of board.prs) {
    if (pr.state !== "open" || pr.provider !== project.provider || projectKey(pr) !== projectKey(project)) continue;
    branches.add(pr.headRef);
  }
  return branches;
}

/**
 * The provider and host of each repo that `scope` shows: every project for All repos, the
 * followed or picked project otherwise. Empty when the scope has no known repo.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Array<{provider: string, host: string}>}
 */
export function scopeRepos(board, scope, followed) {
  const projects = scopeProjects(board, scope, followed);
  const seen = new Set();
  /** @type {Array<{provider: string, host: string}>} */
  const repos = [];
  for (const { provider, host } of projects) {
    if (seen.has(`${provider} ${host}`)) continue;
    seen.add(`${provider} ${host}`);
    repos.push({ provider, host });
  }
  return repos;
}

/** True when a failure note comes from a read for `repo`: `gh` notes for GitHub, `glab (<host>)` notes for GitLab. */
function noteIsFor(note, repo) {
  if (repo.provider === "github") return note.startsWith("gh: ") || note.startsWith("gh not found");
  if (note.startsWith("glab not found")) return true;
  return note.startsWith(`glab (${repo.host}): `);
}

/**
 * The text of an empty pull request list: loading before the first read, a pointer to the notes
 * when a read for the scope failed (the list may be empty because of it), else that the scope has none.
 * With no known repo in the scope, any failure counts. A note that a list was cut ("Showing the
 * first …", `limitNote`) reports no failure.
 * @param {Board} board
 * @param {Array<{provider: string, host: string}>} [repos] The repos the scope shows (`scopeRepos`).
 * @returns {string}
 */
export function emptyMessage(board, repos = []) {
  if (board.readAt === 0) return "Loading…";
  const failed = board.notes
    .filter((note) => !note.startsWith("Showing the first "))
    .some((note) => repos.length === 0 || repos.some((repo) => noteIsFor(note, repo)));
  if (failed) return "No pull requests could be read. See the messages above.";
  return "No pull requests here";
}

/**
 * The merged worktree count per project after a read, and the time of each last successful count.
 * A failed read (`count` null) keeps the project's last count for KEEP_RUNS_MS after that time,
 * then drops it. A project the read did not cover is left out.
 * @param {Record<string, number>} previous
 * @param {Record<string, number>} previousSeen
 * @param {Array<{key: string, count: number|null}>} read
 * @param {number} now
 * @returns {{merged: Record<string, number>, mergedSeen: Record<string, number>}}
 */
export function mergedCounts(previous, previousSeen, read, now) {
  /** @type {Record<string, number>} */
  const merged = {};
  /** @type {Record<string, number>} */
  const mergedSeen = {};
  for (const { key, count } of read) {
    if (count !== null) {
      merged[key] = count;
      mergedSeen[key] = now;
    } else if (Object.hasOwn(previous, key) && Object.hasOwn(previousSeen, key) && now - previousSeen[key] < KEEP_RUNS_MS) {
      merged[key] = previous[key];
      mergedSeen[key] = previousSeen[key];
    }
  }
  return { merged, mergedSeen };
}

/**
 * The merged worktrees of the projects a scope shows.
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {number}
 */
export function mergedInScope(board, scope, followed) {
  const merged = board.merged ?? {};
  return scopeProjects(board, scope, followed).reduce((sum, project) => sum + (Object.hasOwn(merged, project.key) ? merged[project.key] : 0), 0);
}

/**
 * The board line for merged worktrees, or null when there are none.
 * @param {number} count
 * @returns {string|null}
 */
export function mergedText(count) {
  if (count <= 0) return null;
  return count === 1 ? "1 merged worktree" : `${count} merged worktrees`;
}

/**
 * The merged count read of a board read: the counts of the projects whose worktree list was read,
 * and null for the projects whose list failed, so `mergedCounts` keeps their last count.
 * @param {Array<{key: string, count: number|null}>} counts
 * @param {string[]} failedKeys
 * @returns {Array<{key: string, count: number|null}>}
 */
export function mergedListRead(counts, failedKeys) {
  return [...counts, ...failedKeys.map((key) => ({ key, count: null }))];
}

/**
 * True when the lock that `owner` holds ends in less than half of `lockMs`. Only then does a
 * read write the lock again, so a long read does not render every mod after each project.
 * @param {{owner: string, until: number}|null|undefined} lock
 * @param {string} owner
 * @param {number} now
 * @param {number} [lockMs]
 * @returns {boolean}
 */
export function lockNeedsRenewal(lock, owner, now, lockMs = LOCK_MS) {
  return holdsLock(lock, owner, now) && lock.until - now < lockMs / 2;
}

/**
 * A text for the parts of a board row that the pull request pane shows.
 * @param {Pr|null|undefined} pr
 * @returns {string|null} Null when there is no row.
 */
export function prSignature(pr) {
  if (!pr) return null;
  const checks = pr.checks ?? {};
  return [pr.updatedAt, pr.state, pr.isDraft, pr.reviewDecision, pr.mergeable, checks.passed, checks.failed, checks.running, checks.total].join("|");
}

/**
 * True when the pull request pane reads its pull request again.
 * - The board has no row for it: after each board read.
 * - The row differs from the row at the last pane read: yes.
 * - Otherwise: only when the board has not read for longer than `intervalMs` and the pane
 *   has not read for that long (no board copy is running).
 * @param {{row: Pr|null|undefined, seen: string|null|undefined, boardReadAt: number, shownReadAt: number, now: number, intervalMs: number}} input
 * @returns {boolean}
 */
export function prRereadDue({ row, seen, boardReadAt, shownReadAt, now, intervalMs }) {
  const current = prSignature(row);
  if (current === null || typeof seen !== "string") return boardReadAt > shownReadAt;
  if (current !== seen) return true;
  return now - boardReadAt > intervalMs && now - shownReadAt >= intervalMs;
}
