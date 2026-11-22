// The New worktree view: the rows of the Branch and Issue tabs, the empty texts and the notes. The functions
// are pure; lib/worktree.js plans the git commands.

import { parseWorktrees } from "./worktree.js";
import { ISSUE_LIMIT } from "./forge.js";
import { limitNote } from "./forge-cli.js";

/** The note of a Branch tab read that could not find the default branch. */
export const DEFAULT_BRANCH_NOTE = "Could not read the default branch, so it is listed too.";

/**
 * The rows of the Branch tab: every branch except the default branch, with the path of its worktree or null.
 * @param {string[]} heads
 * @param {string|null} defaultBranch
 * @param {string} porcelain `git worktree list --porcelain` output.
 * @returns {Array<{branch: string, path: string|null}>}
 */
export function branchItems(heads, defaultBranch, porcelain) {
  const worktrees = parseWorktrees(porcelain);
  return heads
    .filter((branch) => branch !== defaultBranch)
    .map((branch) => ({ branch, path: worktrees.find((worktree) => worktree.branch === branch && !worktree.prunable)?.path ?? null }));
}

/**
 * The Branch tab read: the rows, the branches that hold a worktree, and a note when the default branch is
 * unknown and so listed too.
 * @param {string[]} heads
 * @param {string|null} defaultBranch
 * @param {string} porcelain
 * @returns {{entries: Array<{branch: string, path: string|null}>, held: string[], note: string|null}}
 */
export function branchRead(heads, defaultBranch, porcelain) {
  const held = parseWorktrees(porcelain)
    .filter((worktree) => worktree.branch !== null && !worktree.prunable)
    .map((worktree) => worktree.branch);
  return { entries: branchItems(heads, defaultBranch, porcelain), held, note: defaultBranch === null ? DEFAULT_BRANCH_NOTE : null };
}

/**
 * Whether a Branch read lists a worktree on `branch`. False when there is no read.
 * @param {?{held?: string[]}} read
 * @param {string} branch
 * @returns {boolean}
 */
export function holdsWorktree(read, branch) {
  return read?.held?.includes(branch) === true;
}

/**
 * The key of the repo the view shows when it opens: the followed one when listed, else the first, else null.
 * @param {Array<{key: string}>} projects
 * @param {?string} followed
 * @returns {string|null}
 */
export function defaultProjectKey(projects, followed) {
  return projects.find((project) => project.key === followed)?.key ?? projects[0]?.key ?? null;
}

const EMPTY_TEXTS = {
  branch: "No other branches on the remote",
  pr: "No open pull requests of this repo on the board",
  issue: "No open issues assigned to you",
};

/**
 * The text of an empty list: a filter miss when the tab has rows, else the text of the tab.
 * @param {"branch"|"pr"|"issue"} tab
 * @param {number} total Rows before the filter.
 * @param {number} shown Rows after the filter.
 * @returns {string}
 */
export function emptyText(tab, total, shown) {
  return total > 0 && shown === 0 ? "Nothing matches the filter" : (EMPTY_TEXTS[tab] ?? "");
}

/**
 * The Issue tab read: the issues, and a note when the list reached the read limit.
 * @template T
 * @param {T[]} issues
 * @returns {{entries: T[], note: string|null}}
 */
export function issueRead(issues) {
  return { entries: issues, note: limitNote("issues", issues.length, ISSUE_LIMIT) };
}

/**
 * The text of a stored create error or note when it belongs to the shown repo and tab, else null.
 * @param {?{key: string, tab: string, text: string}} entry
 * @param {string} key
 * @param {string} tab
 * @returns {string|null}
 */
export function noticeFor(entry, key, tab) {
  return entry && entry.key === key && entry.tab === tab ? entry.text : null;
}
