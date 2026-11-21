// Pure helpers for the issue pane: state text, the opened line, comment order and names.

import { ageText, displayName } from "./forge-board.js";

/** @typedef {import("./model.js").Detail} Detail */
/** @typedef {import("./model.js").Issue} Issue */

/** The pane's folding sections, in order. Both start open. */
export const SECTIONS = [
  ["description", "Description"],
  ["comments", "Comments"],
];

// GitHub's state reasons for a closed issue, as the pane names them.
const CLOSED_REASONS = { completed: "Closed as completed", not_planned: "Closed as not planned", duplicate: "Closed as duplicate" };

/**
 * The state the pane shows: Open, or Closed with GitHub's reason when it gives one.
 * @param {Issue} issue
 * @returns {{text: string, open: boolean}}
 */
export function stateText(issue) {
  if (issue.state === "open") return { text: "Open", open: true };
  const reason = issue.stateReason ?? "";
  return { text: Object.hasOwn(CLOSED_REASONS, reason) ? CLOSED_REASONS[reason] : "Closed", open: false };
}

/**
 * The names the forge gives the people of an issue, by login: the author, the assignees and the
 * comment authors that have a display name.
 * @param {Detail} detail
 * @returns {Record<string, string>}
 */
export function namesOf(detail) {
  /** @type {Record<string, string>} */
  const names = {};
  const add = (login, name) => {
    if (login === "" || name === "" || Object.hasOwn(names, login)) return;
    // A plain assignment of "__proto__" would change the prototype.
    Object.defineProperty(names, login, { value: name, enumerable: true, writable: true, configurable: true });
  };
  add(detail.issue.author, detail.issue.authorName);
  for (const person of detail.issue.assignees) add(person.login, person.name);
  for (const comment of detail.comments) add(comment.author, comment.name);
  return names;
}

/**
 * The line under the title: who opened the issue and when, then when it changed last.
 * @param {Issue} issue
 * @param {Record<string, string>} names
 * @param {number} now
 * @returns {string}
 */
export function openedLine(issue, names, now) {
  const opened = ageText(issue.createdAt, now);
  const updated = ageText(issue.updatedAt, now);
  const who = issue.author === "" ? "" : `${displayName(issue.author, names)} `;
  const parts = [];
  if (opened !== "") parts.push(`${who}opened ${agoText(opened)}`);
  else if (who !== "") parts.push(`opened by ${who.trim()}`);
  if (updated !== "") parts.push(`updated ${agoText(updated)}`);
  return parts.join(" · ");
}

/** "now", or an age such as "3d" followed by "ago". */
function agoText(age) {
  return age === "now" ? "now" : `${age} ago`;
}

/**
 * The comments in the order of the Conversation setting: "oldest" or "newest" first.
 * @param {Detail} detail
 * @param {string} order
 * @returns {import("./model.js").Comment[]}
 */
export function commentItems(detail, order) {
  const list = [...detail.comments];
  return order === "newest" ? list.reverse() : list;
}

/**
 * The summary a folded section shows: the comment count, or empty.
 * @param {Detail} detail
 * @returns {Record<string, string>}
 */
export function sectionSummaries(detail) {
  const count = detail.comments.length;
  return { description: detail.body.trim() === "" ? "None" : "", comments: count === 1 ? "1 comment" : `${count} comments` };
}

/**
 * The text of a comment that the forge hid: GitHub's reason when it gives one.
 * @param {string} reason
 * @returns {string}
 */
export function hiddenText(reason) {
  return reason === "" ? "Hidden by GitHub." : `Hidden by GitHub as ${reason}.`;
}
