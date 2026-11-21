// Copied from lib/worktree.js by scripts/sync-lib.mjs: edit lib/worktree.js, then run it.
//
// Plans git worktrees: where they live, branch and folder names, the worktree
// list, and the git commands that start a worktree from a remote branch or an
// issue. The functions are pure; the caller runs the commands.

import { compareNames } from "./follow.js";
import { expandHome } from "./paths.js";

const DEFAULT_DIRECTORY = "~/.herdr/worktrees";

/** The most characters the title part of a branch name takes. */
const SLUG_LENGTH = 40;

/** The arguments that list the worktrees of a clone in porcelain form. */
export function worktreeListArgs() {
  return ["worktree", "list", "--porcelain"];
}

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
  let path = trimmed.replace(/\\/g, "/");
  if (path === "~" || path.startsWith("~/")) path = expandHome(path, home.replace(/\\/g, "/"));
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
  if (name && !/^\.+$/.test(name)) return name;
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return `branch-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

/**
 * The title as lowercase ASCII words joined by `-`, at most SLUG_LENGTH characters, or "" when nothing is left.
 * @param {string} title
 * @returns {string}
 */
export function titleSlug(title) {
  const words = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return words.slice(0, SLUG_LENGTH).replace(/-+$/, "");
}

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

/**
 * The worktree path for `branch` of the repo at `localPath`: `<root>/<repo folder>/<branch slug>`.
 * @param {string} root
 * @param {string} localPath
 * @param {string} branch
 * @returns {string}
 */
export function worktreePath(root, localPath, branch) {
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
  const path = worktreePath(root, localPath, branch);
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
  const path = worktreePath(root, localPath, branch);
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
    fetch: ["fetch", "--no-tags", "origin", "--", defaultBranch],
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
