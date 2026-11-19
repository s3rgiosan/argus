// Copied from lib/order.js by scripts/sync-lib.mjs: edit lib/order.js, then run it.
//
// The order of the toolbar's panel buttons: sorting by a stored order. No
// Herdr imports, so Node can test it.

/**
 * The buttons with the stored order first, then any button not in it, A to Z
 * by label (case-insensitive). Unknown and repeated ids in `order` are ignored.
 *
 * @template {{ id: string, label: string }} T
 * @param {T[] | null | undefined} buttons
 * @param {unknown} order Panel ids, as stored.
 * @returns {T[]}
 */
export function sortButtons(buttons, order) {
  const list = Array.isArray(buttons) ? buttons : [];
  const stored = Array.isArray(order) ? order : [];
  const first = [];
  for (const id of stored) {
    const hit = list.find((button) => button.id === id);
    if (hit && !first.includes(hit)) first.push(hit);
  }
  const rest = list.filter((button) => !first.includes(button)).sort(byLabel);
  return [...first, ...rest];
}

function byLabel(a, b) {
  const x = a.label.toLowerCase();
  const y = b.label.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
