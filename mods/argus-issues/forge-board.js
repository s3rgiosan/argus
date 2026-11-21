// Copied from lib/forge-board.js by scripts/sync-lib.mjs: edit lib/forge-board.js, then run it.
//
// Pure helpers for a board of forge items (pull requests, issues) read from
// the open spaces' repos: the board settings, scopes (Show and In), Follow
// space, notes, kept lists, groups, the pane's order and names, and when a
// pane reads its item again. A board here is an object with `projects`, `folders`,
// `notes`, `readAt`, `scopes.projects` and a list of items. No Herdr imports,
// so Node can test it.

import { compareNames } from "./follow.js";
import { projectKey } from "./remote.js";
import { isObject } from "./forge-cli.js";

/**
 * @typedef {import("./remote.js").Project} Project
 * @typedef {{show: string, where: "all" | "follow"} | {show: string, where: "project", key: string}} Scope
 * @typedef {{key: string, label: string, scope: Scope, count: number, current: boolean}} Item
 * @typedef {Array<[string, string]>} Shows The Show choices, as [id, label]; the first is the default.
 */

/** Refresh interval choices, in minutes. */
export const INTERVALS = [1, 3, 5, 10, 15];

/** Refresh interval used when the setting is unset or invalid, in minutes. */
export const DEFAULT_INTERVAL = 3;

/** The orders a pane can show a conversation in. */
export const CONVERSATION_ORDERS = ["oldest", "newest"];

/** How long a repo whose list fails keeps its items from the last successful list, in ms. */
export const KEEP_LIST_MS = 15 * 60 * 1000;

/**
 * A forge board's own settings: the refresh interval, and the order of the pane's conversation
 * ("oldest" first by default, or "newest" first). The gh and glab commands are the shared
 * forge settings (`readForge`).
 * @param {unknown} value
 * @returns {{interval: number, conversation: string}}
 */
export function normalizeSettings(value) {
  const v = isObject(value) ? value : {};
  const interval = INTERVALS.includes(v.interval) ? v.interval : DEFAULT_INTERVAL;
  const conversation = CONVERSATION_ORDERS.includes(v.conversation) ? v.conversation : "oldest";
  return { interval, conversation };
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * A short age: "now", then minutes, hours, days, months and years ("5m", "3d").
 * @param {string} iso
 * @param {number} now Milliseconds since the epoch.
 * @returns {string} "" for a time that does not parse.
 */
export function ageText(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  const days = Math.floor(seconds / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// Board

/**
 * What Follow space shows for the focused folder: its project ("followed"), a wait while the
 * board has not read that folder yet ("pending"), or that the folder is no GitHub or GitLab
 * repo ("none"). A new space's folder is unknown until a read or the folder watch lists it.
 * @param {{readAt: number, folders: string[]}} board
 * @param {string|null} folder The focused space's folder (`followFolder`).
 * @param {string|null} followed The project key of that folder (`followProjectKey`).
 * @returns {"followed"|"pending"|"none"}
 */
export function followStatus(board, folder, followed) {
  if (followed !== null) return "followed";
  if (folder === null) return "none";
  if (board.readAt === 0 || !board.folders.includes(folder)) return "pending";
  return "none";
}

/**
 * The board with `folders` added to the folders it lists, or the board itself when it lists them all.
 * The folder watch uses it for folders that are no repo, so Follow space can say so without a read.
 * @template {{folders: string[]}} B
 * @param {B} board
 * @param {string[]} folders
 * @returns {B}
 */
export function withFolders(board, folders) {
  const missing = folders.filter((folder) => !board.folders.includes(folder));
  return missing.length === 0 ? board : { ...board, folders: [...board.folders, ...missing] };
}

/**
 * The board with one more note, or the board itself when it has the note already.
 * @template {{notes: string[]}} B
 * @param {B} board
 * @param {string} text
 * @returns {B}
 */
export function withNote(board, text) {
  return board.notes.includes(text) ? board : { ...board, notes: [...board.notes, text] };
}

/**
 * The items of `list` named by `keys`, in the order of `keys`; a key without an item is left out.
 * @template T
 * @param {T[]} list
 * @param {string[]} keys
 * @param {(item: T) => string} keyOf
 * @returns {T[]}
 */
export function itemsByKeys(list, keys, keyOf) {
  const byKey = new Map(list.map((item) => [keyOf(item), item]));
  return keys.map((key) => byKey.get(key)).filter((item) => item !== undefined);
}

/**
 * The items of the previous board for the repos whose list failed in this read, so one failed
 * read does not hide them. A repo keeps them for `keepMs` after its last successful list
 * (`listedAt`), so a repo whose list always fails does not keep them forever.
 * `items` holds every kept item of those repos, `projectItems` the project lists of the failed
 * repos that are projects, and `listedAt` the time of the last successful list of each kept repo.
 * @template T
 * @param {{scopes: {projects: Record<string, string[]>}, listedAt?: Record<string, number>}} previous
 * @param {string[]} failedKeys Repo keys (`projectKey`) whose list failed.
 * @param {number} now
 * @param {{items: T[], keyOf: (item: T) => string, keepMs: number}} options `items` is the previous board's item list.
 * @returns {{items: T[], projectItems: Record<string, T[]>, listedAt: Record<string, number>}}
 */
export function keptLists(previous, failedKeys, now, { items, keyOf, keepMs }) {
  const seen = previous.listedAt ?? {};
  const kept = [];
  const projectItems = {};
  const listedAt = {};
  for (const key of new Set(failedKeys)) {
    if (!Object.hasOwn(seen, key) || now - seen[key] >= keepMs) continue;
    listedAt[key] = seen[key];
    kept.push(...items.filter((item) => projectKey(item) === key));
    if (Object.hasOwn(previous.scopes.projects, key)) projectItems[key] = itemsByKeys(items, previous.scopes.projects[key], keyOf);
  }
  return { items: kept, projectItems, listedAt };
}

// Scopes

/**
 * The scope: which items to show (Show) and from which repos (In).
 * @param {unknown} value
 * @param {Shows} shows
 * @returns {Scope}
 */
export function normalizeScope(value, shows) {
  const fallback = shows[0][0];
  if (!isObject(value)) return { show: fallback, where: "all" };
  const show = shows.some(([id]) => id === value.show) ? value.show : fallback;
  switch (value.where) {
    case "follow":
      return { show, where: "follow" };
    case "project":
      return typeof value.key === "string" && value.key !== "" ? { show, where: "project", key: value.key } : { show, where: "all" };
    default:
      return { show, where: "all" };
  }
}

/**
 * The project key a scope limits to, null for all repos, or undefined when it
 * follows a space that is not a project.
 * @param {Scope} scope
 * @param {?string} followed
 * @returns {string|null|undefined}
 */
export function whereKey(scope, followed) {
  switch (scope.where) {
    case "follow":
      return followed ?? undefined;
    case "project":
      return scope.key;
    default:
      return null;
  }
}

/**
 * The repo part of a project key (`host/owner/name`).
 * @param {string} key
 * @returns {string}
 */
export function keyRepo(key) {
  return key.split("/").slice(1).join("/");
}

/**
 * The rows of the scope list: the Show choices, then In (Follow space, All repos and each
 * project). Each row's count keeps the other choice as it is, and picking it changes only its
 * own choice. A picked project no longer on the board stays in the list, so its row keeps the tick.
 * @param {{projects: Project[]}} board
 * @param {?string} followed
 * @param {Scope} scope The current scope.
 * @param {{shows: Shows, count: (scope: Scope) => number}} options `count` gives how many items a scope shows.
 * @returns {{show: Item[], where: Item[], projects: Item[]}}
 */
export function scopeItems(board, followed, scope, { shows, count }) {
  const item = (key, label, next, current) => ({ key, label, scope: next, count: count(next), current });
  const keep = scope.where === "project" ? { where: "project", key: scope.key } : { where: scope.where };
  const show = shows.map(([id, label]) => item(id, label, /** @type {Scope} */ ({ show: id, ...keep }), scope.show === id));
  const where = [
    item("follow", "Follow space", { show: scope.show, where: "follow" }, scope.where === "follow"),
    item("all", "All repos", { show: scope.show, where: "all" }, scope.where === "all"),
  ];
  const listed = board.projects.map((project) => ({ key: project.key, repo: project.repo }));
  if (scope.where === "project" && !listed.some((project) => project.key === scope.key)) {
    listed.push({ key: scope.key, repo: keyRepo(scope.key) });
  }
  const projects = listed
    .sort((a, b) => compareNames(a.repo, b.repo))
    .map((project) => {
      const next = /** @type {Scope} */ ({ show: scope.show, where: "project", key: project.key });
      return item(project.key, project.repo, next, scope.where === "project" && scope.key === project.key);
    });
  return { show, where, projects };
}

/**
 * The In part of the scope: All repos, the followed or picked repo, or Follow space.
 * @param {Scope} scope
 * @param {{projects: Project[]}} board
 * @param {?string} followed
 * @returns {string}
 */
export function scopeWhereTitle(scope, board, followed) {
  const repoOf = (key) => board.projects.find((p) => p.key === key)?.repo ?? null;
  switch (scope.where) {
    case "follow": {
      const repo = followed === null ? null : repoOf(followed);
      return repo ?? "Follow space";
    }
    case "project":
      return repoOf(scope.key) ?? keyRepo(scope.key);
    default:
      return "All repos";
  }
}

/**
 * The scope button text: the Show choice, then the repo when In is not All repos.
 * @param {Scope} scope
 * @param {{projects: Project[]}} board
 * @param {?string} followed
 * @param {Shows} shows
 * @returns {string}
 */
export function scopeTitle(scope, board, followed, shows) {
  const show = shows.find(([id]) => id === scope.show)?.[1] ?? shows[0][1];
  return scope.where === "all" ? show : `${show} · ${scopeWhereTitle(scope, board, followed)}`;
}

/**
 * The projects a scope shows: all of them, one project, or the followed space's project.
 * @param {{projects: Project[]}} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Project[]}
 */
export function scopeProjects(board, scope, followed) {
  const where = whereKey(scope, followed);
  if (where === undefined) return [];
  return where === null ? board.projects : board.projects.filter((project) => project.key === where);
}

/**
 * The provider and host of each repo that `scope` shows: every project for All repos, the
 * followed or picked project otherwise. Empty when the scope has no known repo.
 * @param {{projects: Project[]}} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @returns {Array<{provider: string, host: string}>}
 */
export function scopeRepos(board, scope, followed) {
  const seen = new Set();
  /** @type {Array<{provider: string, host: string}>} */
  const repos = [];
  for (const { provider, host } of scopeProjects(board, scope, followed)) {
    const id = `${provider} ${host}`;
    if (seen.has(id)) continue;
    seen.add(id);
    repos.push({ provider, host });
  }
  return repos;
}

/**
 * True when a failure note comes from a read for `repo`: `gh` notes for GitHub, `glab (<host>)` notes for GitLab.
 * @param {string} note
 * @param {{provider: string, host: string}} repo
 * @returns {boolean}
 */
export function noteIsFor(note, repo) {
  if (repo.provider === "github") return note.startsWith("gh: ") || note.startsWith("gh not found");
  if (note.startsWith("glab not found")) return true;
  return note.startsWith(`glab (${repo.host}): `);
}

/**
 * The id of a search read on a board's `worked` list: the label of its notes, "gh" for GitHub and
 * `glab (<host>)` for GitLab. With `kind`, a GitHub search has its own id, `gh:<kind>`, because
 * the board runs one GitHub search per Show; a GitLab host has one read for all of them.
 * @param {{provider: string, host: string}} repo
 * @param {string} [kind] The Show the search feeds.
 * @returns {string}
 */
export function searchRead(repo, kind) {
  if (repo.provider !== "github") return `glab (${repo.host})`;
  return kind === undefined ? "gh" : `gh:${kind}`;
}

/**
 * The ids of the reads that give the items of `scope`, as a board's `worked` list names them.
 * Show `all` takes the project lists, so the ids are the keys of the scope's projects. Every other
 * Show is a search: the ids are `searchRead` of the scope's repos. All repos always has "gh",
 * because the GitHub searches run without a project. With `perShow`, each Show has its own
 * GitHub search (`gh:<show>`).
 * @param {{projects: Project[]}} board
 * @param {Scope} scope
 * @param {?string} followed Project key of the followed space.
 * @param {boolean} [perShow]
 * @returns {string[]}
 */
export function scopeReads(board, scope, followed, perShow = false) {
  if (scope.show === "all") return scopeProjects(board, scope, followed).map((project) => project.key);
  const kind = perShow ? scope.show : undefined;
  const reads = scopeRepos(board, scope, followed).map((repo) => searchRead(repo, kind));
  if (whereKey(scope, followed) === null) reads.unshift(searchRead({ provider: "github", host: "github.com" }, kind));
  return [...new Set(reads)];
}

/**
 * The text of an empty list: loading before the first read, `failed` when a read for the scope
 * failed and no read in `reads` worked (the list may be empty because of the failure), else
 * `none`. With no known repo in the scope, any failure counts. A note that a list was cut
 * ("Showing the first …", `limitNote`) reports no failure.
 * @param {{readAt: number, notes: string[], worked?: string[]}} board `worked` holds the ids of the reads that worked.
 * @param {Array<{provider: string, host: string}>} repos The repos the scope shows (`scopeRepos`).
 * @param {{failed: string, none: string}} texts
 * @param {string[]} [reads] The reads that give the scope's items (`scopeReads`).
 * @returns {string}
 */
export function emptyMessage(board, repos, { failed, none }, reads = []) {
  if (board.readAt === 0) return "Loading…";
  const broken = board.notes
    .filter((note) => !note.startsWith("Showing the first "))
    .some((note) => repos.length === 0 || repos.some((repo) => noteIsFor(note, repo)));
  const worked = Array.isArray(board.worked) && reads.some((id) => board.worked.includes(id));
  return broken && !worked ? failed : none;
}

// Groups

/**
 * The groups of `items` by the values `valuesOf` gives each item, for example its assignees or
 * labels. An item with several values shows in the group of each one, and an item with none in
 * the `none` group. Values of the same key share one group, under the first title seen. Groups
 * sort A to Z by title, then by key, with the `none` group last. Items keep their order.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Array<{key: string, title: string}>} valuesOf
 * @param {{key: string, title: string}} none
 * @returns {Array<{key: string, title: string, items: T[]}>}
 */
export function groupItems(items, valuesOf, none) {
  const groups = new Map();
  const empty = { key: none.key, title: none.title, items: [] };
  for (const item of items) {
    const values = valuesOf(item);
    if (values.length === 0) empty.items.push(item);
    for (const { key, title } of values) {
      if (!groups.has(key)) groups.set(key, { key, title, items: [] });
      const group = groups.get(key);
      if (!group.items.includes(item)) group.items.push(item);
    }
  }
  const list = [...groups.values()].sort((a, b) => compareNames(a.title, b.title) || compareNames(a.key, b.key));
  return empty.items.length > 0 ? [...list, empty] : list;
}

// The pane

/**
 * The item keys in the order the board shows them: the lists in order, each list's items in
 * order. An item that shows in several lists counts once, at its first place.
 * @template T
 * @param {T[][]} lists The board's groups, as lists of items.
 * @param {(item: T) => string} keyOf
 * @returns {string[]}
 */
export function shownOrder(lists, keyOf) {
  return [...new Set(lists.flatMap((list) => list.map(keyOf)))];
}

/**
 * Where `key` is in `order` (1-based), with its neighbours, or null when it is not there.
 * @param {string[]} order
 * @param {string} key
 * @returns {{index: number, total: number, prev: string|null, next: string|null}|null}
 */
export function positionIn(order, key) {
  const at = order.indexOf(key);
  if (at < 0) return null;
  return { index: at + 1, total: order.length, prev: order[at - 1] ?? null, next: order[at + 1] ?? null };
}

/**
 * The title the pane header shows for an item pane: the item's number and title, the number
 * alone without a title, else `fallback` (the panel name).
 * @param {{number: number, title: string}|null} item
 * @param {string} fallback
 * @returns {string}
 */
export function paneTitle(item, fallback) {
  if (item === null) return fallback;
  return item.title ? `#${item.number} · ${item.title}` : `#${item.number}`;
}

/** Names for bot accounts, which GitHub gives no display name. Keyed by login without the `app/` prefix. */
export const KNOWN_BOTS = Object.freeze({
  "copilot-pull-request-reviewer": "Copilot",
  dependabot: "Dependabot",
});

/**
 * The name to show for a login: the forge's display name, else a known bot's name, else the
 * login without the `app/` prefix that `gh` adds to apps.
 * @param {string|null|undefined} login
 * @param {Record<string, string>|null|undefined} names
 * @returns {string}
 */
export function displayName(login, names) {
  const text = typeof login === "string" ? login : "";
  const known = names && Object.hasOwn(names, text) ? names[text] : undefined;
  if (typeof known === "string" && known !== "") return known;
  const bare = text.startsWith("app/") ? text.slice("app/".length) : text;
  return Object.hasOwn(KNOWN_BOTS, bare) ? KNOWN_BOTS[bare] : bare;
}

/**
 * The keys made unique: a repeated key gets `~2`, `~3` and so on, in order.
 * @param {string[]} keys
 * @returns {string[]}
 */
export function uniqueKeys(keys) {
  const seen = new Map();
  return keys.map((key) => {
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? key : `${key}~${count}`;
  });
}

/**
 * A text for the parts of a board row that the item's pane shows, or null when there is no row.
 * @template T
 * @param {T|null|undefined} row
 * @param {(row: T) => unknown[]} parts
 * @returns {string|null}
 */
export function rowSignature(row, parts) {
  return row ? parts(row).join("|") : null;
}

/**
 * True when an item's pane reads its item again.
 * - The board has no row for it (`signature` is null), or the pane kept no signature: after each board read.
 * - The row differs from the row at the last pane read: yes.
 * - Otherwise: only when the board has not read for longer than `intervalMs` and the pane
 *   has not read for that long (no board copy is running).
 * @param {{signature: string|null, seen: string|null|undefined, boardReadAt: number, shownReadAt: number, now: number, intervalMs: number}} input
 *   `signature` is `rowSignature` of the board row now; `seen` is the one at the last pane read.
 * @returns {boolean}
 */
export function rereadDue({ signature, seen, boardReadAt, shownReadAt, now, intervalMs }) {
  if (signature === null || typeof seen !== "string") return boardReadAt > shownReadAt;
  if (signature !== seen) return true;
  return now - boardReadAt > intervalMs && now - shownReadAt >= intervalMs;
}
