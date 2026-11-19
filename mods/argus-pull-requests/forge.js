// Builds `gh` and `glab` argument lists and the GitLab GraphQL query text.

/** @typedef {import("./remote.js").Provider} Provider */

export const GH_LIST_FIELDS =
  "number,title,url,author,headRefName,baseRefName,isDraft,state,reviewDecision,statusCheckRollup,mergeable,mergeStateStatus,updatedAt";
export const GH_VIEW_FIELDS = `${GH_LIST_FIELDS},body,latestReviews,reviewRequests,reviews,comments`;

export const GL_MR_FIELDS =
  "iid title webUrl draft state sourceBranch targetBranch updatedAt author { username } approvedBy { nodes { username } } conflicts detailedMergeStatus headPipeline { status } targetProject { fullPath }";

export const GL_USER_QUERY = `query { currentUser { reviewRequestedMergeRequests(state: opened, first: 100) { nodes { ${GL_MR_FIELDS} } } authoredMergeRequests(state: opened, first: 100) { nodes { ${GL_MR_FIELDS} } } } }`;

export const GL_PROJECT_QUERY = `query($path: ID!) { project(fullPath: $path) { mergeRequests(state: opened, first: 100) { nodes { ${GL_MR_FIELDS} } } } }`;

export const GL_DETAIL_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { ${GL_MR_FIELDS} description headPipeline { status jobs(first: 100) { nodes { name status } } } reviewers { nodes { username mergeRequestInteraction { reviewState } } } notes(first: 100) { nodes { author { username } body createdAt system } } } } }`;

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
  return ["search", "prs", filter, "--state=open", "--archived=false", "--limit", "100", "--json", "number,url"];
}

/** @param {string} repo */
export function ghListArgs(repo) {
  return ["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", GH_LIST_FIELDS];
}

/**
 * @param {string} repo
 * @param {number} number
 */
export function ghViewArgs(repo, number) {
  return ["pr", "view", String(number), "--repo", repo, "--json", GH_VIEW_FIELDS];
}

/**
 * @param {string} host
 * @param {string} query
 * @param {Record<string, string>} [vars]
 * @returns {string[]}
 */
export function glabArgs(host, query, vars = {}) {
  const args = ["api", "graphql", "--hostname", host, "-f", `query=${query}`];
  for (const [key, value] of Object.entries(vars)) args.push("-f", `${key}=${value}`);
  return args;
}

/**
 * @param {Provider} provider
 * @param {number} number
 * @returns {string}
 */
export function fetchRef(provider, number) {
  return provider === "gitlab" ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
}
