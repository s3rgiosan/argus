// Plans a worktree checkout of a PR: where worktrees live, the branch name, and the git commands.

import { fetchRef } from "./forge.js";

/** @typedef {import("./model.js").Pr} Pr */

const DEFAULT_DIRECTORY = "~/.herdr/worktrees";

/**
 * Resolves the worktree root from the text of settings.json (null when the file is missing).
 * @param {?string} settingsText
 * @param {string} home
 * @returns {{root: string}|{error: string}}
 */
export function worktreeRoot(settingsText, home) {
  let settings = {};
  if (settingsText !== null) {
    try {
      settings = JSON.parse(settingsText);
    } catch (error) {
      return { error: `settings.json: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const directory = settings?.worktrees?.directory ?? DEFAULT_DIRECTORY;
  const trimmed = typeof directory === "string" ? directory.trim() : "";
  if (trimmed === "") {
    return { error: "worktrees.directory must be a non-empty path." };
  }
  let path = directory.replace(/\\/g, "/");
  if (path === "~" || path.startsWith("~/")) {
    path = home.replace(/\\/g, "/").replace(/\/$/, "") + path.slice(1);
  }
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path)) {
    return { error: "worktrees.directory must be an absolute path or start with ~/." };
  }
  return { root: path.replace(/\/+$/, "") };
}

/**
 * One-line error text for a failed git call: the last `fatal:` or `error:` line of
 * stderr, else its last line, else the last line of stdout, else the exit code.
 * @param {{code: number, stdout: string, stderr: string}} reply
 * @returns {string}
 */
export function gitError(reply) {
  const lines = (text) =>
    String(text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  const err = lines(reply.stderr);
  const marked = err.filter((line) => line.startsWith("fatal:") || line.startsWith("error:"));
  const line = marked.at(-1) ?? err.at(-1) ?? lines(reply.stdout).at(-1);
  return `git: ${line ?? `exited with code ${reply.code}`}`;
}

/**
 * Turns a branch name into a folder name. A name with no usable characters gets a hash of the original.
 * @param {string} branch
 * @returns {string}
 */
export function branchSlug(branch) {
  const normalized = branch.normalize("NFC");
  const name = normalized.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  if (name) return name;
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return `branch-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The local branch that holds a PR's head.
 * @param {Pr} pr
 * @returns {string}
 */
export function checkoutBranch(pr) {
  return `${pr.provider === "gitlab" ? "mr" : "pr"}/${pr.number}`;
}

/**
 * Reads the output of `git worktree list --porcelain`.
 * @param {string} porcelain
 * @returns {Array<{path: string, branch: ?string, prunable: boolean}>}
 */
export function parseWorktrees(porcelain) {
  const result = [];
  for (const block of String(porcelain).split(/\r?\n\r?\n/)) {
    let path = null;
    let branch = null;
    let prunable = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "prunable" || line.startsWith("prunable ")) prunable = true;
    }
    if (path !== null) result.push({ path, branch, prunable });
  }
  return result;
}

/**
 * The worktree that holds `branch`. A prunable entry has no folder, so it gives no path and asks for a prune.
 * @param {string} porcelain
 * @param {string} branch
 * @returns {{path: ?string, prune: string[]|null}}
 */
export function findWorktree(porcelain, branch) {
  const found = parseWorktrees(porcelain).find((worktree) => worktree.branch === branch);
  if (!found) return { path: null, prune: null };
  return found.prunable ? { path: null, prune: ["worktree", "prune"] } : { path: found.path, prune: null };
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
  const folder = localPath.replace(/\/+$/, "").split("/").pop();
  const path = `${root}/${folder}/${branchSlug(branch)}`;
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

/**
 * The id of the first local space whose folder, or one of whose terminals' folders, is inside the path.
 * @param {Array<{id: string, folder: string, machine: ?string, tabs: Array<{id: string}>}>} spaces
 * @param {Array<{tab: string, terminal: ?string, cwd: ?string}>} panes
 * @param {string} path
 * @returns {?string}
 */
export function spaceFor(spaces, panes, path) {
  const base = path.replace(/\/+$/, "");
  const inside = (folder) => typeof folder === "string" && (folder === base || folder.startsWith(`${base}/`));
  for (const space of spaces) {
    if (space.machine) continue;
    if (inside(space.folder)) return space.id;
    const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
    if (panes.some((pane) => pane.terminal && tabs.has(pane.tab) && inside(pane.cwd))) return space.id;
  }
  return null;
}
