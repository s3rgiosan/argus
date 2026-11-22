// Builds `gh` and `glab` argument lists and the GitLab GraphQL query text.

import { LIST_LIMIT } from "./forge-cli.js";

/** @typedef {import("./remote.js").Provider} Provider */

export const GH_LIST_FIELDS =
  "number,title,url,author,headRefName,baseRefName,isDraft,state,reviewDecision,latestReviews,statusCheckRollup,mergeable,mergeStateStatus,updatedAt";
export const GH_VIEW_FIELDS = `${GH_LIST_FIELDS},body,headRefOid,reviewRequests,reviews,comments`;

export const GL_MR_FIELDS =
  "iid title webUrl draft state sourceBranch targetBranch updatedAt author { username } approvedBy { nodes { username } } conflicts detailedMergeStatus headPipeline { status } targetProject { fullPath }";

export const GL_USER_QUERY = `query { currentUser { reviewRequestedMergeRequests(state: opened, first: ${LIST_LIMIT}) { nodes { ${GL_MR_FIELDS} } } authoredMergeRequests(state: opened, first: ${LIST_LIMIT}) { nodes { ${GL_MR_FIELDS} } } } }`;

export const GL_PROJECT_QUERY = `query($path: ID!) { project(fullPath: $path) { mergeRequests(state: opened, first: ${LIST_LIMIT}) { nodes { ${GL_MR_FIELDS} } } } }`;

export const GL_DETAIL_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { ${GL_MR_FIELDS} description diffHeadSha squashOnMerge headPipeline { status path jobs(first: 100) { nodes { name status webPath } } } reviewers { nodes { username name mergeRequestInteraction { reviewState } } } discussions(first: 100) { nodes { resolved resolvable notes { nodes { author { username name } body createdAt system position { filePath newLine oldLine } } } } } targetProject { fullPath squashReadOnly } } } }`;

/** @returns {string[]} */
export function ghLoginArgs() {
  return ["api", "user", "--jq", ".login"];
}

/**
 * @param {"needsReview"|"mine"} kind
 * @param {string} [login] required for "mine"
 * @returns {string[]}
 */
export function ghSearchArgs(kind, login) {
  let filter;
  switch (kind) {
    case "needsReview":
      filter = "--review-requested=@me";
      break;
    case "mine":
      if (!login) throw new Error("login required for mine");
      filter = `--author=${login}`;
      break;
    default:
      throw new Error(`unknown search kind: ${kind}`);
  }
  return ["search", "prs", filter, "--state=open", "--archived=false", "--limit", String(LIST_LIMIT), "--json", "number,url"];
}

/** @param {string} repo */
export function ghListArgs(repo) {
  return ["pr", "list", "--repo", repo, "--state", "open", "--limit", String(LIST_LIMIT), "--json", GH_LIST_FIELDS];
}

/**
 * @param {string} repo
 * @param {number} number
 */
export function ghViewArgs(repo, number) {
  return ["pr", "view", String(number), "--repo", repo, "--json", GH_VIEW_FIELDS];
}

/** The review threads of one pull request (file, line, resolved, comments with their review) and the display names of its participants. */
export const GH_THREADS_QUERY =
  "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { participants(first: 100) { nodes { login name } } reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login name } } } } reviewThreads(first: 100) { nodes { isResolved path line originalLine comments(first: 50) { nodes { author { login } body createdAt pullRequestReview { id } } } } } } } }";

/**
 * The `gh api graphql` arguments for the review threads of pull request `number` in `repo` (`owner/name`).
 * @param {string} repo
 * @param {number} number
 * @returns {string[]}
 */
export function ghThreadsArgs(repo, number) {
  const [owner, name] = repo.split("/");
  return ["api", "graphql", "-f", `query=${GH_THREADS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
}

/**
 * @param {Provider} provider
 * @param {number} number
 * @returns {string}
 */
export function fetchRef(provider, number) {
  return provider === "gitlab" ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
}

/**
 * The merged pull requests whose head branch is `branch`, for the Merged worktrees view.
 * @param {string} repo
 * @param {string} branch
 * @returns {string[]}
 */
export function ghMergedArgs(repo, branch) {
  return ["pr", "list", "--repo", repo, "--head", branch, "--state", "merged", "--limit", "10", "--json", "number,headRefOid,mergedAt,baseRefName,isCrossRepository"];
}

/**
 * The state and head commit of one pull request, for a review worktree.
 * @param {string} repo
 * @param {number} number
 * @returns {string[]}
 */
export function ghPrStateArgs(repo, number) {
  return ["pr", "view", String(number), "--repo", repo, "--json", "number,state,headRefOid,mergedAt,baseRefName"];
}

/** The merged merge requests of one source branch. Variables: `path`, `branch`. */
export const GL_MERGED_QUERY = `query($path: ID!, $branch: String!) { project(fullPath: $path) { mergeRequests(sourceBranches: [$branch], state: merged, first: 10) { nodes { iid diffHeadSha mergedAt targetBranch sourceProjectId targetProjectId } } } }`;

/** The state and head commit of one merge request. Variables: `path`, `iid`. */
export const GL_MR_STATE_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { iid state diffHeadSha mergedAt targetBranch } } }`;

/** How many issues the New worktree view asks for. */
export const ISSUE_LIMIT = 50;

/**
 * The open issues assigned to the signed-in GitHub user.
 * @param {string} repo
 * @returns {string[]}
 */
export function ghIssuesArgs(repo) {
  return ["issue", "list", "--repo", repo, "--assignee", "@me", "--state", "open", "--limit", String(ISSUE_LIMIT), "--json", "number,title,updatedAt"];
}

/** The open issues of a GitLab project that one user has. Variables: `path`, `user`. */
export const GL_ISSUES_QUERY = `query($path: ID!, $user: String!) { project(fullPath: $path) { issues(state: opened, assigneeUsernames: [$user], first: ${ISSUE_LIMIT}) { nodes { iid title updatedAt } } } }`;

/**
 * The repo's 100 newest merged pull requests, newest created first as `gh pr list` orders them, for the board's merged worktree count.
 * @param {string} repo
 * @returns {string[]}
 */
export function ghMergedListArgs(repo) {
  return ["pr", "list", "--repo", repo, "--state", "merged", "--limit", "100", "--json", "number,headRefName,headRefOid,mergedAt,baseRefName,isCrossRepository"];
}

/** The project's last 100 merge requests, newest merge first. Variable: `path`. */
export const GL_MERGED_LIST_QUERY = `query($path: ID!) { project(fullPath: $path) { mergeRequests(state: merged, first: 100, sort: MERGED_AT_DESC) { nodes { iid sourceBranch diffHeadSha mergedAt targetBranch sourceProjectId targetProjectId } } } }`;
