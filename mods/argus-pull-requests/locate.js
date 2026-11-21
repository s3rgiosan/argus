// The settings of the pull request board.

/** Refresh interval choices, in minutes. */
export const INTERVALS = [1, 3, 5, 10, 15];

/** Refresh interval used when the setting is unset or invalid, in minutes. */
export const DEFAULT_INTERVAL = 3;

/**
 * The mod's settings: the gh and glab commands ("" when unset), the refresh interval, and
 * the order of the pane's conversation ("oldest" first by default, or "newest" first).
 * @param {unknown} value
 * @returns {{gh: string, glab: string, interval: number, conversation: string}}
 */
export function normalizeSettings(value) {
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const text = (x) => (typeof x === "string" ? x.trim() : "");
  const interval = INTERVALS.includes(/** @type {number} */ (v.interval))
    ? /** @type {number} */ (v.interval)
    : DEFAULT_INTERVAL;
  const conversation = CONVERSATION_ORDERS.includes(/** @type {string} */ (v.conversation)) ? /** @type {string} */ (v.conversation) : "oldest";
  return { gh: text(v.gh), glab: text(v.glab), interval, conversation };
}

/** The orders the pane can show a conversation in. */
export const CONVERSATION_ORDERS = ["oldest", "newest"];
