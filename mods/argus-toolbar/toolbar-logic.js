// What the toolbar shows as open and what a click does. No Herdr imports, so
// Node can test it.

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
 * The button order in the text of `argus.json`: `{ "toolbar": { "order": [ids] } }`.
 * A missing file or a missing key gives `order: null` (the default order). Text
 * that is not JSON, or a value of the wrong type, gives an `error`.
 *
 * @param {string | null | undefined} text
 * @returns {{ order: string[] | null, error: string | null }}
 */
export function toolbarOrder(text) {
  if (text === null || text === undefined) return { order: null, error: null };
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { order: null, error: error.message };
  }
  if (!isObject(data)) return { order: null, error: "the file is not an object" };
  if (!("toolbar" in data)) return { order: null, error: null };
  if (!isObject(data.toolbar)) return { order: null, error: "toolbar is not an object" };
  if (!("order" in data.toolbar)) return { order: null, error: null };
  if (!Array.isArray(data.toolbar.order)) return { order: null, error: "toolbar.order is not a list" };
  return { order: data.toolbar.order.filter((id) => typeof id === "string" && id !== ""), error: null };
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
