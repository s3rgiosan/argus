// Copied from lib/ui.js by scripts/sync-lib.mjs: edit lib/ui.js, then run it.
//
// Shared building blocks for this repo's panels: frame, header, icon
// buttons, rows, menu rows, scroll areas, fields, buttons, switches,
// segmented controls and meters, in the sizes and radii of Herdr's own
// panels. Colors come from `theme()` only.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, Scrollbar } from "gpui-base";

/** One turn of a busy icon, in ms, as Herdr's spinner. */
const SPIN_MS = 900;

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

/**
 * A 42 px header with a semibold title, an optional count `badge` right after
 * it and, on the right, `actions`.
 */
export function header(t, title, actions = [], { badge = null } = {}) {
  return h_flex()
    .h(42)
    .flex_none()
    .px(14)
    .gap(8)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(div().min_w(0).truncate().font_semibold().when(badge !== null, (el) => el.flex_none()).child(title))
    .when(badge !== null, (el) => el.child(badge))
    .child(div().flex_1())
    .children(actions);
}

/** A settings header: a back button, then the title. */
export function subHeader(t, onBack, title, icon) {
  return h_flex()
    .h(42)
    .flex_none()
    .px(14)
    .gap(6)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .child(iconButton(t, "back", icon, onBack))
    .child(div().font_semibold().child(title));
}

/** A count pill, as in the header of Herdr's Changes panel. */
export function badge(t, text) {
  return div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(text);
}

/** A 26 px square button holding a 14 px icon; `busy` turns the icon. */
export function iconButton(t, id, icon, onClick, { busy = false } = {}) {
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
    .child(busy ? svg(icon).size(14).spin(SPIN_MS) : svg(icon).size(14));
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

/** A 32 px text field around an `InputState`, 12 px text; `focused` draws the accent border. */
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
    .child(Input.new(state).w_full().text_size(12).text_color(t.foreground));
}

/** A multi-line text box around a `TextareaState`; `focused` draws the accent border. */
export function textBox(t, id, state, focused) {
  return div()
    .id(id)
    .w_full()
    .px(10)
    .py(6)
    .rounded(8)
    .border_1()
    .border_color(focused ? t.accent : t.border)
    .cursor_text()
    .child(Textarea.new(state).w_full().text_color(t.foreground));
}

/**
 * A button: `primary` is the solid main action, 32 px high; the other is
 * Herdr's raised button with a border and a hover.
 */
export function button(t, id, label, onClick, { primary = false, enabled = true } = {}) {
  const base = div().id(id).flex().flex_none().items_center();
  if (primary) {
    return base
      .h(32)
      .px(14)
      .rounded(8)
      .text_size(12)
      .bg(enabled ? t.solid : t.raised)
      .text_color(enabled ? t.solid_foreground : t.dim)
      .when(enabled, (el) => el.cursor_pointer().on_click(onClick))
      .child(label);
  }
  return base
    .px(12)
    .py(5)
    .rounded(7)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .text_size(13)
    .text_color(enabled ? t.foreground : t.dim)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
    .child(label);
}

/** A 36 x 20 switch, as in Herdr's Settings. */
export function toggle(t, id, on, onClick) {
  return div()
    .id(id)
    .w(36)
    .h(20)
    .flex_none()
    .rounded(10)
    .p(2)
    .cursor_pointer()
    .bg(on ? t.accent : t.hover)
    .flex()
    .when(on, (el) => el.justify_end())
    .on_click(onClick)
    .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
}

/**
 * A segmented control for a few short choices, as in Herdr's Settings.
 *
 * @param {{ value: unknown, label: string }[]} options
 * @param {unknown} current The value shown as chosen.
 * @param {(value: unknown, cx: object) => void} onPick
 */
export function segmented(t, id, options, current, onPick) {
  return h_flex()
    .p(2)
    .gap(2)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .children(
      options.map((option) =>
        div()
          .id(`${id}-${option.value}`)
          .px(12)
          .py(4)
          .rounded(6)
          .text_size(13)
          .cursor_pointer()
          .when(option.value === current, (el) => el.bg(t.raised).text_color(t.foreground).border_1().border_color(t.border))
          .when(option.value !== current, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) => onPick(option.value, cx))
          .child(option.label),
      ),
    );
}

/** Padding around the rows of a menu, as in Herdr's menu. */
export const MENU_PAD = 5;
/** Height of one menu row. */
export const MENU_ROW = 31;

/**
 * A 31 px menu row with Herdr's menu metrics. `active` is the row the keys
 * moved to; `current` is the chosen one and gets an accent tick; `count`
 * shows dim on the right, then an optional `trailing` element. A row that is
 * not `enabled` shows dim and takes no clicks.
 *
 * @param {{ label: string, count?: string | null, active?: boolean, current?: boolean, enabled?: boolean, indent?: boolean, trailing?: object | null, tick: string, onClick: Function }} row
 *   `tick` is the check icon's path. `indent` moves the label in, under the row above it.
 */
export function menuRow(t, id, { label, count = null, active = false, current = false, enabled = true, indent = false, trailing = null, tick, onClick }) {
  return h_flex()
    .id(id)
    .h(MENU_ROW)
    .flex_none()
    .pl(indent ? 24 : 8)
    .pr(8)
    .gap(9)
    .items_center()
    .rounded(7)
    .text_size(12.8)
    .text_color(enabled ? t.foreground : t.dim)
    .when(active, (el) => el.bg(t.selected))
    .when(enabled, (el) => el.hover((s) => s.bg(t.hover)).cursor_pointer().on_click(onClick))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(count !== null, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(count)))
    .when(trailing !== null, (el) => el.child(trailing))
    .child(div().size(12).flex_none().when(current, (el) => el.child(svg(tick).size(12).text_color(t.accent))));
}

/** A bar along the bottom of a panel, for its actions. */
export function footer(t) {
  return h_flex().flex_none().p(10).gap(8).items_center().border_t(1).border_color(t.border);
}

/** A small heading over a group of rows, as the group headings of Herdr's Spaces and Agents lists. */
export function sectionTitle(t, text) {
  return div().px(8).pt(10).pb(4).text_size(11.5).font_medium().text_color(t.dim).child(text);
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
