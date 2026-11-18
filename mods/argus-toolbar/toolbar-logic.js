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

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}
