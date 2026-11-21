// Pure board logic for the pull request board: assembling reads, scopes, groups, filter and
// row text. Pull requests are the objects built by model.js.

import { prKey } from "./model.js";
import { localPathFor, projectKey } from "./remote.js";
import { KEEP_RUNS_MS } from "./review.js";
import { isObject } from "./forge-cli.js";
import { emptyMessage as emptyText, itemsByKeys, keptLists as keptItems, normalizeScope as normalizeShowWhere, rowSignature, scopeItems as scopeRows, scopeProjects, scopeTitle as titleOf, whereKey } from "./forge-board.js";


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
 * failed read does not hide them, kept for KEEP_RUNS_MS after the repo's last successful list.
 * `prs` holds every kept pull request of those repos. `projectPrs` holds the project lists of the
 * failed repos that are projects. `listedAt` holds the time of the last successful list of each kept repo.
 * @param {Board} previous
 * @param {string[]} failedKeys Repo keys (`projectKey`) whose list failed.
 * @param {number} now
 * @returns {{prs: Pr[], projectPrs: Record<string, Pr[]>, listedAt: Record<string, number>}}
 */
export function keptLists(previous, failedKeys, now) {
  const kept = keptItems(previous, failedKeys, now, { items: previous.prs, keyOf: prKey, keepMs: KEEP_RUNS_MS });
  return { prs: kept.items, projectPrs: kept.projectItems, listedAt: kept.listedAt };
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
  if (!isObject(value) || typeof value.kind !== "string") return /** @type {Scope} */ (normalizeShowWhere(value, SHOWS));
  const fallback = /** @type {Scope} */ ({ show: "needsReview", where: "all" });
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

/**
 * @param {Board} board
 * @param {string[]} keys
 * @returns {Pr[]}
 */
function prsByKeys(board, keys) {
  return itemsByKeys(board.prs, keys, prKey);
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
 * each project), each with the count of pull requests it shows.
 * @param {Board} board
 * @param {?string} followed
 * @param {Scope} scope The current scope.
 * @returns {{show: Item[], where: Item[], projects: Item[]}}
 */
export function scopeItems(board, followed, scope) {
  return scopeRows(board, followed, scope, { shows: SHOWS, count: (next) => prsInScope(board, next, followed).length });
}

/**
 * The scope button text: the Show choice, then the repo when In is not all repos.
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeTitle(scope, board, followed) {
  return titleOf(scope, board, followed, SHOWS);
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
 * The text of an empty pull request list, as `emptyMessage` in lib/forge-board.js gives it.
 * @param {Board} board
 * @param {Array<{provider: string, host: string}>} [repos] The repos the scope shows (`scopeRepos`).
 * @returns {string}
 */
export function emptyMessage(board, repos = []) {
  return emptyText(board, repos, { failed: "No pull requests could be read. See the messages above.", none: "No pull requests here" });
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
 * A text for the parts of a board row that the pull request pane shows.
 * @param {Pr|null|undefined} pr
 * @returns {string|null} Null when there is no row.
 */
export function prSignature(pr) {
  return rowSignature(pr, (row) => {
    const checks = row.checks ?? {};
    return [row.updatedAt, row.state, row.isDraft, row.reviewDecision, row.mergeable, checks.passed, checks.failed, checks.running, checks.total];
  });
}

