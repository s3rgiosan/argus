// Buttons beside Herdr's tab bar that open this repo's panel mods in the
// argus layout's panel column, drawn like Herdr's Files and Changes
// buttons. The layout passes the buttons and the column in props(); the
// buttons follow the order in `argus.json`
// in Herdr's app folder.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, layout, run, appHome, readTextFile, watchFolder, notify, checking } from "herdr";
import { isOpen, clickCommands, toolbarOrder } from "./toolbar-logic.js";
import { sortButtons } from "./order.js";

const FILE = "argus.json";
const BAD_FILE = "argus.json could not be read; using the default order";
const POLL = 5000;
const SETTLE = 300;

export default class Toolbar extends View {
  init(_props, cx) {
    this.order = null;
    this.text = undefined;
    this.warned = undefined;
    if (checking()) return;
    cx.spawn(async (cx) => this.follow(cx));
  }

  /** Reads `argus.json` again whenever something in the app folder changes. */
  async follow(cx) {
    await cx.sleep(0);
    const dir = appHome();
    for (;;) {
      let watch = null;
      try {
        watch = watchFolder(dir);
      } catch {
        watch = null;
      }
      await this.load(dir, cx);
      try {
        if (!watch) throw new Error("no watch");
        const changed = await watch;
        await cx.sleep(changed.length === 0 ? POLL : SETTLE);
      } catch {
        await cx.sleep(POLL);
      }
    }
  }

  /** Applies the file's text when it differs from the last read; one toast per bad text. */
  async load(dir, cx) {
    let text;
    try {
      text = await readTextFile(`${dir}/${FILE}`);
    } catch {
      return;
    }
    if (text === this.text) return;
    this.text = text;
    const { order, error } = toolbarOrder(text);
    this.order = order;
    if (error !== null && text !== this.warned) {
      this.warned = text;
      notify({ title: BAD_FILE, level: "warning" });
    }
    cx.notify();
  }

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
      .children(sortButtons(buttons, this.order).map(button));
  }
}
