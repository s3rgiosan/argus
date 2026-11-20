// Plans the New worktree view: the remote branches to list, and the git commands that start a worktree from a
// remote branch or an issue. The functions are pure; the caller runs the commands.

import { compareNames } from "./follow.js";
import { branchSlug, parseWorktrees } from "./worktree.js";
import { titleSlug } from "./review.js";

/** The most characters an issue branch name has. */
const ISSUE_BRANCH_LENGTH = 60;

/** The arguments that list the branches of the remote. */
export function remoteHeadsArgs() {
  return ["ls-remote", "--heads", "origin"];
}

/**
 * The branch names in `remoteHeadsArgs` output, sorted. Tags, `HEAD` and other refs are left out.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseRemoteHeads(stdout) {
  const names = new Set();
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const ref = line.split("\t")[1];
    if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) continue;
    const name = ref.slice("refs/heads/".length);
    if (name !== "" && name !== "HEAD") names.add(name);
  }
  return [...names].sort(compareNames);
}

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
    .map((branch) => ({ branch, path: worktrees.find((worktree) => worktree.branch === branch)?.path ?? null }));
}

/** The worktree path for `branch` of the repo at `localPath`. */
function pathFor(root, localPath, branch) {
  const folder = localPath.replace(/\/+$/, "").split("/").pop();
  return `${root}/${folder}/${branchSlug(branch)}`;
}

/**
 * Opens the worktree that holds a remote branch, else plans a fetch and a new worktree. A local branch of
 * the same name stays as it is; without one, a new branch tracks the remote branch.
 * @param {{branch: string, localPath: string, root: string, porcelain: string, localExists: boolean}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, fetch: string[], add: string[]}}
 */
export function remoteBranchPlan({ branch, localPath, root, porcelain, localExists }) {
  const existing = parseWorktrees(porcelain).find((worktree) => worktree.branch === branch);
  if (existing) return { kind: "open", path: existing.path };
  const path = pathFor(root, localPath, branch);
  return {
    kind: "create",
    path,
    fetch: ["fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    add: localExists ? ["worktree", "add", path, branch] : ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`],
  };
}

/**
 * The local branch name for an issue: the number and the title slug, at most 60 characters, cut on a dash.
 * @param {number} number
 * @param {string} title
 * @returns {string}
 */
export function issueBranch(number, title) {
  const slug = titleSlug(title);
  const name = slug === "" ? String(number) : `${number}-${slug}`;
  if (name.length <= ISSUE_BRANCH_LENGTH) return name;
  const cut = name.slice(0, ISSUE_BRANCH_LENGTH);
  if (name[ISSUE_BRANCH_LENGTH] === "-") return cut;
  const dash = cut.lastIndexOf("-");
  return (dash > 0 ? cut.slice(0, dash) : cut).replace(/-+$/, "");
}

/**
 * Opens the worktree of an issue branch, else plans a new worktree. A new branch is cut from the fetched
 * default branch with no upstream. An existing local branch gets a worktree with no fetch and no reset.
 * `check` validates the branch name first; `fetch` is null when no fetch is needed.
 * @param {{number: number, title: string, defaultBranch: string, localPath: string, root: string, porcelain: string, localExists: boolean}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, branch: string, check: string[], fetch: string[]|null, add: string[]}}
 */
export function issuePlan({ number, title, defaultBranch, localPath, root, porcelain, localExists }) {
  const branch = issueBranch(number, title);
  const existing = parseWorktrees(porcelain).find((worktree) => worktree.branch === branch);
  if (existing) return { kind: "open", path: existing.path };
  const path = pathFor(root, localPath, branch);
  const check = ["check-ref-format", "--branch", branch];
  if (localExists) return { kind: "create", path, branch, check, fetch: null, add: ["worktree", "add", path, branch] };
  return {
    kind: "create",
    path,
    branch,
    check,
    fetch: ["fetch", "--no-tags", "origin", defaultBranch],
    add: ["worktree", "add", "--no-track", "-b", branch, path, `origin/${defaultBranch}`],
  };
}

/**
 * The items whose `keyOf` text holds `text`, ignoring case and a leading `#`. Empty text keeps all items.
 * @template T
 * @param {T[]} items
 * @param {string} text
 * @param {(item: T) => string} keyOf
 * @returns {T[]}
 */
export function filterItems(items, text, keyOf) {
  const needle = String(text ?? "").trim().toLowerCase();
  if (needle === "") return items;
  const bare = needle.replace(/^#/, "");
  return items.filter((item) => {
    const key = keyOf(item).toLowerCase();
    return key.includes(needle) || key.includes(bare);
  });
}
