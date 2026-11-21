// Copied from lib/worktree-runner.js by scripts/sync-lib.mjs: edit lib/worktree-runner.js, then run it.
//
// Runs the git commands that lib/worktree.js plans: it starts a worktree on a
// remote branch or for an issue and opens its space. Herdr's functions come in
// as parameters, so Node can test the runner.

import { GL_DEFAULT_BRANCH_QUERY, ghDefaultBranchArgs, glabArgs, parseGhDefaultBranch, parseGlDefaultBranch } from "./forge-cli.js";
import {
  aheadBehind,
  branchNameError,
  branchNote,
  defaultBranchArgs,
  defaultBranchOf,
  fastForwardArgs,
  folderExistsMessage,
  gitError,
  issueBranch,
  issuePlan,
  localBranchStep,
  refspecMissing,
  remoteBranchArgs,
  remoteBranchPlan,
  remoteHasBranch,
  spaceFor,
  tipArgs,
  worktreeListArgs,
  worktreeRoot,
} from "./worktree.js";

/** The timeout of one quick git call, in ms. */
export const GIT_TIMEOUT = 15_000;

/** The timeout of a git call that may fetch or write many files, in ms. Herdr's cap. */
export const GIT_LONG_TIMEOUT = 600_000;

/**
 * @typedef {{code: number, stdout: string, stderr: string}} Reply
 * @typedef {{provider: "github"|"gitlab", host: string, repo: string, key: string, localPath: string}} Project A project with a local checkout.
 * @typedef {{error: string|null, note: string|null}} Outcome `error` is null on success; `note` is a line to show even then.
 */

/**
 * A worktree runner for one copy of a mod.
 * @param {object} deps
 * @param {(command: string, args: string[], options?: {cwd?: string, timeout?: number}) => Promise<Reply>} deps.exec Herdr's `exec`.
 * @param {(path: string) => Promise<string|null>} deps.readTextFile Herdr's `readTextFile`.
 * @param {() => string} deps.appHome Herdr's `appHome`.
 * @param {() => string} deps.home Herdr's `home`.
 * @param {(command: string, args: object) => unknown} deps.run Herdr's `run`.
 * @param {() => any[]} deps.spaces Herdr's `spaces`.
 * @param {() => any[]} deps.panes Herdr's `panes`.
 * @param {{locate(name: "gh"|"glab"): Promise<?string>, attempt: Function}} deps.forge The mod's forge runner, for the default branch when git does not know it.
 */
export function createWorktreeRunner({ exec, readTextFile, appHome, home, run, spaces, panes, forge }) {
  /** The worktrees folder from Herdr's settings.json, or an error text. */
  async function root() {
    return worktreeRoot(await readTextFile(`${appHome()}/settings.json`), home());
  }

  /** The worktrees folder and the worktree list of a clone; an error text instead when either fails. */
  async function context(localPath) {
    const resolved = await root();
    if ("error" in resolved) return { error: resolved.error };
    const list = await exec("git", worktreeListArgs(), { cwd: localPath, timeout: GIT_TIMEOUT });
    if (list.code !== 0) return { error: gitError(list) };
    return { root: resolved.root, porcelain: list.stdout };
  }

  /** Whether something is at `path`, a dangling link included. */
  async function folderTaken(path) {
    const found = await exec("test", ["-e", path], { timeout: GIT_TIMEOUT });
    if (found.code === 0) return true;
    const link = await exec("test", ["-L", path], { timeout: GIT_TIMEOUT });
    return link.code === 0;
  }

  /** Selects the local space that shows a worktree folder, or opens a new space there. */
  function openWorktreeSpace(path) {
    const id = spaceFor(spaces(), panes(), path);
    if (id !== null) run("space.select", { id });
    else run("space.new", { folder: path });
  }

  /** Runs `worktree add`. A failed add deletes the branch it made. Gives an error text, or null on success. */
  async function addWorktree(git, plan) {
    const added = await git(plan.add);
    if (added.code === 0) return null;
    if (plan.newBranch) await git(["branch", "-D", plan.branch]);
    return gitError(added);
  }

  /** The default branch of a project: the remote's HEAD, else the forge's answer, else null. */
  async function defaultBranch(project) {
    const head = await exec("git", defaultBranchArgs(), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    const local = head.code === 0 ? defaultBranchOf(head.stdout) : null;
    if (local !== null) return local;
    const github = project.provider === "github";
    const command = await forge.locate(github ? "gh" : "glab");
    if (command === null) return null;
    const args = github ? ghDefaultBranchArgs(project.repo) : glabArgs(project.host, GL_DEFAULT_BRANCH_QUERY, { path: project.repo });
    return forge.attempt(github ? "gh" : `glab (${project.host})`, command, args, github ? parseGhDefaultBranch : parseGlDefaultBranch, []);
  }

  /**
   * Starts a worktree on a remote branch and opens its space. A worktree that holds the branch
   * already opens as it is. A local branch of the same name moves up to the remote when it is only
   * behind, and is used as it is with a note when it has commits of its own.
   * @param {Project} project
   * @param {string} branch
   * @returns {Promise<Outcome>}
   */
  async function branchWorktree(project, branch) {
    const fail = (error) => ({ error, note: null });
    const found = await context(project.localPath);
    if ("error" in found) return fail(found.error);
    const exists = await exec("git", tipArgs(branch), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    const plan = remoteBranchPlan({ branch, localPath: project.localPath, root: found.root, porcelain: found.porcelain, localExists: exists.code === 0 });
    if (plan.kind === "open") {
      openWorktreeSpace(plan.path);
      return { error: null, note: null };
    }
    const git = (args) => exec("git", args, { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
    const invalid = branchNameError(branch, await git(plan.check));
    if (invalid !== null) return fail(invalid);
    if (await folderTaken(plan.path)) return fail(folderExistsMessage(plan.path));
    if (plan.prune !== null) {
      const pruned = await git(plan.prune);
      if (pruned.code !== 0) return fail(gitError(pruned));
    }
    const fetched = await git(plan.fetch);
    if (fetched.code !== 0) return fail(gitError(fetched));
    let note = null;
    if (plan.compare !== null) {
      const counted = await git(plan.compare);
      if (counted.code !== 0) return fail(gitError(counted));
      const counts = aheadBehind(counted.stdout);
      if (counts === null) return fail(`git: could not compare the local branch ${branch} with origin/${branch}`);
      const step = localBranchStep(counts);
      if (step === "note") note = branchNote(branch, counts);
      if (step === "fastForward") {
        const local = await git(tipArgs(branch));
        const origin = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
        if (local.code !== 0 || origin.code !== 0) return fail(`git: could not read the tips of ${branch}`);
        const moved = await git(fastForwardArgs(branch, origin.stdout.trim(), local.stdout.trim()));
        if (moved.code !== 0) return fail(gitError(moved));
      }
    }
    const failed = await addWorktree(git, plan);
    if (failed !== null) return fail(failed);
    if (plan.track !== null) {
      // The upstream is set by hand: `--track` fails in a single-branch or shallow clone.
      const specs = await git(plan.refspecs);
      const steps = [...plan.track];
      if (refspecMissing(specs.stdout, branch)) steps.push(["config", "--add", "remote.origin.fetch", plan.refspec]);
      for (const step of steps) {
        const set = await git(step);
        if (set.code === 0) continue;
        await git(["worktree", "remove", "--force", plan.path]);
        await git(["branch", "-D", branch]);
        return fail(gitError(set));
      }
    }
    run("space.new", { folder: plan.path });
    return { error: null, note };
  }

  /**
   * Starts a worktree on the branch of an issue (`issueBranch`: the number and the title slug)
   * and opens its space. A worktree that holds the branch opens as it is. A branch of that name
   * on the remote is used as it is (`branchWorktree`); else a new branch is cut from the fetched
   * default branch, with no upstream.
   * @param {Project} project
   * @param {{number: number, title: string}} issue
   * @returns {Promise<Outcome>}
   */
  async function createIssueWorktree(project, issue) {
    const fail = (error) => ({ error, note: null });
    const found = await context(project.localPath);
    if ("error" in found) return fail(found.error);
    const branch = issueBranch(issue.number, issue.title);
    const exists = await exec("git", tipArgs(branch), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    if (exists.code !== 0) {
      const remote = await exec("git", remoteBranchArgs(branch), { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
      if (remote.code !== 0) return fail(gitError(remote));
      if (remoteHasBranch(remote.stdout, branch)) return branchWorktree(project, branch);
    }
    const base = await defaultBranch(project);
    if (base === null) return fail("Could not read the default branch of the repo.");
    const plan = issuePlan({ number: issue.number, title: issue.title, defaultBranch: base, localPath: project.localPath, root: found.root, porcelain: found.porcelain, localExists: exists.code === 0 });
    if (plan.kind === "open") {
      openWorktreeSpace(plan.path);
      return { error: null, note: null };
    }
    const git = (args) => exec("git", args, { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
    const invalid = branchNameError(branch, await git(plan.check));
    if (invalid !== null) return fail(invalid);
    if (await folderTaken(plan.path)) return fail(folderExistsMessage(plan.path));
    if (plan.prune !== null) {
      const pruned = await git(plan.prune);
      if (pruned.code !== 0) return fail(gitError(pruned));
    }
    if (plan.fetch !== null) {
      const fetched = await git(plan.fetch);
      if (fetched.code !== 0) return fail(gitError(fetched));
    }
    const failed = await addWorktree(git, plan);
    if (failed !== null) return fail(failed);
    run("space.new", { folder: plan.path });
    return { error: null, note: null };
  }

  return { root, context, folderTaken, openWorktreeSpace, defaultBranch, branchWorktree, createIssueWorktree };
}
