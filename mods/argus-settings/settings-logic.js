// What the Argus settings popup reads from the layout. No Herdr imports, so
// Node can test it.

const TOOLBAR_ID = "argus-toolbar";

/**
 * The panel buttons the toolbar block was given in the layout.
 *
 * @param {object | null} tree The shown layout, from `layout()`.
 * @returns {{ id: string, label: string, icon: string | null }[]}
 */
export function toolbarButtons(tree) {
  const block = find(tree, TOOLBAR_ID);
  const buttons = block?.content?.props?.buttons;
  return Array.isArray(buttons) ? buttons : [];
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
