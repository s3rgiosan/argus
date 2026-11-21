// Keyboard handling for a list of menu rows: Up and Down move the highlighted
// row (wrapping), Enter picks it, Escape closes the menu. No Herdr imports,
// so Node can test it.

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
