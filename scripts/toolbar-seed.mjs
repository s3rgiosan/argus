// The toolbar block's first width in px, estimated for the layout file. The
// toolbar mod measures its buttons once it shows and resizes the block to
// that width, so the estimate only has to be close.

import { DISPLAYS } from "../mods/argus-toolbar/toolbar-logic.js";

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
 * The toolbar's estimated width in px: 10 px of padding, then per button its padding,
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
