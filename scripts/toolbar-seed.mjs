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
 * The toolbar's estimated width in px: 10 px of padding, then per button its
 * padding, the icon (when the panel has one and the mode is not labels) and
 * about 7 px per label character (labels and both modes), and a 3 px gap
 * between two buttons. A button without an icon shows its label in every mode.
 *
 * @param {{ label: string, icon?: string | null }[]} panels
 * @param {string} display "icons", "labels" or "both"; anything else counts as "both".
 */
export function toolbarWidthFor(panels, display) {
  const mode = DISPLAYS.includes(display) ? display : "both";
  const buttons = panels.reduce((sum, panel) => {
    const withIcon = Boolean(panel.icon) && mode !== "labels";
    const withLabel = mode !== "icons" || !panel.icon;
    return sum + BUTTON_PAD + (withIcon ? ICON_SLOT : 0) + (withLabel ? CHAR * panel.label.length : 0);
  }, 0);
  return BAR_PAD + buttons + GAP * Math.max(0, panels.length - 1);
}
