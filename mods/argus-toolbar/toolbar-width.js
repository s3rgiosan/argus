// The toolbar block's width in px for its buttons and display mode. No Herdr
// imports, so Node and the layout script can use it.

/** The ways a button shows: icon only, label only, or both. */
export const DISPLAYS = ["icons", "labels", "both"];
/** The width of the toolbar's own padding. */
const BAR_PAD = 10;
/** A button's side padding. */
const BUTTON_PAD = 16;
/** The icon and its gap to the label. */
const ICON_SLOT = 16;
/** The width of one label character. */
const CHAR = 7;
/** The gap between two buttons. */
const GAP = 3;

/**
 * The toolbar's width in px: 10 px of padding, then per button its padding,
 * the icon (icons and both modes), about 7 px per label character (labels
 * and both modes) and a 3 px gap. A button without an icon shows its label
 * in every mode.
 *
 * @param {{ label: string, icon?: string | null }[]} panels
 * @param {string} display "icons", "labels" or "both"; anything else counts as "both".
 */
export function toolbarWidthFor(panels, display) {
  const mode = DISPLAYS.includes(display) ? display : "both";
  return (
    BAR_PAD +
    panels.reduce((sum, panel) => {
      const withIcon = mode === "both" || (mode === "icons" && Boolean(panel.icon));
      const withLabel = mode !== "icons" || !panel.icon;
      return sum + BUTTON_PAD + (withIcon ? ICON_SLOT : 0) + (withLabel ? CHAR * panel.label.length : 0) + GAP;
    }, 0)
  );
}

/**
 * The toolbar's width for buttons that show icon and label.
 *
 * @param {{ label: string }[]} panels
 */
export function toolbarWidth(panels) {
  return toolbarWidthFor(panels, "both");
}

/**
 * The width to resize the toolbar block to, or null when the live layout has
 * no such block or the block already has that width.
 *
 * @param {unknown} tree The shown layout, from `layout()`.
 * @param {string} id The toolbar block's id.
 * @param {{ label: string, icon?: string | null }[]} panels
 * @param {string} display
 * @returns {number | null}
 */
export function toolbarResize(tree, id, panels, display) {
  const node = find(tree, id);
  if (!node) return null;
  const px = toolbarWidthFor(panels, display);
  return node.size?.px === px ? null : px;
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
