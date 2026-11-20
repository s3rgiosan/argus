// The Merged worktrees view: which linked worktrees have a merged pull request, which of them
// may be removed, and when the local branch may be deleted after the worktree is gone.

import { branchDelete, linkedWorktrees, reviewNumber } from "./review.js";

/** @typedef {{number: number, headSha: string, mergedAt: string}} Merged */
/** @typedef {{path: string, branch: string, head: string|null, locked: boolean, prunable: boolean, review: number|null}} Worktree */
/** @typedef {null|"has changes"|"open in a space"|"locked"|"has an open pull request"|"has newer commits"} Reason */
/** @typedef {{path: string, branch: string, number: number, mergedAt: string, headSha: string, review: boolean, reason: Reason}} Row */

/** The arguments that print the remote's default branch, for example `origin/main`. */
export function defaultBranchArgs() {
  return ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"];
}

/**
 * The default branch from `defaultBranchArgs` output: `origin/main` gives `main`.
 * @param {string} stdout
 * @returns {string|null}
 */
export function defaultBranchOf(stdout) {
  const ref = String(stdout ?? "").trim();
  const slash = ref.indexOf("/");
  return slash < 0 || slash === ref.length - 1 ? null : ref.slice(slash + 1);
}

/** The arguments that print a branch's tip commit, or fail when the branch is gone. */
export function tipArgs(branch) {
  return ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`];
}

/** The arguments that list a worktree's changes; empty output means it has none. */
export function statusArgs() {
  return ["status", "--porcelain"];
}

/**
 * The linked worktrees that may have a merged pull request: those on a branch, except the
 * default branch and the branch of the main worktree.
 * @param {string} porcelain `git worktree list --porcelain` output.
 * @param {string|null} defaultBranch
 * @returns {Worktree[]}
 */
export function candidates(porcelain, defaultBranch) {
  const firstBlock = String(porcelain).split(/\r?\n\r?\n/)[0] ?? "";
  const mainLine = firstBlock.split(/\r?\n/).find((line) => line.startsWith("branch "));
  const mainBranch = mainLine === undefined ? null : mainLine.slice("branch ".length).replace(/^refs\/heads\//, "");
  const result = [];
  for (const worktree of linkedWorktrees(porcelain)) {
    const branch = worktree.branch;
    if (branch === null || branch === defaultBranch || branch === mainBranch) continue;
    result.push({ ...worktree, branch, review: reviewNumber(branch) });
  }
  return result;
}

/**
 * True when `cwd` is the folder `path` or inside it.
 * @param {string} cwd
 * @param {string} path
 * @returns {boolean}
 */
export function insideFolder(cwd, path) {
  const folder = path.replace(/\/+$/, "");
  return cwd === folder || cwd.startsWith(`${folder}/`);
}

/**
 * The rows of the Merged worktrees view. A worktree without a merged pull request is left out.
 * A row has a reason when it must stay; the first reason that applies wins.
 * @param {{worktrees: Worktree[], merged: Record<string, Merged[]>, reviewMerged: Record<number, Merged|null>,
 *   dirty: Set<string>, inSpace: Set<string>, openBranches: Set<string>}} input
 *   `merged` is keyed by branch, newest first; `reviewMerged` by pull request number.
 * @returns {Row[]}
 */
export function rowsFor({ worktrees, merged, reviewMerged, dirty, inSpace, openBranches }) {
  const rows = [];
  for (const worktree of worktrees) {
    const review = worktree.review !== null;
    let pull = null;
    let newer = false;
    if (review) {
      pull = Object.hasOwn(reviewMerged, worktree.review) ? reviewMerged[worktree.review] : null;
    } else {
      const list = Object.hasOwn(merged, worktree.branch) ? merged[worktree.branch] : [];
      pull = list.find((entry) => entry.headSha === worktree.head) ?? null;
      // No merged head is the tip: the branch has commits that the pull request did not merge.
      if (pull === null && list.length > 0) {
        pull = list[0];
        newer = true;
      }
    }
    if (pull === null) continue;
    let reason = null;
    if (worktree.locked) reason = "locked";
    else if (!worktree.prunable && dirty.has(worktree.path)) reason = "has changes";
    else if (inSpace.has(worktree.path)) reason = "open in a space";
    else if (openBranches.has(worktree.branch)) reason = "has an open pull request";
    else if (newer) reason = "has newer commits";
    rows.push({ path: worktree.path, branch: worktree.branch, number: pull.number, mergedAt: pull.mergedAt, headSha: pull.headSha, review, reason });
  }
  return rows.sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
}

/**
 * What to do with a row's branch after its worktree is gone. A review branch uses `git branch -d`,
 * which refuses a branch with commits of its own. Any other branch is deleted only when its tip,
 * read just before, is still the merged head commit.
 * @param {Row} row
 * @param {string|null} tipNow The branch tip, or null when the branch is gone.
 * @returns {{args: string[]|null, kept: string|null}}
 */
export function branchStep(row, tipNow) {
  if (tipNow === null) return { args: null, kept: null };
  if (row.review) return { args: branchDelete(row.branch), kept: null };
  if (tipNow !== row.headSha) return { args: null, kept: "has newer commits" };
  return { args: ["branch", "-D", row.branch], kept: null };
}
