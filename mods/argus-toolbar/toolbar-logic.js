// What the toolbar shows as open and what a click does. No Herdr imports, so
// Node can test it.

import { ORDER_ERROR, DISPLAY_ERROR } from "./argus-file.js";

/** How long to wait for a burst of changes to end before reading the file. */
export const SETTLE_MS = 300;
/** How long to wait between reads when the folder watch is not available. */
export const POLL_MS = 5000;
/** The toolbar's padding to the right of its buttons. */
const BAR_PAD = 10;

/**
 * Whether `target` is the panel shown now.
 *
 * @param {object} tree The shown layout, from `layout()`.
 * @param {{ panel: string, stack: string }} ids The panel column and its stack.
 * @param {string} target A child id of the stack.
 */
export function isOpen(tree, ids, target) {
  const panel = find(tree, ids.panel);
  const stack = find(tree, ids.stack);
  return Boolean(panel) && !panel.hidden && stack?.active === target;
}

/**
 * The app commands for a click on `target`'s button: hide the panel when it
 * is the one shown, else show it with `target` selected.
 *
 * @param {object} tree
 * @param {{ panel: string, stack: string }} ids
 * @param {string} target
 * @returns {[string, Record<string, unknown>][]}
 */
export function clickCommands(tree, ids, target) {
  if (isOpen(tree, ids, target)) return [["layout.hide", { id: ids.panel }]];
  return [
    ["layout.select", { stack: ids.stack, child: target }],
    ["layout.show", { id: ids.panel }],
  ];
}

/**
 * Whether a batch from `watchFolder` calls for reading `file` in `dir`: it
 * names the file or the folder itself, or it is empty (the watch was given up).
 *
 * @param {string[]} paths
 * @param {string} dir
 * @param {string} file
 */
export function touchesFile(paths, dir, file) {
  if (paths.length === 0) return true;
  const root = dir.replace(/\/+$/, "");
  return paths.some((path) => {
    const clean = path.replace(/\/+$/, "");
    return clean === root || clean === `${root}/${file}`;
  });
}

/**
 * How long to wait after a batch from `watchFolder` before the next watch
 * starts: a burst of changes to `file` settles first, an empty batch (the
 * watch was given up) waits for the poll, and a batch about other files does
 * not wait. The file is read when each new watch starts, so a save made during
 * the wait is never missed.
 *
 * @param {string[]} paths
 * @param {string} dir
 * @param {string} file
 * @returns {number} Milliseconds.
 */
export function waitAfter(paths, dir, file) {
  if (paths.length === 0) return POLL_MS;
  return touchesFile(paths, dir, file) ? SETTLE_MS : 0;
}

/**
 * The toast for a settings `error` from `toolbarSettings`. An invalid
 * `order` or `display` alone leaves the other setting as written; any other
 * error means the whole file uses the defaults.
 *
 * @param {string} error
 * @returns {{ title: string, body: string, level: "warning" }}
 */
export function badFileToast(error) {
  const partial = error === ORDER_ERROR || error === DISPLAY_ERROR;
  return {
    title: partial ? "argus.json has invalid settings; using defaults for them" : "argus.json could not be read; using the default settings",
    body: error,
    level: "warning",
  };
}


function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The width to resize the toolbar block to for a measured button row, or null
 * when the live layout has no such block, the measure is not a positive
 * number, or the block already has that width.
 *
 * @param {unknown} tree The shown layout, from `layout()`.
 * @param {string} id The toolbar block's id.
 * @param {unknown} measured The rendered button row's width in px.
 * @returns {number | null}
 */
export function measuredResize(tree, id, measured) {
  if (typeof measured !== "number" || !Number.isFinite(measured) || measured <= 0) return null;
  const node = find(tree, id);
  if (!node) return null;
  const px = Math.ceil(measured) + BAR_PAD;
  return node.size?.px === px ? null : px;
}
