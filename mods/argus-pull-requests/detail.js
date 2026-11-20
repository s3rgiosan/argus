// Builds what the pull request pane shows: the status card rows, the summary, the conversation
// with its file threads, the position in the board, and the merge methods to offer.

import { buildGroups, prsInScope } from "./board.js";
import { prKey } from "./model.js";
import { NO_METHOD, pickMergeMethod } from "./actions.js";

/** @typedef {import("./model.js").Detail} Detail */
/** @typedef {import("./model.js").Entry} Entry */
/** @typedef {import("./model.js").Thread} Thread */
/** @typedef {"pass"|"fail"|"run"|"none"} Icon */
/** @typedef {{kind: "comment"|"review"|"thread", at: string, entry: Entry|null, threads: Thread[]}} Item */
/** @typedef {{method: "merge"|"squash"|"rebase", label: string, isDefault: boolean}} Method */

const REVIEW_ROWS = {
  approved: { icon: "pass", title: "Approved" },
  changes_requested: { icon: "fail", title: "Changes requested" },
  review_required: { icon: "run", title: "Review required" },
};

const MERGE_ROWS = {
  mergeable: { icon: "pass", title: "Mergeable" },
  blocked: { icon: "fail", title: "Merge blocked" },
  conflicting: { icon: "fail", title: "Has conflicts" },
};

/**
 * The rows of the status card: checks, review, merge and agent.
 * @param {Detail} detail
 * @param {Array<{path: string, branch: string}>} runs The review agent worktrees of the pull request.
 * @param {boolean} hasCheckout Whether the repo has a local checkout.
 * @returns {{checks: {icon: Icon, title: string, note: string}, review: {icon: Icon, title: string}, merge: {icon: Icon, title: string, note: string}, agent: {title: string}}}
 */
export function statusRows(detail, runs, hasCheckout) {
  const total = detail.checks.length;
  const count = (state) => detail.checks.filter((check) => check.state === state).length;
  const failed = count("failed");
  const running = count("running");
  let checks;
  if (total === 0) checks = { icon: "none", title: "No checks", note: "" };
  else if (failed > 0) checks = { icon: "fail", title: "Checks failed", note: `${failed} of ${total} failed` };
  else if (running > 0) checks = { icon: "run", title: "Checks running", note: `${running} of ${total} running` };
  else checks = { icon: "pass", title: "Checks passed", note: `${count("passed")} passed` };

  // Without a decision from the forge, the reviewers' latest states give the row.
  const states = new Set(detail.reviewers.map((reviewer) => reviewer.state));
  const fallback = states.has("changes_requested") ? "changes_requested" : states.has("approved") ? "approved" : null;
  const review = REVIEW_ROWS[detail.pr.reviewDecision ?? fallback] ?? { icon: "none", title: "No review yet" };
  let merge;
  if (detail.pr.state === "merged") merge = { icon: "pass", title: "Merged", note: "" };
  else if (detail.pr.state === "closed") merge = { icon: "none", title: "Closed", note: "" };
  else merge = { ...(MERGE_ROWS[detail.merge.state] ?? { icon: "none", title: "Not checked yet" }), note: detail.merge.reason ?? `Open into ${detail.pr.baseRef}` };

  let agent;
  if (!hasCheckout) agent = "No local checkout";
  else if (runs.length === 0) agent = "No agent yet";
  else agent = runs.length === 1 ? "1 review agent worktree" : `${runs.length} review agent worktrees`;
  return { checks, review, merge, agent: { title: agent } };
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
  return buildGroups(prsInScope(board, scope, followed)).flatMap((group) => group.prs.map(prKey));
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
