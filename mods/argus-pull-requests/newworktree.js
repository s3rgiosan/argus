// Plans the New worktree view: the remote branches to list, and the git commands that start a worktree from a
// remote branch or an issue. The functions are pure; the caller runs the commands.

import { compareNames } from "./follow.js";
import { branchSlug, findWorktree, gitError, parseWorktrees } from "./worktree.js";
import { titleSlug } from "./review.js";
import { ISSUE_LIMIT, limitNote } from "./forge.js";

/** The note of a Branch tab read that could not find the default branch. */
export const DEFAULT_BRANCH_NOTE = "Could not read the default branch, so it is listed too.";

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

/** The refusal for a worktree folder that already exists. */
export function folderExistsMessage(path) {
  return `The folder ${path} already exists. Remove it or pick another branch.`;
}

/**
 * The refusal for a branch name that git rejects or rewrites (`@{-1}` expands to another name); null when valid.
 * @param {string} branch
 * @param {{code: number, stdout: string, stderr: string}} reply `check-ref-format --branch` result.
 * @returns {string|null}
 */
export function branchNameError(branch, reply) {
  if (reply.code !== 0) return gitError(reply);
  return String(reply.stdout ?? "").trim() === branch ? null : `git: '${branch}' is not a valid branch name`;
}

/**
 * The commits of the local branch the remote lacks, and the other way, from `git rev-list --left-right --count`.
 * @param {string} stdout
 * @returns {{ahead: number, behind: number}|null}
 */
export function aheadBehind(stdout) {
  const match = /^(\d+)\s+(\d+)$/.exec(String(stdout ?? "").trim());
  return match === null ? null : { ahead: Number(match[1]), behind: Number(match[2]) };
}

/**
 * What to do with a local branch before its worktree: use it ("add"), move it up to the remote ("fastForward"),
 * or use it as it is and tell the person ("note").
 * @param {{ahead: number, behind: number}} counts
 * @returns {"add"|"fastForward"|"note"}
 */
export function localBranchStep({ ahead, behind }) {
  if (ahead > 0) return "note";
  return behind > 0 ? "fastForward" : "add";
}

/** The note for a local branch that is ahead of the remote branch, or has diverged. */
export function branchNote(branch, { ahead, behind }) {
  return `The local branch ${branch} is ${ahead} ahead and ${behind} behind origin/${branch}.`;
}

/** The arguments that move a local branch to `origin` only while it still points at `local`. */
export function fastForwardArgs(branch, origin, local) {
  return ["update-ref", `refs/heads/${branch}`, origin, local];
}

/** The arguments that list one branch of the remote. */
export function remoteBranchArgs(branch) {
  return ["ls-remote", "--heads", "origin", `refs/heads/${branch}`];
}

/**
 * Whether `remoteBranchArgs` output names the branch.
 * @param {string} stdout
 * @param {string} branch
 * @returns {boolean}
 */
export function remoteHasBranch(stdout, branch) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .some((line) => line.split("\t")[1] === `refs/heads/${branch}`);
}

/**
 * Whether no fetch refspec of the remote stores `branch` (a single-branch clone), from `remote.origin.fetch` values.
 * @param {string} stdout
 * @param {string} branch
 * @returns {boolean}
 */
export function refspecMissing(stdout, branch) {
  const stores = (line) => {
    const spec = line.trim().replace(/^\+/, "");
    return spec === `refs/heads/${branch}:refs/remotes/origin/${branch}` || spec === "refs/heads/*:refs/remotes/origin/*";
  };
  return !String(stdout ?? "").split(/\r?\n/).some(stores);
}

/** The worktree path for `branch` of the repo at `localPath`. */
function pathFor(root, localPath, branch) {
  const folder = localPath.replace(/\/+$/, "").split("/").pop();
  return `${root}/${folder}/${branchSlug(branch)}`;
}

/**
 * Opens the worktree that holds a remote branch, else plans the create. A local branch of the same name stays
 * as it is, and `compare` tells how it differs from the fetched remote branch. Without one, `add` makes the
 * branch with no tracking (a single-branch clone cannot track), then `track` sets its upstream, and `refspec`
 * is added to the remote when `refspecs` output shows none stores the branch. `prune` clears a stale entry.
 * @param {{branch: string, localPath: string, root: string, porcelain: string, localExists: boolean}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, branch: string, prune: string[]|null, check: string[], fetch: string[], compare: string[]|null, add: string[], newBranch: boolean, track: string[][]|null, refspecs: string[], refspec: string}}
 */
export function remoteBranchPlan({ branch, localPath, root, porcelain, localExists }) {
  const existing = findWorktree(porcelain, branch);
  if (existing.path !== null) return { kind: "open", path: existing.path };
  const path = pathFor(root, localPath, branch);
  const remoteRef = `refs/remotes/origin/${branch}`;
  const refspec = `+refs/heads/${branch}:${remoteRef}`;
  return {
    kind: "create",
    path,
    branch,
    prune: existing.prune,
    check: ["check-ref-format", "--branch", branch],
    fetch: ["fetch", "--no-tags", "origin", refspec],
    compare: localExists ? ["rev-list", "--left-right", "--count", `refs/heads/${branch}...${remoteRef}`] : null,
    add: localExists ? ["worktree", "add", path, branch] : ["worktree", "add", "--no-track", "-b", branch, path, remoteRef],
    newBranch: !localExists,
    track: localExists
      ? null
      : [
          ["config", `branch.${branch}.remote`, "origin"],
          ["config", `branch.${branch}.merge`, `refs/heads/${branch}`],
        ],
    refspecs: ["config", "--get-all", "remote.origin.fetch"],
    refspec,
  };
}

/**
 * The local branch name for an issue: the number and the title slug. A title with no ASCII letters or digits
 * gives the number alone.
 * @param {number} number
 * @param {string} title
 * @returns {string}
 */
export function issueBranch(number, title) {
  const slug = titleSlug(title);
  return slug === "" ? String(number) : `${number}-${slug}`;
}

/**
 * Opens the worktree of an issue branch, else plans a new worktree. A new branch is cut from the fetched
 * default branch with no upstream. An existing local branch gets a worktree with no fetch and no reset.
 * `check` validates the branch name first; `fetch` is null when no fetch is needed; `prune` clears a stale entry.
 * @param {{number: number, title: string, defaultBranch: string, localPath: string, root: string, porcelain: string, localExists: boolean}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, branch: string, prune: string[]|null, check: string[], fetch: string[]|null, add: string[], newBranch: boolean}}
 */
export function issuePlan({ number, title, defaultBranch, localPath, root, porcelain, localExists }) {
  const branch = issueBranch(number, title);
  const existing = findWorktree(porcelain, branch);
  if (existing.path !== null) return { kind: "open", path: existing.path };
  const path = pathFor(root, localPath, branch);
  const check = ["check-ref-format", "--branch", branch];
  const prune = existing.prune;
  if (localExists) return { kind: "create", path, branch, prune, check, fetch: null, add: ["worktree", "add", path, branch], newBranch: false };
  return {
    kind: "create",
    path,
    branch,
    prune,
    check,
    newBranch: true,
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
