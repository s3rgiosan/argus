// What the toolbar shows as open and what a click does. No Herdr imports, so
// Node can test it.

/** The ways a button shows: icon only, label only, or both. */
export const DISPLAYS = ["icons", "labels", "both"];
/** Errors that leave the other setting valid. */
const ORDER_ERROR = "toolbar.order is not a list";
const DISPLAY_ERROR = 'toolbar.display is not "icons", "labels" or "both"';
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
 * The toolbar settings in the text of `argus.json`:
 * `{ "toolbar": { "order": [ids], "display": "icons" | "labels" | "both" } }`.
 * A missing, empty or blank file, or a missing key, gives the defaults
 * (`order: null`, `display: "both"`). Text that is not JSON gives the
 * defaults and an `error`. A value of the wrong type or an unknown `display`
 * gives an `error` and the default for that setting only; the other setting
 * keeps its valid value.
 *
 * @param {string | null | undefined} text
 * @returns {{ order: string[] | null, display: "icons" | "labels" | "both", error: string | null }}
 */
export function toolbarSettings(text) {
  const result = { order: null, display: "both", error: null };
  if (text === null || text === undefined || text.trim() === "") return result;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ...result, error: error.message };
  }
  if (!isObject(data)) return { ...result, error: "the file is not an object" };
  if (!("toolbar" in data)) return result;
  const toolbar = data.toolbar;
  if (!isObject(toolbar)) return { ...result, error: "toolbar is not an object" };
  if ("order" in toolbar) {
    if (Array.isArray(toolbar.order)) result.order = toolbar.order.filter((id) => typeof id === "string" && id !== "");
    else result.error = ORDER_ERROR;
  }
  if ("display" in toolbar) {
    if (DISPLAYS.includes(toolbar.display)) result.display = toolbar.display;
    else result.error ??= DISPLAY_ERROR;
  }
  return result;
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

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
