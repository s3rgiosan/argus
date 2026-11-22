// Copied from lib/forge-runner.js by scripts/sync-lib.mjs: edit lib/forge-runner.js, then run it.
//
// Runs the git, gh and glab reads that every forge board needs: finding gh and
// glab, one read with its note on failure, the glab login per host, the GitLab
// username, and the probe of each open folder. One runner belongs to one copy
// of a mod and keeps what it found until `clear()`. Herdr's `exec` comes in as
// a parameter, so Node can test the runner.

import { mapPool } from "./pool.js";
import { GL_USERNAME_QUERY, cliError, commandCandidates, glabArgs, glabAuthArgs, glabLoginNote, glabLoginState, parseGlUsername } from "./forge-cli.js";
import { mergeProjects, needsGlabLogin, needsProbe, parseRevParse, remoteArgs, revParseArgs } from "./remote.js";

/** How many git, gh or glab calls a board read runs at once. */
export const CLI_CONCURRENCY = 4;

/** The timeout of one gh or glab call, in ms. */
export const CLI_TIMEOUT = 30_000;

/** How long a command that was not found stays cached before the next lookup, in ms. */
export const MISSING_TTL_MS = 60_000;

/** The timeout of one quick git call, in ms. */
export const GIT_TIMEOUT = 15_000;

/**
 * @typedef {{code: number, stdout: string, stderr: string}} Reply
 * @typedef {(command: string, args: string[], options?: {cwd?: string, timeout?: number}) => Promise<Reply>} Exec
 * @typedef {{folder: string, top: string, main: string, remote: ?string}} Entry
 */

/**
 * A runner for one copy of a mod.
 * @param {{exec: Exec, home: () => string, settings: () => {gh: string, glab: string}, now?: () => number}} deps
 *   `settings` gives the gh and glab command settings at the time of each lookup.
 */
export function createForgeRunner({ exec, home, settings, now = Date.now }) {
  /** @type {Record<"gh"|"glab", {setting: string, result: Promise<?string>, missingAt: ?number}|null>} */
  let located = { gh: null, glab: null };
  // glab command and host -> the check that runs now, or the "signed-in" answer of an earlier one.
  const glabHosts = new Map();
  // glab command and host -> the signed-in username.
  const glUsers = new Map();
  // Folder -> {entry, at}: `entry` is the repository, or null when the folder is not one. `at` is the probe time.
  const repoCache = new Map();
  // Folder -> the probe that runs now, and folder -> the time of the last probe that could not run.
  const probes = new Map();
  const probeFailed = new Map();

  /**
   * The command for `name` ("gh" or "glab"), or null when none runs. The first of the setting,
   * the bare name and the install folders whose `--version` runs wins. The result, found or
   * missing, is kept per setting value until the setting changes or `clear()`. A missing result
   * expires after MISSING_TTL_MS.
   * @param {"gh"|"glab"} name
   * @returns {Promise<?string>}
   */
  function locate(name) {
    const setting = settings()[name];
    const cached = located[name];
    const missingFor = cached?.missingAt == null ? null : now() - cached.missingAt;
    const expired = missingFor !== null && missingFor >= MISSING_TTL_MS;
    if (cached?.setting === setting && !expired) return cached.result;
    const result = (async () => {
      for (const command of commandCandidates(setting, name, home())) {
        try {
          const reply = await exec(command, ["--version"], { timeout: CLI_TIMEOUT });
          if (reply.code === 0) return command;
        } catch {
          continue;
        }
      }
      return null;
    })();
    const entry = { setting, result, missingAt: null };
    result.then((command) => {
      if (command === null) entry.missingAt = now();
    });
    located = { ...located, [name]: entry };
    return result;
  }

  /**
   * Runs `command` with `args` and parses its output. A failed run or a parse error adds one
   * note under `label` and gives null. When `recover` gives a value for a reply with a non-zero
   * exit code, that value is the result and no note is added.
   * @template T
   * @param {string} label
   * @param {string} command
   * @param {string[]} args
   * @param {(stdout: string) => T} parse
   * @param {string[]} notes
   * @param {{recover?: (reply: Reply) => T|null}} [options]
   * @returns {Promise<T|null>}
   */
  async function attempt(label, command, args, parse, notes, { recover } = {}) {
    let reply;
    try {
      reply = await exec(command, args, { timeout: CLI_TIMEOUT });
    } catch (error) {
      notes.push(`${label}: ${error?.message ?? error}`);
      return null;
    }
    if (reply.code !== 0) {
      const value = recover ? recover(reply) : null;
      if (value !== null) return value;
      notes.push(cliError(label, reply));
      return null;
    }
    try {
      return parse(reply.stdout);
    } catch (error) {
      notes.push(`${label}: ${error?.message ?? error}`);
      return null;
    }
  }

  /**
   * Whether glab is signed in to `host` (`glabLoginState`). A check that cannot start or that
   * times out is "failed". Only "signed-in" is kept, per glab command and host until `clear()`,
   * so a signed-out host or a failed check is checked again on the next read.
   * @param {string} glab
   * @param {string} host
   * @returns {Promise<"signed-in"|"signed-out"|"failed">}
   */
  function glabLogin(glab, host) {
    const key = `${glab} ${host}`;
    const cached = glabHosts.get(key);
    if (cached) return cached;
    const result = (async () => {
      await null;
      let state;
      try {
        state = glabLoginState(await exec(glab, glabAuthArgs(host), { timeout: CLI_TIMEOUT }));
      } catch {
        state = "failed";
      }
      if (state !== "signed-in" && glabHosts.get(key) === result) glabHosts.delete(key);
      return state;
    })();
    glabHosts.set(key, result);
    return result;
  }

  /**
   * The GitLab projects that glab can read: every gitlab.com project, the projects on hosts that
   * glab is signed in to, and the projects on hosts whose check failed, so their own reads report
   * what fails. Each signed-out host adds one note and leaves the board until a read finds it
   * signed in.
   * @template {{host: string}} P
   * @param {string} glab
   * @param {P[]} projects
   * @param {string[]} notes
   * @returns {Promise<P[]>}
   */
  async function signedInGitLab(glab, projects, notes) {
    const hosts = [...new Set(projects.map((project) => project.host))].filter(needsGlabLogin);
    const readable = new Set();
    await Promise.all(
      hosts.map(async (host) => {
        if ((await glabLogin(glab, host)) === "signed-out") notes.push(glabLoginNote(host));
        else readable.add(host);
      }),
    );
    return projects.filter((project) => !needsGlabLogin(project.host) || readable.has(project.host));
  }

  /**
   * The signed-in username on a GitLab host, kept per glab command and host until `clear()`.
   * A failed read adds a note under `glab (<host>)`, gives null and is not kept.
   * @param {string} glab
   * @param {string} host
   * @param {string[]} notes
   * @returns {Promise<?string>}
   */
  async function glUsername(glab, host, notes) {
    const key = `${glab} ${host}`;
    if (glUsers.has(key)) return glUsers.get(key);
    const value = await attempt(`glab (${host})`, glab, glabArgs(host, GL_USERNAME_QUERY), parseGlUsername, notes);
    if (value !== null) glUsers.set(key, value);
    return value;
  }

  /**
   * Finds out what `folder` is (a repository entry, or null) and keeps it with the time of the
   * probe. A probe that runs already is shared. A probe that cannot run changes nothing and
   * marks the folder for the back-off of `probeNew`.
   * @param {string} folder
   * @returns {Promise<void>}
   */
  function probe(folder) {
    const running = probes.get(folder);
    if (running) return running;
    const task = probeOnce(folder).finally(() => probes.delete(folder));
    probes.set(folder, task);
    return task;
  }

  async function probeOnce(folder) {
    let entry = null;
    try {
      const top = await exec("git", revParseArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
      const parsed = top.code === 0 ? parseRevParse(top.stdout) : null;
      if (parsed) {
        const origin = await exec("git", remoteArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
        const remote = origin.code === 0 ? origin.stdout.trim() : "";
        entry = { folder, top: parsed.top, main: parsed.main, remote: remote === "" ? null : remote };
      }
    } catch {
      // A probe that timed out or could not start is tried again later.
      probeFailed.set(folder, now());
      return;
    }
    probeFailed.delete(folder);
    repoCache.set(folder, { entry, at: now() });
  }

  /**
   * The kept probe of `folder`: its entry, null for a folder that is no repository, or
   * undefined before a probe gave an answer.
   * @param {string} folder
   * @returns {Entry|null|undefined}
   */
  function entryOf(folder) {
    return repoCache.get(folder)?.entry;
  }

  /**
   * The projects of `folders` for a scheduled read. A folder is probed again when `needsProbe`
   * says so: a new folder, a folder that is no repository or has no remote, or a probe older
   * than its time to live.
   * @param {string[]} folders
   * @returns {Promise<import("./remote.js").Project[]>}
   */
  async function readProjects(folders) {
    const at = now();
    await mapPool(folders.filter((folder) => needsProbe(repoCache.get(folder), at)), CLI_CONCURRENCY, probe);
    return mergeProjects(folders.map(entryOf).filter((entry) => entry));
  }

  /**
   * Probes the folders that have no answer yet, for the folder watch. A folder whose last
   * probe could not run waits `retryMs` before the watch probes it again.
   * @param {string[]} folders
   * @param {number} retryMs
   * @returns {Promise<Array<Entry|null|undefined>>} The entry of each folder, as `entryOf` gives it.
   */
  async function probeNew(folders, retryMs) {
    const waiting = (folder) => now() - (probeFailed.get(folder) ?? -Infinity) < retryMs;
    await mapPool(folders.filter((folder) => !repoCache.has(folder) && !waiting(folder)), CLI_CONCURRENCY, probe);
    return folders.map(entryOf);
  }

  /** Forgets every command, login, username and probe, so the next read looks again. */
  function clear() {
    located = { gh: null, glab: null };
    glabHosts.clear();
    glUsers.clear();
    repoCache.clear();
    probeFailed.clear();
  }

  return { locate, attempt, glabLogin, signedInGitLab, glUsername, probe, entryOf, readProjects, probeNew, clear };
}
