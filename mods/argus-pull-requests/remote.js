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
  if (repo.split("/").filter((part) => part !== "").length < 2) return null;
  return { provider: host === "github.com" ? "github" : "gitlab", host, repo };
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
