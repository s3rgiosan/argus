// Copied from lib/order.js by scripts/sync-lib.mjs: edit lib/order.js, then run it.
//
// The order of the toolbar's panel buttons: sorting by a stored order and
// moving one entry up or down. No Herdr imports, so Node can test it.

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

/** A copy of `list` with the entry at `index` one place earlier; unchanged at the start. */
export function moveUp(list, index) {
  return swap(list, index, index - 1);
}

/** A copy of `list` with the entry at `index` one place later; unchanged at the end. */
export function moveDown(list, index) {
  return swap(list, index, index + 1);
}

/** Whether the entry at `index` can move up. */
export function canMoveUp(index) {
  return index > 0;
}

/** Whether the entry at `index` of `list` can move down. */
export function canMoveDown(list, index) {
  return index >= 0 && index < list.length - 1;
}

function swap(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

function byLabel(a, b) {
  const x = a.label.toLowerCase();
  const y = b.label.toLowerCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
