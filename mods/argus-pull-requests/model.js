// Turns forge CLI output into the pull request model.

/** @typedef {import("./remote.js").Provider} Provider */
/** @typedef {{passed: number, failed: number, running: number, total: number}} Checks */
/** @typedef {{provider: Provider, host: string, repo: string, number: number, title: string, url: string, author: string, headRef: string, baseRef: string, isDraft: boolean, state: "open"|"closed"|"merged", reviewDecision: "approved"|"changes_requested"|"review_required"|null, checks: Checks, mergeable: "mergeable"|"conflicting"|"blocked"|"unknown", updatedAt: string, localPath: string|null}} Pr */
/** @typedef {{name: string, state: "passed"|"failed"|"running"}} Check */
/** @typedef {{name: string, state: "approved"|"changes_requested"|"commented"|"dismissed"|"pending"|"requested"}} Reviewer */
/** @typedef {{author: string, body: string, at: string, kind: "comment"|"review"}} Entry */
/** @typedef {{pr: Pr, body: string, checks: Check[], reviewers: Reviewer[], merge: {state: Pr["mergeable"], reason: string|null}, conversation: Entry[]}} Detail */

const GH_HOST = "github.com";

const GH_PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const GH_FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const GH_CONTEXT_FAILED = new Set(["ERROR", "FAILURE"]);

const GH_REVIEW_STATES = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

const GH_MERGE_REASONS = {
  BEHIND: "The head branch is behind the base branch.",
  BLOCKED: "Blocked by branch protection: required reviews or checks.",
  DIRTY: "There are merge conflicts.",
  UNSTABLE: "Mergeable, but some checks are not passing.",
  UNKNOWN: "GitHub is still checking.",
};

function unexpected() {
  return new Error("unexpected gh output");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw unexpected();
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{host: string, repo: string, number: number}} pr
 * @returns {string}
 */
export function prKey(pr) {
  return `${pr.host}/${pr.repo}#${pr.number}`.toLowerCase();
}

/**
 * Reads a GitHub pull request URL or a GitLab merge request URL.
 * @param {string} url
 * @returns {?{host: string, repo: string, number: number}}
 */
export function parsePrUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const gitlab = /^\/(.+?)\/-\/merge_requests\/(\d+)\/?$/.exec(parsed.pathname);
  const github = /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname);
  const match = gitlab ?? github;
  if (!match) return null;
  return { host: parsed.host.toLowerCase(), repo: match[1], number: Number(match[2]) };
}

/**
 * @param {string} text `gh search prs --json number,url` output.
 * @returns {Array<{host: string, repo: string, number: number}>}
 */
export function parseGhSearch(text) {
  const raw = parseJson(text);
  if (!Array.isArray(raw)) throw unexpected();
  const found = [];
  for (const item of raw) {
    const ref = isObject(item) ? parsePrUrl(item.url) : null;
    if (ref) found.push(ref);
  }
  return found;
}

/**
 * @param {unknown} rollup `statusCheckRollup` from gh.
 * @returns {Check[]}
 */
export function ghCheckList(rollup) {
  if (!Array.isArray(rollup)) return [];
  const checks = [];
  for (const entry of rollup) {
    if (!isObject(entry)) continue;
    const name = String(entry.name ?? entry.context ?? "");
    if (typeof entry.status === "string" || typeof entry.conclusion === "string") {
      if (entry.status !== "COMPLETED") checks.push({ name, state: "running" });
      else if (GH_PASSED.has(entry.conclusion)) checks.push({ name, state: "passed" });
      else if (GH_FAILED.has(entry.conclusion)) checks.push({ name, state: "failed" });
      else checks.push({ name, state: "running" });
    } else if (typeof entry.state === "string") {
      if (entry.state === "SUCCESS") checks.push({ name, state: "passed" });
      else if (GH_CONTEXT_FAILED.has(entry.state)) checks.push({ name, state: "failed" });
      else checks.push({ name, state: "running" });
    }
  }
  return checks;
}

/**
 * @param {Check[]} checks
 * @returns {Checks}
 */
export function summarize(checks) {
  const sums = { passed: 0, failed: 0, running: 0, total: checks.length };
  for (const check of checks) sums[check.state] += 1;
  return sums;
}

function ghMergeable(raw) {
  const status = raw.mergeStateStatus;
  if (raw.mergeable === "CONFLICTING" || status === "DIRTY") return "conflicting";
  if (raw.mergeable === "MERGEABLE" && ["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(status)) return "mergeable";
  if (status === "BLOCKED" || status === "BEHIND") return "blocked";
  return "unknown";
}

function ghState(state) {
  if (state === "OPEN") return "open";
  if (state === "MERGED") return "merged";
  return "closed";
}

function ghDecision(decision) {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return null;
  }
}

/**
 * @param {object} raw One `gh pr list|view --json` object.
 * @param {string} repo
 * @returns {Pr}
 */
export function parseGhPr(raw, repo) {
  if (!isObject(raw) || typeof raw.number !== "number") throw unexpected();
  return {
    provider: "github",
    host: GH_HOST,
    repo,
    number: raw.number,
    title: String(raw.title ?? ""),
    url: String(raw.url ?? ""),
    author: String(raw.author?.login ?? ""),
    headRef: String(raw.headRefName ?? ""),
    baseRef: String(raw.baseRefName ?? ""),
    isDraft: raw.isDraft === true,
    state: ghState(raw.state),
    reviewDecision: ghDecision(raw.reviewDecision),
    checks: summarize(ghCheckList(raw.statusCheckRollup)),
    mergeable: ghMergeable(raw),
    updatedAt: String(raw.updatedAt ?? ""),
    localPath: null,
  };
}

/**
 * @param {string} text `gh pr list --json` output.
 * @param {string} repo
 * @returns {Pr[]}
 */
export function parseGhList(text, repo) {
  const raw = parseJson(text);
  if (!Array.isArray(raw)) throw unexpected();
  return raw.map((item) => parseGhPr(item, repo));
}

function ghReviewers(raw) {
  const reviewers = [];
  const seen = new Set();
  for (const review of Array.isArray(raw.latestReviews) ? raw.latestReviews : []) {
    const name = review?.author?.login;
    const state = GH_REVIEW_STATES[review?.state];
    if (typeof name !== "string" || !state || seen.has(name)) continue;
    seen.add(name);
    reviewers.push({ name, state });
  }
  for (const request of Array.isArray(raw.reviewRequests) ? raw.reviewRequests : []) {
    const name = request?.login ?? request?.slug ?? request?.name;
    if (typeof name !== "string" || seen.has(name)) continue;
    seen.add(name);
    reviewers.push({ name, state: "requested" });
  }
  return reviewers;
}

function ghConversation(raw) {
  const entries = [];
  for (const comment of Array.isArray(raw.comments) ? raw.comments : []) {
    const body = String(comment?.body ?? "");
    if (body === "") continue;
    entries.push({ author: String(comment?.author?.login ?? ""), body, at: String(comment?.createdAt ?? ""), kind: "comment" });
  }
  for (const review of Array.isArray(raw.reviews) ? raw.reviews : []) {
    const body = String(review?.body ?? "");
    if (body === "") continue;
    entries.push({ author: String(review?.author?.login ?? ""), body, at: String(review?.submittedAt ?? ""), kind: "review" });
  }
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * @param {string} text `gh pr view --json` output.
 * @param {string} repo
 * @returns {Detail}
 */
export function parseGhDetail(text, repo) {
  const raw = parseJson(text);
  if (!isObject(raw)) throw unexpected();
  const pr = parseGhPr(raw, repo);
  return {
    pr,
    body: String(raw.body ?? ""),
    checks: ghCheckList(raw.statusCheckRollup),
    reviewers: ghReviewers(raw),
    merge: { state: pr.mergeable, reason: GH_MERGE_REASONS[raw.mergeStateStatus] ?? null },
    conversation: ghConversation(raw),
  };
}

const GL_PASSED = new Set(["SUCCESS", "SKIPPED"]);
const GL_FAILED = new Set(["FAILED", "CANCELED"]);
const GL_UNKNOWN_MERGE = new Set(["CHECKING", "UNCHECKED", "PREPARING", "APPROVALS_SYNCING"]);

const GL_REVIEW_STATES = {
  APPROVED: "approved",
  REQUESTED_CHANGES: "changes_requested",
  REVIEWED: "commented",
  REVIEW_STARTED: "pending",
  UNAPPROVED: "dismissed",
  UNREVIEWED: "requested",
};

const GL_MERGE_REASONS = {
  UNCHECKED: "Merge status has not been checked.",
  CHECKING: "Currently checking for mergeability.",
  COMMITS_STATUS: "Source branch exists and contains commits.",
  CI_MUST_PASS: "Pipeline must succeed before merging.",
  CI_STILL_RUNNING: "Pipeline is still running.",
  DISCUSSIONS_NOT_RESOLVED: "Discussions must be resolved before merging.",
  DRAFT_STATUS: "Merge request must not be draft before merging.",
  NOT_OPEN: "Merge request must be open before merging.",
  NOT_APPROVED: "Merge request must be approved before merging.",
  BLOCKED_STATUS: "Merge request dependencies must be merged.",
  EXTERNAL_STATUS_CHECKS: "Status checks must pass.",
  PREPARING: "Merge request diff is being created.",
  JIRA_ASSOCIATION: "Either the title or description must reference a Jira issue.",
  CONFLICT: "There are conflicts between the source and target branches.",
  NEED_REBASE: "Merge request needs to be rebased.",
  APPROVALS_SYNCING: "Merge request approvals currently syncing.",
  LOCKED_PATHS: "Merge request includes locked paths.",
  LOCKED_LFS_FILES: "Merge request includes locked LFS files.",
  MERGE_TIME: "Merge request may not be merged outside the specified time frame.",
  SECURITY_POLICIES_VIOLATIONS: "All policy rules must be satisfied.",
  TITLE_NOT_MATCHING: "Merge request title does not match required regex.",
  REQUESTED_CHANGES: "Indicates a reviewer has requested changes.",
  SECURITY_POLICY_PIPELINE_CHECK: "All security policy pipelines must succeed.",
};

function glUnexpected() {
  return new Error("unexpected glab output");
}

function upper(value) {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function lookup(table, key) {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Parses a GraphQL reply and throws the first reported error. */
function glReply(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw glUnexpected();
  }
  if (!isObject(raw)) throw glUnexpected();
  if (Array.isArray(raw.errors) && raw.errors.length > 0) {
    throw new Error(String(raw.errors[0]?.message ?? "unexpected glab output"));
  }
  if (!isObject(raw.data)) throw glUnexpected();
  return raw.data;
}

function glNodes(connection) {
  if (!isObject(connection) || !Array.isArray(connection.nodes)) throw glUnexpected();
  return connection.nodes;
}

function glPipelineState(status) {
  const value = upper(status);
  if (GL_PASSED.has(value)) return "passed";
  if (GL_FAILED.has(value)) return "failed";
  return "running";
}

function glChecks(node) {
  return isObject(node.headPipeline) ? [{ name: "pipeline", state: glPipelineState(node.headPipeline.status) }] : [];
}

function glDecision(node) {
  const status = upper(node.detailedMergeStatus);
  if (status === "REQUESTED_CHANGES") return "changes_requested";
  if (status === "NOT_APPROVED") return "review_required";
  const approvers = node.approvedBy?.nodes;
  return Array.isArray(approvers) && approvers.length > 0 ? "approved" : null;
}

function glMergeable(node) {
  const status = upper(node.detailedMergeStatus);
  if (node.conflicts === true || status === "CONFLICT") return "conflicting";
  if (status === "MERGEABLE") return "mergeable";
  if (status === "" || GL_UNKNOWN_MERGE.has(status)) return "unknown";
  return "blocked";
}

function glState(state) {
  const value = upper(state);
  if (value === "OPENED") return "open";
  if (value === "MERGED") return "merged";
  return "closed";
}

function glReason(status) {
  const value = upper(status);
  if (value === "" || value === "MERGEABLE") return null;
  return lookup(GL_MERGE_REASONS, value) ?? String(status).toLowerCase().replaceAll("_", " ");
}

/**
 * @param {object} node One merge request from the GitLab GraphQL API.
 * @param {string} host
 * @returns {Pr}
 */
export function parseGlabMr(node, host) {
  const number = isObject(node) ? Number(node.iid) : NaN;
  if (!Number.isInteger(number)) throw glUnexpected();
  return {
    provider: "gitlab",
    host,
    repo: String(node.targetProject?.fullPath ?? ""),
    number,
    title: String(node.title ?? ""),
    url: String(node.webUrl ?? ""),
    author: String(node.author?.username ?? ""),
    headRef: String(node.sourceBranch ?? ""),
    baseRef: String(node.targetBranch ?? ""),
    isDraft: node.draft === true,
    state: glState(node.state),
    reviewDecision: glDecision(node),
    checks: summarize(glChecks(node)),
    mergeable: glMergeable(node),
    updatedAt: String(node.updatedAt ?? ""),
    localPath: null,
  };
}

/**
 * @param {string} text `glab api graphql` output for the current user query.
 * @param {string} host
 * @returns {{needsReview: Pr[], mine: Pr[]}}
 */
export function parseGlabUser(text, host) {
  const data = glReply(text);
  if (data.currentUser === null) throw new Error("not signed in");
  if (!isObject(data.currentUser)) throw glUnexpected();
  const user = data.currentUser;
  return {
    needsReview: glNodes(user.reviewRequestedMergeRequests).map((node) => parseGlabMr(node, host)),
    mine: glNodes(user.authoredMergeRequests).map((node) => parseGlabMr(node, host)),
  };
}

/**
 * @param {string} text `glab api graphql` output for the project query.
 * @param {string} host
 * @returns {Pr[]}
 */
export function parseGlabProject(text, host) {
  const data = glReply(text);
  if (data.project === null) throw new Error("project not found");
  if (!isObject(data.project)) throw glUnexpected();
  return glNodes(data.project.mergeRequests).map((node) => parseGlabMr(node, host));
}

function glJobChecks(node) {
  if (!isObject(node.headPipeline)) return [];
  const jobs = node.headPipeline.jobs?.nodes;
  if (!Array.isArray(jobs) || jobs.length === 0) return glChecks(node);
  return jobs.filter(isObject).map((job) => ({ name: String(job.name ?? ""), state: glPipelineState(job.status) }));
}

function glReviewers(node) {
  const nodes = node.reviewers?.nodes;
  if (!Array.isArray(nodes)) return [];
  const reviewers = [];
  for (const reviewer of nodes) {
    if (!isObject(reviewer) || typeof reviewer.username !== "string") continue;
    const state = lookup(GL_REVIEW_STATES, upper(reviewer.mergeRequestInteraction?.reviewState)) ?? "requested";
    reviewers.push({ name: reviewer.username, state });
  }
  return reviewers;
}

function glConversation(node) {
  const nodes = node.notes?.nodes;
  if (!Array.isArray(nodes)) return [];
  const entries = [];
  for (const note of nodes) {
    if (!isObject(note) || note.system === true) continue;
    const body = String(note.body ?? "");
    if (body === "") continue;
    entries.push({ author: String(note.author?.username ?? ""), body, at: String(note.createdAt ?? ""), kind: "comment" });
  }
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * @param {string} text `glab api graphql` output for the detail query.
 * @param {string} host
 * @returns {Detail}
 */
export function parseGlabDetail(text, host) {
  const data = glReply(text);
  if (data.project === null) throw new Error("project not found");
  if (!isObject(data.project)) throw glUnexpected();
  if (data.project.mergeRequest === null) throw new Error("project not found");
  const node = data.project.mergeRequest;
  const pr = parseGlabMr(node, host);
  return {
    pr,
    body: String(node.description ?? ""),
    checks: glJobChecks(node),
    reviewers: glReviewers(node),
    merge: { state: pr.mergeable, reason: glReason(node.detailedMergeStatus) },
    conversation: glConversation(node),
  };
}
