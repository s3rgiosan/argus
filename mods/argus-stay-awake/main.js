// A coffee-cup button that keeps the display awake. A left click toggles it;
// a right click keeps it awake until no agent is working. While on, it runs
// a short `caffeinate` again every minute, so the Mac can sleep within two
// minutes after Herdr quits.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, agents, checking, notify, theme } from "herdr";
import { anyWorking, leftClick, rightClick, tick, caffeinateArgs, shouldRun, TICK_MS, EXEC_TIMEOUT_MS } from "./stay-awake.js";

const TOOLTIP = "Keep the display awake · Right-click: until agents finish";
const ICON = "mods/argus-stay-awake/icons/coffee.svg";
const NEEDS_CAFFEINATE = "Keep awake needs caffeinate (macOS)";

export default class StayAwake extends View {
  init() {
    this.mode = "off";
    this.timer = null;
    this.runs = 0;
    this.warned = false;
  }

  /** Stops the timer. A `caffeinate` already running ends within 120 s. */
  close() {
    this.timer?.cancel();
    this.timer = null;
  }

  render() {
    const t = theme();
    const on = this.mode !== "off";

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
          .id("stay-awake")
          .relative()
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .rounded(6)
          .bg(t.chrome)
          .text_color(on ? t.accent : t.muted)
          .hover((s) => s.bg(t.hover))
          .tooltip(TOOLTIP)
          .on_mouse_down("left", (_e, cx) => this.apply(leftClick(this.mode), cx))
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            const result = rightClick(this.mode, anyWorking(agents()));
            if (result.toast) notify({ title: result.toast, level: "info" });
            this.apply(result.mode, cx);
          })
          .child(svg(ICON).size(14))
          .when(this.mode === "agents", (el) =>
            el.child(div().absolute().top(5).right(5).size(5).rounded_full().bg(t.accent)),
          ),
      );
  }

  /** Sets the mode, starts or stops the timer, and keeps the display awake at once when on. */
  apply(mode, cx) {
    this.mode = mode;
    if (mode === "off") {
      this.close();
      this.warned = false;
    } else if (!this.timer) {
      this.timer = cx.timer.every(TICK_MS, (cx) => this.onTick(cx));
      this.keepAwake(cx);
    }
    cx.notify();
  }

  onTick(cx) {
    const result = tick(this.mode, anyWorking(agents()));
    if (result.toast) notify({ title: result.toast, level: "info" });
    if (result.mode !== this.mode) this.apply(result.mode, cx);
    if (result.keepAwake) this.keepAwake(cx);
  }

  /**
   * Starts one `caffeinate`. When it cannot start, one toast says so for each
   * time the mode turns on, and the next tick tries again.
   */
  keepAwake(cx) {
    if (checking() || !shouldRun(true, this.runs)) return;
    this.runs += 1;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        await exec("caffeinate", caffeinateArgs(), { timeout: EXEC_TIMEOUT_MS });
      } catch {
        if (!this.warned) notify({ title: NEEDS_CAFFEINATE, level: "warning" });
        this.warned = true;
      } finally {
        this.runs -= 1;
      }
    });
  }
}
