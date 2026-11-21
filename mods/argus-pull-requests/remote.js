// Copied from lib/remote.js by scripts/sync-lib.mjs: edit lib/remote.js, then run it.
//
// Parses git remotes and turns the open spaces' folders into a project list.

import { compareNames, followedProject } from "./follow.js";

/** @typedef {"github"|"gitlab"} Provider */
/** @typedef {{key: string, provider: Provider, host: string, repo: string, localPath: string, folders: string[]}} Project */

/**
 * Reads a git remote URL (scp-style, ssh://, http(s)://, git://).
 * @param {string} url
 * @returns {?{provider: Provider, host: string, repo: string}}
 */
export function parseRemote(url) {
  if (typeof url !== "string") return null;
  const text = url.trim();
  let host;
  let path;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (scheme) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return null;
    }
    const protocol = scheme[1].toLowerCase();
    if (!["ssh", "git", "http", "https"].includes(protocol)) return null;
    host = protocol === "http" || protocol === "https" ? parsed.host : parsed.hostname;
    path = parsed.pathname;
  } else {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(text);
    if (!scp) return null;
    host = scp[1];
    path = scp[2];
  }
  host = host.toLowerCase();
  if (host === "ssh.github.com") host = "github.com";
  if (host === "") return null;
  const repo = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const parts = repo.split("/").filter((part) => part !== "");
  const github = host === "github.com";
  // A GitHub repo is owner/name. A GitLab project can be in subgroups.
  if (github ? parts.length !== 2 : parts.length < 2) return null;
  // A value that starts with "-" could be read as an option by gh, glab or git.
  if (host.startsWith("-") || parts.some((part) => part.startsWith("-"))) return null;
  if (isOtherForge(host)) return null;
  return { provider: github ? "github" : "gitlab", host, repo };
}

const OTHER_FORGES = ["bitbucket.org", "dev.azure.com", "ssh.dev.azure.com", "codeberg.org", "gitea.com", "git.sr.ht"];

/** True for a public host of a forge that is neither GitHub nor GitLab. */
function isOtherForge(host) {
  const name = host.replace(/:\d+$/, "");
  return OTHER_FORGES.includes(name) || name.endsWith(".visualstudio.com");
}

/** How long a probe that found a repository with a remote stays in the cache. */
export const PROBE_TTL_MS = 10 * 60 * 1000;

/**
 * True when a scheduled read must probe a folder again. A folder that was not probed, that is
 * not a repository or that has no remote is probed on each read. A repository with a remote is
 * probed again after PROBE_TTL_MS, so a changed remote shows.
 * @param {{entry: ?{remote: ?string}, at: number}|undefined} cached
 * @param {number} now
 * @returns {boolean}
 */
export function needsProbe(cached, now) {
  if (cached === undefined || cached === null) return true;
  if (cached.entry === null || cached.entry.remote === null) return true;
  return now - cached.at >= PROBE_TTL_MS;
}

/**
 * True when a GitLab project's host needs a glab login check before glab reads it. Every host
 * that is not GitHub or a known other forge counts as GitLab, so a host other than gitlab.com
 * counts only when glab is signed in to it.
 * @param {string} host
 * @returns {boolean}
 */
export function needsGlabLogin(host) {
  return host !== "gitlab.com";
}

/**
 * @param {{host: string, repo: string}} project
 * @returns {string}
 */
export function projectKey({ host, repo }) {
  return `${host}/${repo}`.toLowerCase();
}

/**
 * Folders of the local spaces and the terminals in them, each once, sorted.
 * Spaces on another machine are skipped: their folders are not on this computer.
 * @param {Array<{machine?: ?string, folder?: ?string, tabs?: Array<{id: string}>}>} spaces
 * @param {Array<{tab: string, terminal?: ?string, cwd?: ?string}>} panes
 * @returns {string[]}
 */
export function localFolders(spaces, panes) {
  const found = new Set();
  const add = (value) => {
    if (typeof value === "string" && value !== "") found.add(value);
  };
  for (const space of spaces) {
    if (typeof space.machine === "string" && space.machine !== "") continue;
    add(space.folder);
    const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
    for (const pane of panes) {
      if (typeof pane.terminal === "string" && tabs.has(pane.tab)) add(pane.cwd);
    }
  }
  return [...found].sort(compareNames);
}

/** @returns {string[]} */
export function revParseArgs() {
  return ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"];
}

/** @returns {string[]} */
export function remoteArgs() {
  return ["remote", "get-url", "origin"];
}

/**
 * Reads the output of `revParseArgs()`: the checkout folder and the main checkout.
 * @param {string} stdout
 * @returns {?{top: string, main: string}}
 */
export function parseRevParse(stdout) {
  const lines = String(stdout ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length < 2) return null;
  const common = lines[1].replace(/\/+$/, "");
  const main = common.endsWith("/.git") ? common.slice(0, -"/.git".length) : common;
  if (main === "") return null;
  return { top: lines[0], main };
}

/**
 * Groups checkouts by forge repository, sorted by repository name.
 * @param {Array<{folder: string, top: string, main: string, remote: ?string}>} entries
 * @returns {Project[]}
 */
export function mergeProjects(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const parsed = entry.remote ? parseRemote(entry.remote) : null;
    if (!parsed) continue;
    const key = projectKey(parsed);
    let project = byKey.get(key);
    if (!project) {
      project = { key, provider: parsed.provider, host: parsed.host, repo: parsed.repo, localPath: entry.main, folders: [] };
      byKey.set(key, project);
    }
    for (const folder of [entry.folder, entry.top]) {
      if (!project.folders.includes(folder)) project.folders.push(folder);
    }
  }
  const projects = [...byKey.values()];
  for (const project of projects) project.folders.sort(compareNames);
  return projects.sort((a, b) => compareNames(a.repo, b.repo) || compareNames(a.key, b.key));
}

/**
 * The keys that no project in `projects` has.
 * @param {string[]} keys
 * @param {Array<{key: string}>} projects
 * @returns {string[]}
 */
export function missingProjectKeys(keys, projects) {
  const known = new Set(projects.map((project) => project.key));
  return keys.filter((key) => !known.has(key));
}

/**
 * The project keys of the probed checkouts that `projects` does not have yet.
 * @param {Array<?{folder: string, top: string, main: string, remote: ?string}>} entries
 * @param {Array<{key: string}>} projects
 * @returns {string[]}
 */
export function newProjectKeys(entries, projects) {
  const keys = mergeProjects(entries.filter((entry) => entry)).map((project) => project.key);
  return missingProjectKeys(keys, projects);
}

/**
 * The key of the project that holds `folder`, matched on whole folder names.
 * @param {Project[]} projects
 * @param {?string} folder
 * @returns {?string}
 */
export function followProjectKey(projects, folder) {
  const owners = new Map();
  for (const project of projects) {
    for (const own of project.folders) if (!owners.has(own)) owners.set(own, project.key);
  }
  const match = followedProject([...owners.keys()], folder);
  return match === null ? null : owners.get(match) ?? null;
}

/**
 * The main checkout folder of a repository, or null when it is not open.
 * @param {Project[]} projects
 * @param {string} host
 * @param {string} repo
 * @returns {?string}
 */
export function localPathFor(projects, host, repo) {
  const key = projectKey({ host, repo });
  return projects.find((project) => project.key === key)?.localPath ?? null;
}
