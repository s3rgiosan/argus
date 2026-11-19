// Buttons beside Herdr's tab bar that open this repo's panel mods in the
// argus layout's panel column, drawn like Herdr's Files and Changes
// buttons. The layout passes the buttons and the column in props(). The
// buttons follow the order and show as icons, labels or both as set in
// `argus.json` in Herdr's app folder.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, layout, run, appHome, readTextFile, watchFolder, notify, checking } from "herdr";
import { isOpen, clickCommands, toolbarSettings, touchesFile } from "./toolbar-logic.js";
import { sortButtons } from "./order.js";
import { toolbarResize } from "./toolbar-width.js";

const FILE = "argus.json";
const BAD_FILE = "argus.json could not be read; using the default settings";
const TOOLBAR_ID = "argus-toolbar";
const POLL = 5000;
const SETTLE = 300;

export default class Toolbar extends View {
  init(_props, cx) {
    this.order = null;
    this.display = "both";
    this.text = undefined;
    this.warned = undefined;
    this.failed = false;
    if (checking()) return;
    cx.spawn(async (cx) => this.follow(cx));
  }

  /** Reads `argus.json` again whenever a change in the app folder names it. */
  async follow(cx) {
    await cx.sleep(0);
    const dir = appHome();
    let read = true;
    for (;;) {
      let watch = null;
      try {
        watch = watchFolder(dir);
      } catch {
        watch = null;
      }
      if (read) await this.load(dir, cx);
      try {
        if (!watch) throw new Error("no watch");
        const changed = await watch;
        read = touchesFile(changed, dir, FILE);
        await cx.sleep(changed.length === 0 ? POLL : SETTLE);
      } catch {
        read = true;
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
      // The file is too large or is not a file: show the default order, warn once per streak.
      if (!this.failed) {
        this.failed = true;
        this.text = undefined;
        this.order = null;
        this.display = "both";
        notify({ title: BAD_FILE, level: "warning" });
        this.fit();
        cx.notify();
      }
      return;
    }
    this.failed = false;
    if (text === this.text) return;
    this.text = text;
    const { order, display, error } = toolbarSettings(text);
    this.order = order;
    this.display = display;
    if (error === null) {
      this.warned = undefined;
    } else if (text !== this.warned) {
      this.warned = text;
      notify({ title: BAD_FILE, level: "warning" });
    }
    this.fit();
    cx.notify();
  }

  /** Resizes the toolbar block to the current display when its live width differs. */
  fit() {
    const { buttons } = props() ?? {};
    if (!Array.isArray(buttons)) return;
    const px = toolbarResize(layout(), TOOLBAR_ID, buttons, this.display);
    if (px !== null) run("layout.resize", { id: TOOLBAR_ID, px });
  }

  render() {
    const t = theme();
    const { panel, stack, buttons } = props() ?? {};
    const ids = { panel, stack };
    const tree = layout();
    const display = this.display;

    const button = ({ id, label, icon }) => {
      const on = isOpen(tree, ids, id);
      const iconOnly = display === "icons" && Boolean(icon);
      const showIcon = Boolean(icon) && display !== "labels";
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
        .when(iconOnly, (el) => el.tooltip(label))
        .when(showIcon, (el) => el.child(svg(icon).size(14)))
        .when(!iconOnly, (el) => el.child(label));
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
