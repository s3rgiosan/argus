// Builds the `gh` and `glab` argument lists and the GitLab GraphQL query text for issues.

import { LIST_LIMIT } from "./forge-cli.js";

/** @typedef {"assigned"|"created"|"mentions"} Kind */

export const GH_SEARCH_FIELDS = "number,title,url,author,assignees,labels,commentsCount,createdAt,updatedAt,repository,state,isPullRequest";
export const GH_LIST_FIELDS = "number,title,url,author,assignees,labels,createdAt,updatedAt,state";
export const GH_VIEW_FIELDS = "number,title,url,state,stateReason,author,assignees,labels,milestone,body,comments,createdAt,updatedAt,closedAt";

// The search filter of each kind. `@me` names the signed-in user.
const GH_FILTERS = { assigned: "--assignee=@me", created: "--author=@me", mentions: "--mentions=@me" };

/**
 * The open issues that are assigned to you, that you opened, or that mention you, in every repo.
 * @param {Kind} kind
 * @returns {string[]}
 */
export function ghSearchArgs(kind) {
  if (!Object.hasOwn(GH_FILTERS, kind)) throw new Error(`unknown search kind: ${kind}`);
  return ["search", "issues", GH_FILTERS[kind], "--state=open", "--archived=false", "--sort", "updated", "--limit", String(LIST_LIMIT), "--json", GH_SEARCH_FIELDS];
}

/**
 * The open issues of one repo.
 * @param {string} repo
 * @returns {string[]}
 */
export function ghListArgs(repo) {
  return ["issue", "list", "--repo", repo, "--state", "open", "--limit", String(LIST_LIMIT), "--json", GH_LIST_FIELDS];
}

/**
 * One issue with its body and comments.
 * @param {string} repo
 * @param {number} number
 * @returns {string[]}
 */
export function ghViewArgs(repo, number) {
  return ["issue", "view", String(number), "--repo", repo, "--json", GH_VIEW_FIELDS];
}

/** The fields of a GitLab issue on the board. */
export const GL_ISSUE_FIELDS =
  "iid title webUrl state reference(full: true) confidential createdAt updatedAt userNotesCount author { username name } assignees(first: 20) { nodes { username name } } labels(first: 20) { nodes { title } } milestone { title }";

/**
 * The open issues that one user has and the ones that user opened, on one GitLab host. Variable: `user`.
 * GitLab has no mention filter for issues, so this query has no mentions list.
 */
export const GL_USER_QUERY = `query($user: String!) { assigned: issues(assigneeUsernames: [$user], state: opened, sort: UPDATED_DESC, types: [ISSUE], first: ${LIST_LIMIT}) { nodes { ${GL_ISSUE_FIELDS} } } created: issues(authorUsername: $user, state: opened, sort: UPDATED_DESC, types: [ISSUE], first: ${LIST_LIMIT}) { nodes { ${GL_ISSUE_FIELDS} } } }`;

/** The open issues of one project. Variable: `path`. */
export const GL_PROJECT_QUERY = `query($path: ID!) { project(fullPath: $path) { issues(state: opened, sort: UPDATED_DESC, types: [ISSUE], first: ${LIST_LIMIT}) { nodes { ${GL_ISSUE_FIELDS} } } } }`;

/**
 * One issue with its description and notes. Variables: `path`, `iid`. GitLab can return fewer
 * discussions than asked for, so `hasNextPage` tells when the list was cut.
 */
export const GL_DETAIL_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { issue(iid: $iid) { ${GL_ISSUE_FIELDS} description closedAt discussions(first: 100) { pageInfo { hasNextPage } nodes { notes(first: 100) { pageInfo { hasNextPage } nodes { author { username name } body createdAt system internal } } } } } } }`;
