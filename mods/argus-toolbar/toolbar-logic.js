// What the toolbar shows as open and what a click does. No Herdr imports, so
// Node can test it.

import { DISPLAYS } from "./toolbar-width.js";

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
    else result.error = "toolbar.order is not a list";
  }
  if ("display" in toolbar) {
    if (DISPLAYS.includes(toolbar.display)) result.display = toolbar.display;
    else result.error ??= 'toolbar.display is not "icons", "labels" or "both"';
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
