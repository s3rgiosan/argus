// Turns forge CLI output into the issue model. Every provider gives the same Issue and Detail shapes.

import { isObject, parseJson, unexpected, glReply, glNodes, webUrl } from "./forge-cli.js";

/** @typedef {import("./remote.js").Provider} Provider */
/** @typedef {{login: string, name: string}} Person */
/**
 * @typedef {{provider: Provider, host: string, repo: string, number: number, title: string, url: string|null, author: string, authorName: string, assignees: Person[], labels: string[], state: "open"|"closed", stateReason: string|null, confidential: boolean, comments: number|null, milestone: string|null, createdAt: string, updatedAt: string}} Issue
 *   `comments` is the comment count when the list gives one, else null.
 * @typedef {{author: string, name: string, body: string, at: string, hidden: string|null, internal: boolean}} Comment
 *   `hidden` is set when the forge hid the comment (GitHub's minimized comments): the reason, or "" when it gives none.
 * @typedef {{issue: Issue, body: string, closedAt: string|null, comments: Comment[], commentsNote: string|null}} Detail
 */

const GH_HOST = "github.com";

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * The key of an issue, the same for every copy and read.
 * @param {{host: string, repo: string, number: number}} issue
 * @returns {string}
 */
export function issueKey(issue) {
  return `${issue.host}/${issue.repo}#${issue.number}`.toLowerCase();
}

/** A positive whole number from a number or a string of digits, else null. */
function issueNumber(value) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(number) && number > 0 ? /** @type {number} */ (number) : null;
}

/** True for a repo path with at least an owner and a name. */
function isRepo(value) {
  return typeof value === "string" && value.split("/").filter((part) => part !== "").length >= 2;
}

/** The people of a list, each with a login; a person without one is left out. */
function people(list, loginKey) {
  if (!Array.isArray(list)) return [];
  const found = [];
  for (const person of list) {
    const login = isObject(person) ? text(person[loginKey]) : "";
    if (login === "") continue;
    found.push({ login, name: text(person.name).trim() });
  }
  return found;
}

/** The label names of a list. */
function labelNames(list, nameKey) {
  if (!Array.isArray(list)) return [];
  return list.map((label) => (isObject(label) ? text(label[nameKey]) : "")).filter((name) => name !== "");
}

/** "closed" for a closed issue, else "open". GitLab's locked issue is still open. */
function stateOf(value) {
  const word = text(value).toLowerCase();
  return word === "closed" ? "closed" : "open";
}

// GitHub

/**
 * One GitHub issue, or null when its number or repo is not usable.
 * @param {unknown} raw
 * @param {string} repo
 * @returns {Issue|null}
 */
function ghIssue(raw, repo) {
  if (!isObject(raw)) return null;
  const number = issueNumber(raw.number);
  if (number === null || !isRepo(repo)) return null;
  const author = isObject(raw.author) ? raw.author : {};
  const reason = text(raw.stateReason).toLowerCase();
  return {
    provider: "github",
    host: GH_HOST,
    repo,
    number,
    title: text(raw.title),
    url: webUrl(raw.url),
    author: text(author.login),
    authorName: text(author.name).trim(),
    assignees: people(raw.assignees, "login"),
    labels: labelNames(raw.labels, "name"),
    state: stateOf(raw.state),
    stateReason: reason === "" ? null : reason,
    confidential: false,
    comments: Number.isInteger(raw.commentsCount) ? raw.commentsCount : null,
    milestone: isObject(raw.milestone) && text(raw.milestone.title) !== "" ? raw.milestone.title : null,
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
  };
}

/**
 * `gh search issues` output. Pull requests and items without a repo are left out.
 * @param {string} raw
 * @returns {Issue[]}
 */
export function parseGhSearch(raw) {
  const list = parseJson(raw, "gh");
  if (!Array.isArray(list)) throw unexpected("gh");
  const found = [];
  for (const item of list) {
    if (!isObject(item) || item.isPullRequest === true) continue;
    const repo = isObject(item.repository) ? text(item.repository.nameWithOwner) : "";
    const issue = ghIssue(item, repo);
    if (issue !== null) found.push(issue);
  }
  return found;
}

/**
 * `gh issue list` output for `repo`.
 * @param {string} raw
 * @param {string} repo
 * @returns {Issue[]}
 */
export function parseGhList(raw, repo) {
  const list = parseJson(raw, "gh");
  if (!Array.isArray(list)) throw unexpected("gh");
  return list.map((item) => ghIssue(item, repo)).filter((issue) => issue !== null);
}

/**
 * `gh issue view` output for `repo`: the issue, its body and its comments, oldest first.
 * @param {string} raw
 * @param {string} repo
 * @returns {Detail}
 */
export function parseGhView(raw, repo) {
  const value = parseJson(raw, "gh");
  const issue = ghIssue(value, repo);
  if (issue === null) throw unexpected("gh");
  const comments = [];
  for (const comment of Array.isArray(value.comments) ? value.comments : []) {
    if (!isObject(comment)) continue;
    const hidden = comment.isMinimized === true ? text(comment.minimizedReason).toLowerCase().replace(/[_-]+/g, " ").trim() : null;
    const body = text(comment.body);
    if (body.trim() === "" && hidden === null) continue;
    comments.push({ author: isObject(comment.author) ? text(comment.author.login) : "", name: "", body: hidden === null ? body : "", at: text(comment.createdAt), hidden, internal: false });
  }
  comments.sort(byTime);
  return { issue, body: text(value.body), closedAt: text(value.closedAt) || null, comments, commentsNote: null };
}

// GitLab

/**
 * The project path of a full GitLab reference such as `group/project#12`, or null.
 * @param {unknown} reference
 * @returns {string|null}
 */
export function glRepoOf(reference) {
  const value = text(reference);
  const at = value.lastIndexOf("#");
  if (at <= 0) return null;
  const repo = value.slice(0, at);
  return isRepo(repo) ? repo : null;
}

/**
 * One GitLab issue, or null when its iid or project is not usable. `repo` is the project when the
 * query names it; otherwise the full reference gives it.
 * @param {unknown} node
 * @param {string} host
 * @param {string|null} repo
 * @returns {Issue|null}
 */
function glIssue(node, host, repo) {
  if (!isObject(node)) return null;
  const number = issueNumber(node.iid);
  const path = repo ?? glRepoOf(node.reference);
  if (number === null || path === null || !isRepo(path)) return null;
  const author = isObject(node.author) ? node.author : {};
  return {
    provider: "gitlab",
    host,
    repo: path,
    number,
    title: text(node.title),
    url: webUrl(node.webUrl),
    author: text(author.username),
    authorName: text(author.name).trim(),
    assignees: people(isObject(node.assignees) ? node.assignees.nodes : null, "username"),
    labels: labelNames(isObject(node.labels) ? node.labels.nodes : null, "title"),
    state: stateOf(node.state),
    stateReason: null,
    confidential: node.confidential === true,
    comments: Number.isInteger(node.userNotesCount) ? node.userNotesCount : null,
    milestone: isObject(node.milestone) && text(node.milestone.title) !== "" ? node.milestone.title : null,
    createdAt: text(node.createdAt),
    updatedAt: text(node.updatedAt),
  };
}

function glIssues(connection, host, repo) {
  return glNodes(connection)
    .map((node) => glIssue(node, host, repo))
    .filter((issue) => issue !== null);
}

/**
 * `GL_USER_QUERY` output: the issues one user has and the ones that user opened.
 * @param {string} raw
 * @param {string} host
 * @returns {{assigned: Issue[], created: Issue[]}}
 */
export function parseGlUser(raw, host) {
  const data = glReply(raw);
  return { assigned: glIssues(data.assigned, host, null), created: glIssues(data.created, host, null) };
}

/**
 * `GL_PROJECT_QUERY` output for the project `repo`.
 * @param {string} raw
 * @param {string} host
 * @param {string} repo
 * @returns {Issue[]}
 */
export function parseGlProject(raw, host, repo) {
  const data = glReply(raw);
  if (data.project === null) throw new Error("project not found");
  return glIssues(data.project?.issues, host, repo);
}

/**
 * `GL_DETAIL_QUERY` output for the project `repo`: the issue, its description and its notes,
 * oldest first, without system notes. `commentsNote` says when GitLab has more discussions or notes.
 * @param {string} raw
 * @param {string} host
 * @param {string} repo
 * @returns {Detail}
 */
export function parseGlDetail(raw, host, repo) {
  const data = glReply(raw);
  if (data.project === null) throw new Error("project not found");
  const node = data.project?.issue;
  if (node === null) throw new Error("issue not found");
  const issue = glIssue(node, host, repo);
  if (issue === null) throw unexpected("glab");
  const discussions = isObject(node.discussions) && Array.isArray(node.discussions.nodes) ? node.discussions.nodes : [];
  const comments = [];
  let more = hasNextPage(node.discussions);
  for (const discussion of discussions) {
    const notes = isObject(discussion) && isObject(discussion.notes) && Array.isArray(discussion.notes.nodes) ? discussion.notes.nodes : [];
    if (isObject(discussion) && hasNextPage(discussion.notes)) more = true;
    for (const note of notes) {
      if (!isObject(note) || note.system === true || text(note.body).trim() === "") continue;
      const author = isObject(note.author) ? note.author : {};
      comments.push({ author: text(author.username), name: text(author.name).trim(), body: text(note.body), at: text(note.createdAt), hidden: null, internal: note.internal === true });
    }
  }
  comments.sort(byTime);
  const commentsNote = more ? "GitLab has more comments than the pane shows. Open in browser shows them all." : null;
  return { issue, body: text(node.description), closedAt: text(node.closedAt) || null, comments, commentsNote };
}

/** True when a GraphQL connection says another page follows. */
function hasNextPage(connection) {
  return isObject(connection) && isObject(connection.pageInfo) && connection.pageInfo.hasNextPage === true;
}

function byTime(a, b) {
  if (a.at < b.at) return -1;
  return a.at > b.at ? 1 : 0;
}
