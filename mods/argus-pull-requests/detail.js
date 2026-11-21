// Builds what the pull request pane shows: the verdict, the folding sections and their summaries,
// the conversation with its file threads, the position in the board, and the merge methods to offer.

import { buildGroups, groupOf, prsInScope } from "./board.js";
import { prKey } from "./model.js";
import { displayName, shownOrder as orderOf } from "./forge-board.js";
import { NO_METHOD, pickMergeMethod } from "./actions.js";

/** @typedef {import("./model.js").Detail} Detail */
/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").Thread} Thread */
/** @typedef {{kind: "comment"|"review"|"thread", at: string, entry: Entry|null, threads: Thread[]}} Item */
/** @typedef {{method: "merge"|"squash"|"rebase", label: string, isDefault: boolean}} Method */

/** The verdict titles, in the board's words for its groups. */
const VERDICT_TITLES = { ready: "Ready to merge", needsWork: "Needs work", waiting: "Waiting on review", draft: "Draft" };

/** The display names of the reviewers whose latest state is `state`, joined by commas. */
function namesWith(detail, state) {
  return detail.reviewers
    .filter((reviewer) => reviewer.state === state)
    .map((reviewer) => displayName(reviewer.name, detail.names))
    .join(", ");
}

/** The words for `count` checks in `state`; `total` is the number of all checks. */
function checkReason(count, total, state) {
  if (total === 1) return `1 check ${state}`;
  return state === "passed" ? `${count} checks passed` : `${count} of ${total} checks ${state}`;
}

/** The line a verdict shows when it has no reason of its own, by group. */
const FALLBACK_REASONS = { ready: "Nothing blocks the merge", waiting: "No review yet", draft: "Marked as draft", needsWork: "Needs work" };

/**
 * The pane's verdict: the board's group for the pull request (or Merged, Closed) and one line
 * of reasons from its checks, review and merge state. The group comes from `groupOf` with the
 * reviewers of the detail, so a reviewer's open request for changes moves the pull request to
 * Needs work on the board and in the pane.
 * @param {Detail} detail
 * @returns {{group: "ready"|"needsWork"|"waiting"|"draft"|"merged"|"closed", title: string, reasons: string}}
 */
export function verdictOf(detail) {
  const { pr } = detail;
  if (pr.state === "merged") return { group: "merged", title: "Merged", reasons: `Merged into ${pr.baseRef}` };
  if (pr.state === "closed") return { group: "closed", title: "Closed", reasons: "Closed without a merge" };
  const changesBy = detail.reviewers.filter((reviewer) => reviewer.state === "changes_requested").map((reviewer) => reviewer.name);
  const group = groupOf({ ...pr, changesRequestedBy: changesBy });
  const total = detail.checks.length;
  const failed = detail.checks.filter((check) => check.state === "failed").length;
  const running = detail.checks.filter((check) => check.state === "running").length;
  const reasons = [];
  if (failed > 0) reasons.push(checkReason(failed, total, "failed"));
  else if (running > 0) reasons.push(checkReason(running, total, "running"));
  else if (total > 0) reasons.push(checkReason(total, total, "passed"));
  const requestedBy = namesWith(detail, "changes_requested");
  switch (pr.reviewDecision) {
    case "changes_requested":
      reasons.push(requestedBy === "" ? "changes requested" : `changes requested by ${requestedBy}`);
      break;
    case "approved": {
      const names = namesWith(detail, "approved");
      reasons.push(names === "" ? "approved" : `approved by ${names}`);
      break;
    }
    case "review_required":
      reasons.push("review required");
      break;
    default:
      break;
  }
  if (pr.reviewDecision !== "changes_requested" && requestedBy !== "") reasons.push(`changes requested by ${requestedBy}`);
  if (pr.isDraft) reasons.push("draft");
  if (detail.merge.state === "conflicting") reasons.push("merge conflicts");
  else if (detail.merge.state === "blocked") reasons.push(detail.merge.reason ?? "merge blocked");
  else if (detail.merge.state === "unknown") reasons.push("merge state not known yet");
  return { group, title: VERDICT_TITLES[group], reasons: reasons.length > 0 ? reasons.join(" · ") : FALLBACK_REASONS[group] };
}

/**
 * The sections that open by themselves because they need the person: Checks when a check failed
 * or runs, Conversation when a file thread is open, Review agent when a run exists.
 * @param {Detail} detail
 * @param {Array<{path: string, branch: string}>} runs
 * @returns {Set<"checks"|"conversation"|"agent">}
 */
export function openByDefault(detail, runs) {
  const open = new Set();
  if (detail.checks.some((check) => check.state === "failed" || check.state === "running")) open.add("checks");
  if (detail.threads.some((thread) => !thread.resolved)) open.add("conversation");
  if (runs.length > 0) open.add("agent");
  return open;
}

/**
 * Whether a section is open: the person's stored choice while the default is what it was when
 * they chose, else the default now. A section closed while it was green opens when it needs them.
 * @param {{open: boolean, defaultWas: boolean}|undefined} stored
 * @param {boolean} defaultNow
 * @returns {boolean}
 */
export function sectionOpen(stored, defaultNow) {
  if (stored && typeof stored === "object" && stored.defaultWas === defaultNow) return stored.open;
  return defaultNow;
}

/**
 * The checks to list (failed, then running) and the passed ones, which the pane folds into one line.
 * @param {import("./model.js").Check[]} checks
 * @returns {{problems: import("./model.js").Check[], passed: import("./model.js").Check[]}}
 */
export function checkGroups(checks) {
  return {
    problems: [...checks.filter((check) => check.state === "failed"), ...checks.filter((check) => check.state === "running")],
    passed: checks.filter((check) => check.state === "passed"),
  };
}

/** At most this many checks show one by one when none failed or runs. */
const FEW_CHECKS = 5;

/**
 * The Checks section: the rows to list and the line that folds the passed checks, or null for
 * no line. Failed and running checks are always listed; passed ones fold into one line that
 * `passedOpen` opens, except a few passed checks with nothing failed or running, which are listed as they are.
 * @param {import("./model.js").Check[]} checks
 * @param {boolean} passedOpen
 * @returns {{rows: import("./model.js").Check[], passedLine: {count: number, open: boolean}|null}}
 */
export function checkLayout(checks, passedOpen) {
  const { problems, passed } = checkGroups(checks);
  if (passed.length === 0) return { rows: problems, passedLine: null };
  if (problems.length === 0 && passed.length <= FEW_CHECKS) return { rows: passed, passedLine: null };
  return { rows: passedOpen ? [...problems, ...passed] : problems, passedLine: { count: passed.length, open: passedOpen } };
}

/**
 * The text beside each section heading, so a folded section still says what it holds.
 * @param {Detail} detail
 * @param {Array<{path: string, branch: string}>} runs
 * @param {boolean} hasCheckout
 * @returns {{checks: string, reviews: string, agent: string, conversation: string}}
 */
export function sectionSummaries(detail, runs, hasCheckout) {
  const passed = detail.checks.filter((check) => check.state === "passed").length;
  const count = (state) => detail.reviewers.filter((reviewer) => reviewer.state === state).length;
  const reviews = [
    [count("changes_requested"), "changes requested"],
    [count("approved"), "approved"],
    [count("commented"), "commented"],
    [count("requested"), "waiting"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(" · ");
  let agent = "none yet";
  if (!hasCheckout) agent = "no local checkout";
  else if (runs.length > 0) agent = runs.length === 1 ? "1 worktree" : `${runs.length} worktrees`;
  const summary = summaryOf(detail);
  const comments = summary.comments === 0 ? "no comments" : summary.comments === 1 ? "1 comment" : `${summary.comments} comments`;
  const threads = summary.openThreads === 0 ? "" : summary.openThreads === 1 ? " · 1 open thread" : ` · ${summary.openThreads} open threads`;
  return {
    checks: detail.checks.length === 0 ? "none" : `${passed} / ${detail.checks.length}`,
    reviews: reviews === "" ? "none yet" : reviews,
    agent,
    conversation: `${comments}${threads}`,
  };
}

/**
 * The summary over the conversation: reviewers who requested changes, unresolved file threads,
 * and the written texts (comments, review bodies, thread comments) with their distinct authors.
 * @param {Detail} detail
 * @returns {{requested: number, openThreads: number, comments: number, people: number}}
 */
export function summaryOf(detail) {
  const texts = [
    ...detail.conversation.filter((entry) => entry.body.trim() !== ""),
    ...detail.threads.flatMap((thread) => thread.comments.filter((comment) => comment.body.trim() !== "")),
  ];
  return {
    requested: detail.reviewers.filter((reviewer) => reviewer.state === "changes_requested").length,
    openThreads: detail.threads.filter((thread) => !thread.resolved).length,
    comments: texts.length,
    people: new Set(texts.map((text) => text.author)).size,
  };
}

/** Orders threads by path, then line. */
function byPlace(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}

/**
 * The conversation as the pane shows it: comments, reviews with their file threads, and the
 * threads that belong to no listed review as their own items, in time order or newest first.
 * @param {Detail} detail
 * @param {string} order "oldest" or "newest".
 * @returns {Item[]}
 */
export function conversationItems(detail, order) {
  const reviewIds = new Set(detail.conversation.filter((entry) => entry.kind === "review" && entry.id !== null).map((entry) => entry.id));
  /** @type {Item[]} */
  const items = detail.conversation
    .map((entry) => ({
      kind: entry.kind,
      at: entry.at,
      entry,
      threads: entry.kind === "review" && entry.id !== null ? detail.threads.filter((thread) => thread.reviewId === entry.id).sort(byPlace) : [],
    }))
    // A review that only holds replies to other threads has no text and no thread of its own; its replies
    // show in those threads. When the thread list was cut, its threads may be among the missing ones, so it stays.
    .filter((item) => detail.threadsNote !== null || !(item.kind === "review" && item.entry.state === "commented" && item.entry.body.trim() === "" && item.threads.length === 0));
  for (const thread of detail.threads) {
    if (thread.reviewId !== null && reviewIds.has(thread.reviewId)) continue;
    items.push({ kind: "thread", at: thread.comments[0]?.at ?? "", entry: null, threads: [thread] });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return order === "newest" ? items.reverse() : items;
}

/**
 * The pull request keys in the order the board shows them for `scope`: its groups, newest first in each.
 * @param {import("./board.js").Board} board
 * @param {import("./board.js").Scope} scope
 * @param {string|null} followed
 * @returns {string[]}
 */
export function shownOrder(board, scope, followed) {
  return orderOf(buildGroups(prsInScope(board, scope, followed)).map((group) => group.prs), prKey);
}

const GH_METHODS = [
  ["merge", "mergeCommitAllowed", "Merge commit"],
  ["squash", "squashMergeAllowed", "Squash and merge"],
  ["rebase", "rebaseMergeAllowed", "Rebase and merge"],
];

/**
 * The GitHub merge methods the repo allows, from `gh repo view` output for `ghMethodArgs`,
 * with the person's default marked as `pickMergeMethod` picks it.
 * @param {string} text
 * @returns {{methods: Method[]}|{error: string}}
 */
export function ghMergeMethods(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "Could not read the merge methods of this repo." };
  }
  if (!raw || typeof raw !== "object") return { error: "Could not read the merge methods of this repo." };
  const preferred = pickMergeMethod(text);
  const methods = GH_METHODS.filter(([, setting]) => raw[setting] === true).map(([method, , label]) => ({ method, label, isDefault: method === preferred }));
  return methods.length === 0 ? { error: NO_METHOD } : { methods: /** @type {Method[]} */ (methods) };
}

/**
 * The GitLab merge methods: Squash and merge alone when the merge request is set to squash
 * (glab cannot turn squash off), Merge alone when the project forbids squash, else Merge
 * (the default) and Squash and merge.
 * @param {Detail} detail
 * @returns {{methods: Method[]}}
 */
export function glMergeMethods(detail) {
  const merge = { method: "merge", label: "Merge", isDefault: true };
  const squash = { method: "squash", label: "Squash and merge", isDefault: true };
  // glab can turn squash on but not off, so a merge request set to squash offers only squash.
  if (detail.squashLocked || detail.squash) return { methods: [detail.squash ? squash : merge] };
  return { methods: /** @type {Method[]} */ ([merge, { ...squash, isDefault: false }]) };
}

/**
 * Whether a picked merge method is still one the pane offers. On GitLab the offer follows the
 * merge request, which a re-read can change while a confirm is open; GitHub's offer comes from
 * the repo read the confirm used.
 * @param {Detail} detail
 * @param {string} method
 * @returns {boolean}
 */
export function mergeAllowed(detail, method) {
  if (detail.pr.provider !== "gitlab") return true;
  return glMergeMethods(detail).methods.some((entry) => entry.method === method);
}

/**
 * The note under the merge menu that says why Merge is missing on a GitLab merge request set
 * to squash, or null.
 * @param {Detail} detail
 * @returns {string|null}
 */
export function mergeMenuNote(detail) {
  if (detail.pr.provider !== "gitlab" || !detail.squash || detail.squashLocked) return null;
  return "This merge request is set to squash. To merge without squash, turn that off on GitLab.";
}
