// Turns forge CLI output into the pull request model.

/** @typedef {import("./remote.js").Provider} Provider */
/** @typedef {{passed: number, failed: number, running: number, total: number}} Checks */
/** @typedef {{provider: Provider, host: string, repo: string, number: number, title: string, url: string, author: string, headRef: string, baseRef: string, isDraft: boolean, state: "open"|"closed"|"merged", reviewDecision: "approved"|"changes_requested"|"review_required"|null, checks: Checks, mergeable: "mergeable"|"conflicting"|"blocked"|"unknown", updatedAt: string, localPath: string|null}} Pr */
/** @typedef {{name: string, state: "passed"|"failed"|"running", url: string|null}} Check */
/** `url` is the page of the check run or job, when the forge gives one. */
/** @typedef {{name: string, state: "approved"|"changes_requested"|"commented"|"dismissed"|"pending"|"requested"}} Reviewer */
/**
 * @typedef {{author: string, body: string, at: string, kind: "comment"|"review", state: "approved"|"changes_requested"|"commented"|"dismissed"|null, id: string|null}} Entry
 *   `state` and `id` belong to reviews; `id` is the GitHub review id, null on GitLab.
 * @typedef {{author: string, body: string, at: string}} ThreadComment
 * @typedef {{path: string, line: number|null, resolved: boolean, reviewId: string|null, comments: ThreadComment[]}} Thread
 *   A file comment thread; `reviewId` links it to its GitHub review, null on GitLab.
 */
/** @typedef {{pr: Pr, body: string, headSha: string|null, squash: boolean, checks: Check[], reviewers: Reviewer[], merge: {state: Pr["mergeable"], reason: string|null}, conversation: Entry[], threads: Thread[], threadsError: string|null, threadsNote: string|null, squashLocked: boolean, names: Record<string, string>}} Detail */
/** `names` maps a login to the display name the forge gives, for the logins that have one. */

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
    // A check run links its run page; a status context links its target.
    const url = webUrl(entry.detailsUrl) ?? webUrl(entry.targetUrl);
    if (typeof entry.status === "string" || typeof entry.conclusion === "string") {
      if (entry.status !== "COMPLETED") checks.push({ name, state: "running", url });
      else if (GH_PASSED.has(entry.conclusion)) checks.push({ name, state: "passed", url });
      else if (GH_FAILED.has(entry.conclusion)) checks.push({ name, state: "failed", url });
      else checks.push({ name, state: "running", url });
    } else if (typeof entry.state === "string") {
      if (entry.state === "SUCCESS") checks.push({ name, state: "passed", url });
      else if (GH_CONTEXT_FAILED.has(entry.state)) checks.push({ name, state: "failed", url });
      else checks.push({ name, state: "running", url });
    }
  }
  return checks;
}

/**
 * An http or https URL, or null for anything else.
 * @param {unknown} value
 * @returns {string|null}
 */
function webUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

/**
 * The page of a GitLab path on `host`, or null when the path is not one.
 * @param {string} host
 * @param {unknown} path A path such as `/group/project/-/jobs/8`.
 * @returns {string|null}
 */
function glPageUrl(host, path) {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? `https://${host}${path}` : null;
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
    entries.push({ author: String(comment?.author?.login ?? ""), body, at: String(comment?.createdAt ?? ""), kind: "comment", state: null, id: null });
  }
  // Every submitted review is an entry, also without a body (most approvals), so its file threads have a place.
  for (const review of Array.isArray(raw.reviews) ? raw.reviews : []) {
    const state = GH_REVIEW_STATES[review?.state];
    if (!state || state === "pending") continue;
    const id = typeof review?.id === "string" && review.id !== "" ? review.id : null;
    entries.push({ author: String(review?.author?.login ?? ""), body: String(review?.body ?? ""), at: String(review?.submittedAt ?? ""), kind: "review", state, id });
  }
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * The review threads from `gh api graphql` output for `GH_THREADS_QUERY`. Comments are sorted
 * by time; a thread belongs to the review of its first comment. `truncated` is true when the
 * list reached its limit of 100.
 * @param {string} text
 * `names` maps each participant's login to their display name, when they set one.
 * @returns {{threads: Thread[], truncated: boolean, names: Record<string, string>}}
 */
export function parseGhThreads(text) {
  const raw = parseJson(text);
  if (!isObject(raw)) throw unexpected();
  if (Array.isArray(raw.errors) && raw.errors.length > 0) throw new Error(String(raw.errors[0]?.message ?? "unexpected gh output"));
  const nodes = raw.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) throw unexpected();
  const threads = [];
  for (const node of nodes) {
    if (!isObject(node) || typeof node.path !== "string") continue;
    const comments = (Array.isArray(node.comments?.nodes) ? node.comments.nodes : [])
      .filter(isObject)
      .map((comment) => ({ author: String(comment.author?.login ?? ""), body: String(comment.body ?? ""), at: String(comment.createdAt ?? ""), review: comment.pullRequestReview?.id }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const line = Number.isInteger(node.line) ? node.line : Number.isInteger(node.originalLine) ? node.originalLine : null;
    const first = comments[0]?.review;
    threads.push({
      path: node.path,
      line,
      resolved: node.isResolved === true,
      reviewId: typeof first === "string" && first !== "" ? first : null,
      comments: comments.map(({ author, body, at }) => ({ author, body, at })),
    });
  }
  /** @type {Record<string, string>} */
  const names = {};
  // Participants, and requested reviewers who have not taken part yet.
  const pull = raw.data?.repository?.pullRequest;
  const requested = Array.isArray(pull?.reviewRequests?.nodes) ? pull.reviewRequests.nodes.map((request) => request?.requestedReviewer) : [];
  const people = [...(Array.isArray(pull?.participants?.nodes) ? pull.participants.nodes : []), ...requested];
  for (const person of people) {
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (typeof person?.login === "string" && name !== "") names[person.login] = name;
  }
  return { threads, truncated: nodes.length >= THREAD_LIMIT, names };
}

/**
 * The detail with the result of the thread read: its threads and limit note, or the read's error.
 * A failed thread read leaves the rest of the detail as it is.
 * @param {Detail} detail
 * @param {{threads: Thread[], truncated: boolean, names?: Record<string, string>}|null} read
 * @param {string|null} error
 * @returns {Detail}
 */
export function mergeThreads(detail, read, error) {
  if (read === null) return { ...detail, threads: [], threadsNote: null, threadsError: error };
  return { ...detail, threads: read.threads, threadsNote: read.truncated ? THREADS_LIMIT_NOTE : null, threadsError: null, names: { ...detail.names, ...(read.names ?? {}) } };
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
    headSha: shaOf(raw.headRefOid),
    squash: false,
    checks: ghCheckList(raw.statusCheckRollup),
    reviewers: ghReviewers(raw),
    merge: { state: pr.mergeable, reason: GH_MERGE_REASONS[raw.mergeStateStatus] ?? null },
    conversation: ghConversation(raw),
    threads: [],
    threadsError: null,
    threadsNote: null,
    squashLocked: false,
    names: {},
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

/** The merge requests of a list connection; one without a usable iid is left out. */
function glMergeRequests(connection, host) {
  return glNodes(connection)
    .filter((node) => isObject(node) && glIid(node) !== null)
    .map((node) => parseGlabMr(node, host));
}

function glPipelineState(status) {
  const value = upper(status);
  if (GL_PASSED.has(value)) return "passed";
  if (GL_FAILED.has(value)) return "failed";
  return "running";
}

function glChecks(node, host) {
  return isObject(node.headPipeline) ? [{ name: "pipeline", state: glPipelineState(node.headPipeline.status), url: glPageUrl(host, node.headPipeline.path) }] : [];
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
 * The merge request number of `node`: a positive whole number, as a number or a string of digits.
 * @param {object} node
 * @returns {?number}
 */
function glIid(node) {
  const iid = node.iid;
  const text = typeof iid === "number" ? String(iid) : typeof iid === "string" ? iid : "";
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * @param {object} node One merge request from the GitLab GraphQL API.
 * @param {string} host
 * @returns {Pr}
 */
export function parseGlabMr(node, host) {
  const number = isObject(node) ? glIid(node) : null;
  if (number === null) throw glUnexpected();
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
    checks: summarize(glChecks(node, host)),
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
    needsReview: glMergeRequests(user.reviewRequestedMergeRequests, host),
    mine: glMergeRequests(user.authoredMergeRequests, host),
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
  return glMergeRequests(data.project.mergeRequests, host);
}

function glJobChecks(node, host) {
  if (!isObject(node.headPipeline)) return [];
  const jobs = node.headPipeline.jobs?.nodes;
  if (!Array.isArray(jobs) || jobs.length === 0) return glChecks(node, host);
  return jobs.filter(isObject).map((job) => ({ name: String(job.name ?? ""), state: glPipelineState(job.status), url: glPageUrl(host, job.webPath) }));
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

/** The text that says a thread list stopped at its limit. */
export const THREADS_LIMIT_NOTE = "Showing the first 100 file comment threads.";

/** The most threads one read returns. */
const THREAD_LIMIT = 100;

/**
 * The human notes of a GitLab discussion, oldest first, without system notes.
 * @returns {Array<{author: string, name: string, body: string, at: string, position: unknown}>}
 */
function glNotes(discussion) {
  const nodes = discussion?.notes?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((note) => isObject(note) && note.system !== true && String(note.body ?? "") !== "")
    .map((note) => ({ author: String(note.author?.username ?? ""), name: typeof note.author?.name === "string" ? note.author.name.trim() : "", body: String(note.body), at: String(note.createdAt ?? ""), position: note.position }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * The conversation and the file threads of a GitLab merge request. A discussion whose
 * first note has a file position is a thread; the notes of every other discussion are entries.
 * `names` maps each note author's username to their display name.
 * @returns {{conversation: Entry[], threads: Thread[], threadsNote: string|null, names: Record<string, string>}}
 */
function glDiscussions(node) {
  const nodes = node.discussions?.nodes;
  if (!Array.isArray(nodes)) return { conversation: [], threads: [], threadsNote: null, names: {} };
  const conversation = [];
  const threads = [];
  /** @type {Record<string, string>} */
  const names = {};
  for (const discussion of nodes) {
    if (!isObject(discussion)) continue;
    const notes = glNotes(discussion);
    if (notes.length === 0) continue;
    for (const note of notes) if (note.author !== "" && note.name !== "") names[note.author] = note.name;
    const position = notes[0].position;
    if (isObject(position) && typeof position.filePath === "string") {
      const line = Number.isInteger(position.newLine) ? position.newLine : Number.isInteger(position.oldLine) ? position.oldLine : null;
      threads.push({
        path: position.filePath,
        line,
        resolved: discussion.resolved === true,
        reviewId: null,
        comments: notes.map(({ author, body, at }) => ({ author, body, at })),
      });
      continue;
    }
    for (const { author, body, at } of notes) conversation.push({ author, body, at, kind: "comment", state: null, id: null });
  }
  conversation.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { conversation, threads, threadsNote: nodes.length >= THREAD_LIMIT ? THREADS_LIMIT_NOTE : null, names };
}

/**
 * The discussions' names plus the names of the reviewers, so a reviewer who has not commented shows by name too.
 * @param {{names: Record<string, string>}} discussions
 * @param {object} node The merge request.
 */
function withReviewerNames(discussions, node) {
  const names = { ...discussions.names };
  for (const reviewer of Array.isArray(node.reviewers?.nodes) ? node.reviewers.nodes : []) {
    const name = typeof reviewer?.name === "string" ? reviewer.name.trim() : "";
    if (typeof reviewer?.username === "string" && name !== "") names[reviewer.username] ??= name;
  }
  return { ...discussions, names };
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
    headSha: shaOf(node.diffHeadSha),
    squash: node.squashOnMerge === true,
    checks: glJobChecks(node, host),
    reviewers: glReviewers(node),
    merge: { state: pr.mergeable, reason: glReason(node.detailedMergeStatus) },
    ...withReviewerNames(glDiscussions(node), node),
    threadsError: null,
    squashLocked: node.targetProject?.squashReadOnly === true,
  };
}

/**
 * A commit SHA from a CLI reply, or null when it is missing or empty.
 * @param {unknown} value
 * @returns {string|null}
 */
function shaOf(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
