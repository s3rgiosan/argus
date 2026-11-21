// The Merged worktrees view: which linked worktrees have a merged pull request, which of them
// may be removed, and when the local branch may be deleted after the worktree is gone.

import { branchDelete, linkedWorktrees, reviewNumber } from "./review.js";
import { localFolders } from "./remote.js";
import { byMergedAt } from "./model.js";

/** @typedef {{number: number, headSha: string, mergedAt: string|null, base: string|null}} Merged */
/** @typedef {{path: string, branch: string, head: string|null, locked: boolean, prunable: boolean, review: number|null}} Worktree */
/** @typedef {null|"locked"|"has changes"|"has submodules"|"has unsaved commits"|"open in a space"|"has an open pull request"|`merged into ${string}`|"not at the merged commit"} Reason */
/** @typedef {{path: string, branch: string, number: number, mergedAt: string|null, headSha: string, review: boolean, reason: Reason, ignored: string[], prunable: boolean}} Row */

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

/**
 * The arguments that list a worktree's changes; empty output means it has none. `--untracked-files=all`
 * overrides `status.showUntrackedFiles=no`, because `git worktree remove` deletes untracked files.
 */
export function statusArgs() {
  return ["status", "--porcelain", "--untracked-files=all"];
}

/** The arguments that list the commits of a worktree's HEAD reflog, at most 200. */
export function reflogArgs() {
  return ["log", "-g", "--max-count=200", "--format=%H", "HEAD"];
}

/**
 * The commits in `reflogArgs` output, each once.
 * @param {string} stdout
 * @returns {string[]}
 */
export function reflogShas(stdout) {
  return [...new Set(String(stdout ?? "").split(/\r?\n/).filter((line) => /^[0-9a-f]{40}$/.test(line)))];
}

/**
 * The arguments that print a commit that no branch, remote or tag reaches. Null when there is
 * no commit to check.
 * @param {string[]} shas
 * @returns {string[]|null}
 */
export function unsavedArgs(shas) {
  return shas.length === 0 ? null : ["rev-list", "--max-count=1", ...shas, "--not", "--branches", "--remotes", "--tags"];
}

/** True when a command printed something. */
export function hasOutput(stdout) {
  return String(stdout ?? "").trim() !== "";
}

/** The arguments that list a worktree's submodules. `git worktree remove` refuses such a worktree. */
export function submoduleArgs() {
  return ["submodule", "status"];
}

/**
 * The result text of a row that changed after the list was read, or null when it is still safe.
 * @param {{ignored: string[], prunable?: boolean}} row
 * @param {string|null} statusStdout `statusArgs` output, or null when the command failed.
 * @param {string[]|null} ignoredEntries `ignoredOf` entries, or null when the command failed.
 * @returns {null|"has changes"|"ignored files changed"}
 */
export function recheck(row, statusStdout, ignoredEntries) {
  if (row.prunable) return null;
  if (statusStdout === null || statusStdout.trim() !== "") return "has changes";
  if (ignoredEntries === null || ignoredEntries.some((entry) => !row.ignored.includes(entry))) return "ignored files changed";
  return null;
}

/**
 * The worktrees that a local space holds: the space's folder or one of its terminals' folders
 * is inside the worktree.
 * @param {Worktree[]} worktrees
 * @param {Parameters<typeof localFolders>[0]} spaces
 * @param {Parameters<typeof localFolders>[1]} panes
 * @returns {Set<string>}
 */
export function worktreesInSpaces(worktrees, spaces, panes) {
  const folders = localFolders(spaces, panes);
  return new Set(worktrees.filter((worktree) => folders.some((folder) => insideFolder(folder, worktree.path))).map((worktree) => worktree.path));
}

/**
 * The arguments that list a worktree's ignored files and folders. `git worktree remove` deletes
 * them, and `git status` does not show them.
 */
export function ignoredArgs() {
  return ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"];
}

/**
 * The entries in `ignoredArgs` output.
 * @param {string} stdout
 * @returns {string[]}
 */
export function ignoredOf(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line !== "");
}

/**
 * The paths ticked when the list opens: rows that may go and hold no ignored files.
 * A row with ignored files may still be ticked by hand.
 * @param {Row[]} rows
 * @returns {Set<string>}
 */
export function tickedByDefault(rows) {
  return new Set(rows.filter((row) => row.reason === null && row.ignored.length === 0).map((row) => row.path));
}

/**
 * True when opening the view starts a read: only before the first list, and after Done
 * clears the finished results.
 * @param {object|null} state
 * @returns {boolean}
 */
export function readsOnOpen(state) {
  return state === null;
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
 * A row has a reason when it must stay; the first reason that applies wins. A merged pull request
 * counts only when its base is the default branch; with no known default branch, any base counts.
 * @param {{worktrees: Worktree[], merged: Record<string, Merged[]>, reviewMerged: Record<number, Merged|null>,
 *   dirty: Set<string>, inSpace: Set<string>, openBranches: Set<string>, ignored?: Record<string, string[]>,
 *   submodules?: Set<string>, unsaved?: Set<string>, defaultBranch?: string|null}} input
 *   `merged` is keyed by branch, newest first; `reviewMerged` by pull request number; `ignored` by path.
 * @returns {Row[]}
 */
export function rowsFor({ worktrees, merged, reviewMerged, dirty, inSpace, openBranches, ignored = {}, submodules = new Set(), unsaved = new Set(), defaultBranch = null }) {
  const rows = [];
  const intoDefault = (entry) => defaultBranch === null || entry.base === null || entry.base === defaultBranch;
  for (const worktree of worktrees) {
    const review = worktree.review !== null;
    let pull = null;
    let newer = false;
    let otherBase = null;
    if (review) {
      pull = Object.hasOwn(reviewMerged, worktree.review) ? reviewMerged[worktree.review] : null;
      if (pull !== null && !intoDefault(pull)) otherBase = pull.base;
    } else {
      const all = Object.hasOwn(merged, worktree.branch) ? merged[worktree.branch] : [];
      const list = all.filter(intoDefault);
      if (list.length === 0 && all.length > 0) {
        pull = all[0];
        otherBase = pull.base;
      } else {
        pull = list.find((entry) => entry.headSha === worktree.head) ?? null;
        // No merged head is the tip: the branch has commits that the pull request did not merge.
        if (pull === null && list.length > 0) {
          pull = list[0];
          newer = true;
        }
      }
    }
    if (pull === null) continue;
    let reason = null;
    if (worktree.locked) reason = "locked";
    else if (!worktree.prunable && dirty.has(worktree.path)) reason = "has changes";
    else if (submodules.has(worktree.path)) reason = "has submodules";
    else if (unsaved.has(worktree.path)) reason = "has unsaved commits";
    else if (inSpace.has(worktree.path)) reason = "open in a space";
    else if (openBranches.has(worktree.branch)) reason = "has an open pull request";
    else if (otherBase !== null) reason = `merged into ${otherBase}`;
    else if (newer) reason = "not at the merged commit";
    const files = Object.hasOwn(ignored, worktree.path) ? ignored[worktree.path] : [];
    rows.push({ path: worktree.path, branch: worktree.branch, number: pull.number, mergedAt: pull.mergedAt, headSha: pull.headSha, review, reason, ignored: files, prunable: worktree.prunable });
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
  if (tipNow !== row.headSha) return { args: null, kept: "not at the merged commit" };
  return { args: ["branch", "-D", row.branch], kept: null };
}

/**
 * How many worktrees have a merged pull request, for the board's count. A review worktree counts
 * by its number. Any other counts when a merged head has its branch and its head commit, and the
 * default branch as base (any base when either is unknown). No status checks run here.
 * @param {Worktree[]} worktrees
 * @param {import("./model.js").MergedHead[]} heads
 * @param {string|null} defaultBranch
 * @returns {number}
 */
export function countMerged(worktrees, heads, defaultBranch) {
  const numbers = new Set(heads.map((entry) => entry.number));
  let count = 0;
  for (const worktree of worktrees) {
    if (worktree.review !== null) {
      if (numbers.has(worktree.review)) count += 1;
      continue;
    }
    const match = heads.some(
      (entry) => entry.branch === worktree.branch && entry.headSha === worktree.head && (defaultBranch === null || entry.base === null || entry.base === defaultBranch),
    );
    if (match) count += 1;
  }
  return count;
}

/** How long a merged heads list stays in use while the candidate worktrees stay the same. */
export const MERGED_HEADS_TTL_MS = 15 * 60 * 1000;

/**
 * A text that is the same for the same set of candidate worktrees: each branch with its head.
 * @param {Array<{branch: string, head?: string|null}>} worktrees
 * @returns {string}
 */
export function candidateSignature(worktrees) {
  return worktrees
    .map((worktree) => `${worktree.branch}@${worktree.head ?? ""}`)
    .sort()
    .join("\n");
}

/**
 * True when a kept merged heads list may answer a count: it was read less than MERGED_HEADS_TTL_MS
 * ago for the same candidate worktrees.
 * @param {{signature: string, at: number}|undefined|null} cached
 * @param {string} signature
 * @param {number} now
 * @returns {boolean}
 */
export function mergedHeadsFresh(cached, signature, now) {
  if (!cached) return false;
  return cached.signature === signature && now - cached.at >= 0 && now - cached.at < MERGED_HEADS_TTL_MS;
}

/**
 * The view state the board's Review link keeps: a list that has no removal results goes, so the
 * view reads again and shows the merged worktrees the board counted. Running work and results stay.
 * @param {object|null} state
 * @returns {object|null}
 */
export function freshForReview(state) {
  if (state === null) return null;
  const results = Object.keys(state.results ?? {}).length;
  return state.phase === "list" && results === 0 ? null : state;
}

/**
 * A limiter for work that starts processes: at most `max` tasks run at once, and the other tasks
 * wait in order. Several nested lists of work can share one limiter.
 * @param {number} max A value below 1 counts as 1.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(max) {
  const cap = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  /** @type {Array<{task: () => Promise<unknown>, resolve: (value: unknown) => void, reject: (error: unknown) => void}>} */
  const waiting = [];
  const next = () => {
    if (active >= cap || waiting.length === 0) return;
    const { task, resolve, reject } = /** @type {(typeof waiting)[number]} */ (waiting.shift());
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}

/** How many items the project's merged list asks for (`ghMergedListArgs`, `GL_MERGED_LIST_QUERY`). */
export const MERGED_LIST_LIMIT = 100;

/** How many merged pull requests the per-branch read asks for (`ghMergedArgs`, `GL_MERGED_QUERY`). */
export const BRANCH_MERGED_LIMIT = 10;

/**
 * The forge answers that the project's merged list gives for the Merged worktrees view, and the
 * worktrees that still need their own read. The answers are the same as the per-worktree reads:
 * - A review worktree is answered when its number is in the list. A list below its limit is
 *   complete, so a number that is not in it has no merged pull request.
 * - Any other worktree is answered only from a complete list, and only when the list has at most
 *   BRANCH_MERGED_LIMIT entries for its branch. Its entries leave out forks and are sorted newest merge first.
 * @param {Worktree[]} worktrees
 * @param {import("./model.js").MergedList|null} list Null when the list read failed.
 * @returns {{merged: Record<string, Merged[]>, reviewMerged: Record<number, Merged|null>, rest: Worktree[]}}
 */
export function answerFromList(worktrees, list) {
  /** @type {Record<string, Merged[]>} */
  const merged = {};
  /** @type {Record<number, Merged|null>} */
  const reviewMerged = {};
  /** @type {Worktree[]} */
  const rest = [];
  if (list === null) return { merged, reviewMerged, rest: [...worktrees] };
  const complete = list.total < MERGED_LIST_LIMIT;
  for (const worktree of worktrees) {
    if (worktree.review !== null) {
      const entry = list.entries.find((item) => item.number === worktree.review);
      if (entry !== undefined) reviewMerged[worktree.review] = entry.merged;
      else if (complete) reviewMerged[worktree.review] = null;
      else rest.push(worktree);
      continue;
    }
    const forBranch = list.entries.filter((item) => item.branch === worktree.branch);
    if (!complete || forBranch.length > BRANCH_MERGED_LIMIT) {
      rest.push(worktree);
      continue;
    }
    merged[worktree.branch] = forBranch
      .filter((item) => !item.cross && item.merged !== null)
      .map((item) => /** @type {Merged} */ (item.merged))
      .sort(byMergedAt);
  }
  return { merged, reviewMerged, rest };
}
