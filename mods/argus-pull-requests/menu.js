// Copied from lib/menu.js by scripts/sync-lib.mjs: edit lib/menu.js, then run it.
//
// Menu metrics and keyboard handling for a list of menu rows: Up and Down move
// the highlighted row (wrapping), Enter picks it, Escape closes the menu. No
// Herdr imports, so Node can test it.

/** Padding around the rows of a menu, as in Herdr's menu. */
export const MENU_PAD = 5;
/** Height of one menu row. */
export const MENU_ROW = 31;
/** Height of one section title (`sectionTitle`) in a menu. */
export const MENU_TITLE = 30;

/**
 * The height of a popup menu. A popup is as tall as its content, up to the
 * height it was opened with, so its list gets an explicit height.
 *
 * @param {number} rows The number of menu rows.
 * @param {number} [titles] The number of section titles.
 * @param {{ extra?: number, max?: number }} [options] `extra` adds the height of other content;
 *   `max` caps the result, usually at the height the popup was opened with.
 * @returns {number}
 */
export function menuHeight(rows, titles = 0, { extra = 0, max = Infinity } = {}) {
  return Math.min(max, 2 * MENU_PAD + rows * MENU_ROW + titles * MENU_TITLE + extra);
}

/** The part of a menu that a long list keeps above a foot: a section title and three rows. */
export const MENU_LIST_MIN = MENU_TITLE + 3 * MENU_ROW;

/**
 * The height of a menu's foot (`menuPopup` `foot`) that can be long: its content, up to the
 * height that leaves the list above `MENU_LIST_MIN`, or more when the list is shorter.
 *
 * @param {number} foot The content height of the foot.
 * @param {number} list The content height of the list above it.
 * @param {number} height The height of the menu (`menuHeight`).
 * @returns {number}
 */
export function footHeight(foot, list, height) {
  const inside = height - 2 * MENU_PAD;
  return Math.max(0, Math.min(foot, inside - Math.min(list, MENU_LIST_MIN)));
}

/**
 * What a key does in a menu of `length` rows with row `at` highlighted.
 *
 * @param {number} at The highlighted row.
 * @param {string} key The key name from the key event.
 * @param {number} length The number of rows.
 * @returns {{ handled: boolean, at: number, action: "pick" | "close" | null }}
 */
export function menuKey(at, key, length) {
  const row = Number.isInteger(at) && at >= 0 && at < length ? at : 0;
  switch (key) {
    case "down":
      return { handled: true, at: length > 0 ? (row + 1) % length : 0, action: null };
    case "up":
      return { handled: true, at: length > 0 ? (row + length - 1) % length : 0, action: null };
    case "enter":
      return { handled: true, at: row, action: length > 0 ? "pick" : null };
    case "escape":
      return { handled: true, at: row, action: "close" };
    default:
      return { handled: false, at, action: null };
  }
}

/**
 * The row a menu opens on: the one marked `current`, else the first.
 *
 * @param {{ current?: boolean }[]} rows
 */
export function startAt(rows) {
  return Math.max(0, rows.findIndex((row) => row.current));
}
