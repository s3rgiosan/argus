// Buttons beside Herdr's tab bar that open this repo's panel mods in the
// argus layout's panel column, drawn like Herdr's Files and Changes
// buttons. The layout passes the buttons and the column in props(); the
// buttons follow the order saved in `argus-toolbar.order`, and a right click
// opens the Argus settings menu.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, layout, run, shared, openOverlay } from "herdr";
import { isOpen, clickCommands } from "./toolbar-logic.js";
import { sortButtons } from "./order.js";

const ORDER_KEY = "argus-toolbar.order";
const MENU_WIDTH = 200;
const MENU_HEIGHT = 42;

export default class Toolbar extends View {
  render() {
    const t = theme();
    const { panel, stack, buttons } = props() ?? {};
    const ids = { panel, stack };
    const tree = layout();

    const button = ({ id, label, icon }) => {
      const on = isOpen(tree, ids, id);
      return h_flex()
        .id(`panel-${id}`)
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click(() => {
          for (const [name, args] of clickCommands(layout(), ids, id)) run(name, args);
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "argus-settings", props: { view: "menu" }, kind: "popup", width: MENU_WIDTH, height: MENU_HEIGHT });
        })
        .when(Boolean(icon), (el) => el.child(svg(icon).size(14)))
        .child(label);
    };

    return h_flex()
      .size_full()
      .min_w(0)
      .pr(10)
      .gap(3)
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .children(sortButtons(buttons, shared(ORDER_KEY)).map(button));
  }
}
