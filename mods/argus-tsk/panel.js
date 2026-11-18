// Pure sizing for the expand button: reads the panel column from the live
// layout tree and picks the width a click moves it to.

/** Width the panel goes back to when no earlier width is known. */
export const DEFAULT_WIDTH = 440;
/** Max width used when the column sets none. */
const DEFAULT_MAX = 900;
/** A panel this close to its max counts as expanded. */
const EXPANDED_WITHIN = 20;

/**
 * @typedef {{px: ?number, max: number}} PanelSize `px` is null when the column has no px size.
 */

/**
 * The panel column's width and max, or null when the layout has no column
 * `panelId` or the column holds no block of `mod`.
 * @param {unknown} tree the live layout from `layout()`
 * @param {string} panelId
 * @param {string} mod
 * @returns {?PanelSize}
 */
export function panelOf(tree, panelId, mod) {
  const panel = find(tree, (node) => node.id === panelId);
  if (!panel || !find(panel, (node) => node.content?.mod === mod)) return null;
  const px = panel.size?.px;
  return {
    px: typeof px === "number" && Number.isFinite(px) ? px : null,
    max: typeof panel.max === "number" && Number.isFinite(panel.max) ? panel.max : DEFAULT_MAX,
  };
}

/**
 * True when the panel is at, or within 20 px of, its max width.
 * @param {PanelSize} size
 * @returns {boolean}
 */
export function isExpanded(size) {
  return size.px !== null && size.px >= size.max - EXPANDED_WITHIN;
}

/**
 * What a click on the expand button does. A panel that is not expanded goes
 * to its max, and its width is kept in `save` (null when unknown). An
 * expanded panel goes back to `saved`, else to 440 px.
 * @param {PanelSize} size
 * @param {unknown} saved the width kept from the last expand
 * @returns {{px: number, save: ?number}}
 */
export function expandAction(size, saved) {
  if (!isExpanded(size)) return { px: size.max, save: size.px };
  const usable = typeof saved === "number" && saved > 0 && !isExpanded({ px: saved, max: size.max });
  return { px: usable ? /** @type {number} */ (saved) : DEFAULT_WIDTH, save: null };
}

/** The first node in `tree`, depth first, that `match` accepts. */
function find(tree, match) {
  if (!tree || typeof tree !== "object") return null;
  const node = /** @type {Record<string, any>} */ (tree);
  if (match(node)) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const hit = find(child, match);
    if (hit) return hit;
  }
  return null;
}
