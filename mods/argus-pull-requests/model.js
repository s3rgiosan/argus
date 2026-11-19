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
