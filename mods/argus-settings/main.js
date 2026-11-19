// Argus settings: a popup that sets the order of the toolbar's panel
// buttons. Save stores the order of panel ids in the shared key the toolbar
// reads.

import { View, div, svg } from "gpui-kit";
import { theme, props, layout, shared, setShared, closeOverlay } from "herdr";
import { sortButtons, moveUp, moveDown, canMoveUp, canMoveDown } from "./order.js";
import { toolbarButtons } from "./settings-logic.js";
import { frame, header, row, footer, sectionTitle, scrollArea, button } from "./ui.js";

const MOD = "argus-settings";
const ORDER_KEY = "argus-toolbar.order";
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

export default class ArgusSettings extends View {
  init() {
    this.draft = null;
  }

  render() {
    return this.renderSettings(theme());
  }

  /** The settings popup: one row per toolbar button, with up and down buttons. */
  renderSettings(t) {
    const buttons = toolbarButtons(layout());
    if (!this.draft) this.draft = sortButtons(buttons, shared(ORDER_KEY)).map((b) => b.id);
    const byId = new Map(buttons.map((b) => [b.id, b]));
    const list = this.draft.filter((id) => byId.has(id));

    const rows = list.map((id, index) => {
      const b = byId.get(id);
      return row(t, `item-${id}`)
        .child(b.icon ? svg(b.icon).size(14).flex_none().text_color(t.muted) : div().size(14).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(b.label))
        .child(this.mover(t, `up-${id}`, "arrow-up", canMoveUp(index), (cx) => this.set(moveUp(list, index), cx)))
        .child(this.mover(t, `down-${id}`, "arrow-down", canMoveDown(list, index), (cx) => this.set(moveDown(list, index), cx)));
    });

    return frame(t, "argus-settings")
      .child(header(t, "Argus Settings"))
      .child(sectionTitle(t, "TOOLBAR"))
      .child(scrollArea("argus-settings-rows", rows, { padding: 6 }))
      .child(
        footer(t)
          .justify_end()
          .child(button(t, "cancel", "Cancel", () => close()))
          .child(
            button(t, "save", "Save", () => {
              setShared(ORDER_KEY, list);
              close();
            }, { primary: true }),
          ),
      );
  }

  /** A 26 px icon button; a disabled one is dimmed and takes no click. */
  mover(t, id, icon, enabled, onClick) {
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(enabled ? t.muted : t.dim)
      .when(enabled, (el) =>
        el
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => onClick(cx)),
      )
      .child(svg(ICON(icon)).size(14));
  }

  set(list, cx) {
    this.draft = list;
    cx.notify();
  }
}

function close() {
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
}

