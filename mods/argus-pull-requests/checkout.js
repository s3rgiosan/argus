// Plans a worktree checkout of a pull request: the branch name, and the git commands that fetch its head.

import { fetchRef } from "./forge.js";
import { findWorktree, worktreePath } from "./worktree.js";

/** @typedef {import("./model.js").Pr} Pr */

/**
 * The local branch that holds a PR's head.
 * @param {Pr} pr
 * @returns {string}
 */
export function checkoutBranch(pr) {
  return `${pr.provider === "gitlab" ? "mr" : "pr"}/${pr.number}`;
}

/**
 * Opens the worktree that already holds the PR branch, else plans a fetch and a new worktree.
 * @param {{pr: Pr, localPath: string, root: string, porcelain: string}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, cwd: string, branch: string, prune: string[]|null, exists: string[], peek: string[], ahead: string[], fetch: string[], add: string[]}}
 * For a create plan, `prune` clears a worktree entry whose folder is gone; `exists` tells whether the branch is already there; `peek` fetches the PR head to FETCH_HEAD
 * and `ahead` counts the branch commits not on it; `fetch` then force-updates the branch.
 */
export function checkoutPlan({ pr, localPath, root, porcelain }) {
  const branch = checkoutBranch(pr);
  const existing = findWorktree(porcelain, branch);
  if (existing.path !== null) return { kind: "open", path: existing.path };
  const path = worktreePath(root, localPath, branch);
  const ref = fetchRef(pr.provider, pr.number);
  return {
    kind: "create",
    path,
    cwd: localPath,
    branch,
    prune: existing.prune,
    exists: ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    peek: ["fetch", "--no-tags", "origin", ref],
    ahead: ["rev-list", "--count", `FETCH_HEAD..refs/heads/${branch}`],
    fetch: ["fetch", "--no-tags", "origin", `+${ref}:refs/heads/${branch}`],
    add: ["worktree", "add", path, branch],
  };
}

/**
 * The number `git rev-list --count` printed, or null when the text is not one.
 * @param {string} stdout
 * @returns {?number}
 */
export function aheadCount(stdout) {
  const text = String(stdout ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * The message for a local PR branch that has commits the PR head lacks.
 * @param {string} branch
 * @param {number} count
 * @returns {string}
 */
export function aheadRefusal(branch, count) {
  const commits = count === 1 ? "1 commit that is" : `${count} commits that are`;
  return `The local branch ${branch} has ${commits} not on the pull request. The branch is unchanged. Push or move those commits, or delete the branch, then check out again.`;
}
