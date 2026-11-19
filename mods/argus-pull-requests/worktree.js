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
  if (typeof directory !== "string" || directory.trim() === "") {
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
 * @returns {Array<{path: string, branch: ?string}>}
 */
export function parseWorktrees(porcelain) {
  const result = [];
  for (const block of String(porcelain).split(/\r?\n\r?\n/)) {
    let path = null;
    let branch = null;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    if (path !== null) result.push({ path, branch });
  }
  return result;
}

/**
 * Opens the worktree that already holds the PR branch, else plans a fetch and a new worktree.
 * @param {{pr: Pr, localPath: string, root: string, porcelain: string}} input
 * @returns {{kind: "open", path: string}|{kind: "create", path: string, cwd: string, fetch: string[], add: string[]}}
 */
export function checkoutPlan({ pr, localPath, root, porcelain }) {
  const branch = checkoutBranch(pr);
  const existing = parseWorktrees(porcelain).find((worktree) => worktree.branch === branch);
  if (existing) return { kind: "open", path: existing.path };
  const folder = localPath.replace(/\/+$/, "").split("/").pop();
  const path = `${root}/${folder}/${branchSlug(branch)}`;
  return {
    kind: "create",
    path,
    cwd: localPath,
    fetch: ["fetch", "--no-tags", "origin", `${fetchRef(pr.provider, pr.number)}:refs/heads/${branch}`],
    add: ["worktree", "add", path, branch],
  };
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
