// Pure board logic for the pull request board: assembling reads, scopes, groups, filter and
// row text. Pull requests are the objects built by model.js.

import { compareNames } from "./follow.js";
import { prKey } from "./model.js";
import { localPathFor, projectKey } from "./remote.js";

export { compareNames };

/**
 * @typedef {import("./model.js").Pr} Pr
 * @typedef {import("./model.js").Checks} Checks
 * @typedef {import("./remote.js").Project} Project
 * @typedef {{kind: "needsReview"} | {kind: "mine"} | {kind: "follow"} | {kind: "project", key: string}} Scope
 * @typedef {{prs: Pr[], scopes: {needsReview: string[], mine: string[], projects: Record<string, string[]>}, projects: Project[], folders: string[], readAt: number, notes: string[], staleAt?: number}} Board
 * @typedef {"ready"|"needsWork"|"waiting"|"draft"} GroupId
 * @typedef {{key: string, label: string, scope: Scope, count: number}} Item
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
  };
}

/**
 * Builds the shared board from one read. Pull requests are deduplicated by key and carry the
 * local checkout path of their repository.
 * @param {{projects: Project[], folders: string[], needsReview: Pr[], mine: Pr[], projectPrs: Record<string, Pr[]>, notes: string[], readAt: number}} input
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
  return { prs: [...byKey.values()], scopes, projects, folders, readAt, notes };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * A well-formed board as is; the empty board for anything else.
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
  return valid ? /** @type {Board} */ (value) : emptyBoard();
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

// Scopes

/**
 * @param {unknown} value
 * @returns {Scope}
 */
export function normalizeScope(value) {
  if (isObject(value)) {
    switch (value.kind) {
      case "mine":
        return { kind: "mine" };
      case "follow":
        return { kind: "follow" };
      case "project":
        if (typeof value.key === "string" && value.key !== "") {
          return { kind: "project", key: value.key };
        }
        break;
      default:
        break;
    }
  }
  return { kind: "needsReview" };
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
 * @param {Board} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Pr[]}
 */
export function prsInScope(board, scope, followed) {
  switch (scope.kind) {
    case "needsReview":
      return prsByKeys(board, board.scopes.needsReview);
    case "mine":
      return prsByKeys(board, board.scopes.mine);
    case "follow":
      return followed === null ? [] : prsByKeys(board, board.scopes.projects[followed] ?? []);
    default:
      return prsByKeys(board, board.scopes.projects[scope.key] ?? []);
  }
}

/**
 * @param {Board} board
 * @param {?string} followed
 * @returns {{needsReview: Item, mine: Item, follow: Item, projects: Item[]}}
 */
export function scopeItems(board, followed) {
  const count = (key) => board.scopes.projects[key]?.length ?? 0;
  const projects = [...board.projects]
    .sort((a, b) => compareNames(a.repo, b.repo))
    .map((project) => ({
      key: project.key,
      label: project.repo,
      scope: { kind: "project", key: project.key },
      count: count(project.key),
    }));
  return {
    needsReview: {
      key: "needsReview",
      label: "Needs my review",
      scope: { kind: "needsReview" },
      count: board.scopes.needsReview.length,
    },
    mine: { key: "mine", label: "Mine", scope: { kind: "mine" }, count: board.scopes.mine.length },
    follow: {
      key: "follow",
      label: "Follow space",
      scope: { kind: "follow" },
      count: followed === null ? 0 : count(followed),
    },
    projects,
  };
}

/**
 * @param {Scope} scope
 * @param {Board} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeTitle(scope, board, followed) {
  switch (scope.kind) {
    case "needsReview":
      return "Needs my review";
    case "mine":
      return "Mine";
    case "follow": {
      const project = board.projects.find((p) => p.key === followed);
      return project ? `Follow space · ${project.repo}` : "Follow space";
    }
    default:
      return board.projects.find((p) => p.key === scope.key)?.repo ?? scope.key.split("/").slice(1).join("/");
  }
}

// Groups

/**
 * @param {Pr} pr
 * @returns {GroupId}
 */
export function groupOf(pr) {
  if (pr.isDraft) return "draft";
  if (pr.checks.failed > 0 || pr.reviewDecision === "changes_requested" || pr.mergeable === "conflicting") {
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
