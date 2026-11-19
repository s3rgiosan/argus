// Argus settings: a popup that sets the order of the toolbar's panel
// buttons. Opened from the toolbar's right-click menu, which is the "menu"
// view of this same mod. Save stores the order of panel ids in the shared key
// the toolbar reads.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, layout, shared, setShared, openOverlay, closeOverlay } from "herdr";
import { sortButtons, moveUp, moveDown, canMoveUp, canMoveDown } from "./order.js";
import { toolbarButtons, settingsHeight } from "./settings-logic.js";
import { frame, header, row, footer, sectionTitle, button } from "./ui.js";

const MOD = "argus-settings";
const ORDER_KEY = "argus-toolbar.order";
const WIDTH = 360;
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

export default class ArgusSettings extends View {
  init() {
    this.draft = null;
  }

  render() {
    const t = theme();
    return props()?.view === "menu" ? this.renderMenu(t) : this.renderSettings(t);
  }

  /** The one-item menu a right click on a toolbar button opens. */
  renderMenu(t) {
    return v_flex()
      .id("argus-settings-menu")
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(
        h_flex()
          .id("argus-settings-open")
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => openSettings())
          .child(svg(ICON("settings")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child("Argus Settings…")),
      );
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
      .child(v_flex().flex_1().min_h(0).px(6).child(sectionTitle(t, "TOOLBAR")).children(rows))
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

/** Closes the menu and opens the settings popup. */
function openSettings() {
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
  openOverlay({ mod: MOD, props: { view: "settings" }, kind: "popup", width: WIDTH, height: settingsHeight(toolbarButtons(layout()).length) });
}

function close() {
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
}

