// Copied from lib/ui.js by scripts/sync-lib.mjs: edit lib/ui.js, then run it.
//
// Shared building blocks for this repo's panels: frame, header, icon
// buttons, rows, scroll areas, fields, buttons and meters, in the sizes and
// radii of Herdr's own panels. Colors come from `theme()` only.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Scrollbar } from "gpui-base";

/** A panel's frame: 10 px corners, the terminal background, a 1 px border. */
export function frame(t, id) {
  return v_flex()
    .id(id)
    .size_full()
    .min_h(0)
    .rounded(10)
    .overflow_hidden()
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .text_color(t.foreground)
    .text_size(13);
}

/** A 42 px header with a semibold title and, on the right, `actions`. */
export function header(t, title, actions = []) {
  return h_flex()
    .h(42)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
    .children(actions);
}

/** A 26 px square button holding a 14 px icon. */
export function iconButton(t, id, icon, onClick) {
  return div()
    .id(id)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .cursor_pointer()
    .text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(onClick)
    .child(svg(icon).size(14));
}

/** A 28 px list row, on `selected` when `selected` is true. */
export function row(t, id, { selected = false } = {}) {
  return h_flex()
    .id(id)
    .h(28)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(7)
    .when(selected, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover));
}

/** A scrolling area that fills the space left, with Herdr's scrollbar. */
export function scrollArea(id, children, { padding = 6, gap = 0 } = {}) {
  return div()
    .flex_1()
    .min_h(0)
    .relative()
    .child(
      v_flex()
        .id(id)
        .absolute()
        .inset_0()
        .overflow_y_scroll()
        .p(padding)
        .gap(gap)
        .children(children),
    )
    .child(Scrollbar.vertical(id).absolute().inset_0());
}

/** A 32 px text field around an `InputState`; `focused` draws the accent border. */
export function field(t, id, state, focused) {
  return div()
    .id(id)
    .flex_1()
    .min_w(0)
    .h(32)
    .px(10)
    .flex()
    .items_center()
    .rounded(8)
    .border_1()
    .border_color(focused ? t.accent : t.border)
    .cursor_text()
    .child(Input.new(state).w_full().text_color(t.foreground));
}

/** A 32 px button: `solid` when it is the main action, else `raised`. */
export function button(t, id, label, onClick, { primary = false, enabled = true } = {}) {
  return div()
    .id(id)
    .h(32)
    .px(14)
    .flex()
    .flex_none()
    .items_center()
    .rounded(8)
    .text_size(12)
    .bg(primary && enabled ? t.solid : t.raised)
    .text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
    .when(enabled, (el) => el.cursor_pointer().on_click(onClick))
    .child(label);
}

/** A bar along the bottom of a panel, for its actions. */
export function footer(t) {
  return h_flex().flex_none().p(10).gap(8).items_center().border_t(1).border_color(t.border);
}

/** A small heading over a group of rows. */
export function sectionTitle(t, text) {
  return div().px(8).pt(10).pb(4).text_size(11).font_semibold().text_color(t.muted).child(text);
}

/** Text for an empty or waiting state. */
export function note(t, text) {
  return div().p(8).text_color(t.dim).child(text);
}

/** A 6 px track with a fill of `percent` and an optional 1 px tick at `tick` percent. */
export function meter(t, percent, tick = null) {
  const fill = Math.min(Math.max(percent, 0), 100);
  const track = div()
    .relative()
    .h(6)
    .rounded(3)
    .bg(t.border)
    .child(div().absolute().top(0).left(0).h(6).rounded(3).bg(t.accent).w(`${fill}%`));
  if (tick === null || tick === undefined) return track;
  const at = Math.min(Math.max(tick, 0), 100);
  return track.child(div().absolute().top(-2).left(`${at}%`).w(1).h(10).bg(t.foreground));
}
