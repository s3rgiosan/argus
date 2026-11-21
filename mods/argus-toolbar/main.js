// Buttons beside Herdr's tab bar that open this repo's panel mods in the
// argus layout's panel column, drawn like Herdr's Files and Changes
// buttons. The layout passes the buttons and the column in props(). The
// buttons follow the order and show as icons, labels or both as set in
// `argus.json` in Herdr's app folder.

import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, layout, run, appHome, readTextFile, watchFolder, notify, checking } from "herdr";
import { isOpen, clickCommands, toolbarSettings, waitAfter, badFileToast, measuredResize, touchesFile, POLL_MS } from "./toolbar-logic.js";
import { sortButtons } from "./order.js";

const FILE = "argus.json";
const UNREADABLE = { title: "argus.json could not be read; using the default settings", body: "The file is too large or is not a file.", level: "warning" };
const TOOLBAR_ID = "argus-toolbar";

export default class Toolbar extends View {
  init(_props, cx) {
    this.order = null;
    this.display = "both";
    this.text = undefined;
    this.warned = undefined;
    this.failed = false;
    if (checking()) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      await this.follow(cx);
    });
  }

  /**
   * Reads `argus.json` each time a new watch starts, which follows every
   * batch of changes after a wait, so a save made during the wait is never
   * missed. A watch ends with its first batch, so each batch needs a new
   * watch. A batch about other files starts the next watch at once and does
   * not read the file.
   */
  async follow(cx) {
    await cx.sleep(0);
    const dir = appHome();
    let reload = true;
    for (;;) {
      let watch = null;
      try {
        watch = watchFolder(dir);
      } catch {
        watch = null;
      }
      if (reload) await this.load(dir, cx);
      let wait = POLL_MS;
      reload = true;
      try {
        if (!watch) throw new Error("no watch");
        const paths = await watch;
        wait = waitAfter(paths, dir, FILE);
        reload = touchesFile(paths, dir, FILE);
      } catch {
        wait = POLL_MS;
      }
      await cx.sleep(wait);
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
        notify(UNREADABLE);
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
      notify(badFileToast(error));
    }
    cx.notify();
  }

  /** Resizes the toolbar block to the measured button row when its live width differs. */
  fit(width) {
    const px = measuredResize(layout(), TOOLBAR_ID, width);
    if (px !== null) run("layout.resize", { id: TOOLBAR_ID, px });
  }

  render() {
    const t = theme();
    const { panel, stack, buttons } = props() ?? {};
    const ids = { panel, stack };
    const tree = layout();
    const display = this.display;
    const stop = (_e, cx) => cx.stop_propagation();

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
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop)
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
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("toolbar-buttons")
          .flex_none()
          .gap(3)
          .items_center()
          .on_size_change((size) => this.fit(size.width))
          .children(sortButtons(buttons, this.order).map(button)),
      );
  }
}
