// Copied from lib/ui.js by scripts/sync-lib.mjs: edit lib/ui.js, then run it.
//
// Shared building blocks for this repo's panels: frame, header, icon
// buttons, rows, menu rows, scroll areas, fields, buttons, switches,
// segmented controls and meters, in the sizes and radii of Herdr's own
// panels. Colors come from `theme()` only.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, Scrollbar, TextView } from "gpui-base";
import { MENU_PAD, MENU_ROW } from "./menu.js";

export { MENU_PAD, MENU_ROW };

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

/**
 * A 26 px square button holding a 14 px icon; `busy` turns the icon. A button
 * that is not `enabled` shows a dim icon and takes no clicks. `tooltip` names it.
 */
export function iconButton(t, id, icon, onClick, { busy = false, enabled = true, tooltip = null } = {}) {
  const glyph = busy ? svg(icon).size(14).spin(SPIN_MS) : svg(icon).size(14);
  return div()
    .id(id)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .text_color(enabled ? t.muted : t.dim)
    .when(tooltip !== null, (el) => el.tooltip(tooltip))
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
    .child(glyph);
}

/** A small tinted label, as Herdr's "Needs you" chip. */
export function chip(t, id, text, color) {
  return div().id(id).flex_none().px(6).h(18).flex().items_center().rounded(5).bg(`${color}26`).text_size(10.5).font_semibold().text_color(color).child(text);
}

/** A dropdown button: a muted label and a 12 px chevron. `chevron` is the icon's path. */
export function dropdownButton(t, id, label, chevron, onClick) {
  return h_flex()
    .id(id)
    .h(26)
    .min_w(0)
    .px(8)
    .gap(4)
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .text_size(12)
    .text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click(onClick)
    .child(div().min_w(0).truncate().child(label))
    .child(svg(chevron).size(12).flex_none());
}

/** The label of a form field: 12 px, semibold. */
export function fieldLabel(t, text) {
  return div().text_size(12).font_semibold().text_color(t.foreground).child(text);
}

/** A help line under a field or a group: 11 px, dim, wrapping. */
export function hint(t, text) {
  return div().text_size(11).text_color(t.dim).whitespace_normal().child(text);
}

/** A block-level error: 12 px, `blocked`, wrapping. */
export function errorLine(t, text) {
  return div().px(8).py(6).text_size(12).text_color(t.blocked).whitespace_normal().child(text);
}

/** A 28 px list row, on `selected` when `selected` is true. `hover: false` leaves out the hover fill. */
export function row(t, id, { selected = false, hover = true } = {}) {
  return h_flex()
    .id(id)
    .h(28)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(7)
    .when(selected, (el) => el.bg(t.selected))
    .when(hover, (el) => el.hover((s) => s.bg(t.hover)));
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

/** A multi-line text box around a `TextareaState`, 12 px text; `focused` draws the accent border. */
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
    .child(Textarea.new(state).w_full().text_size(12).text_color(t.foreground));
}

/**
 * A 32 px button: `primary` is the solid main action; the other is Herdr's
 * raised button with an `input` border and a hover.
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
    .h(32)
    .px(14)
    .rounded(8)
    .border_1()
    .border_color(t.input)
    .bg(t.raised)
    .text_size(12)
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

/**
 * A settings field for a command or a folder: a section title, a 32 px text
 * field and a help line under it.
 *
 * @param {string} id The field's id, also the `focused` id of the input.
 * @param {string} title
 * @param {object} state The field's `InputState`.
 * @param {boolean} focused
 * @param {string} help
 * @returns {object[]}
 */
export function commandField(t, id, title, state, focused, help) {
  return [sectionTitle(t, title), h_flex().px(8).py(4).child(field(t, id, state, focused)), hint(t, help).px(8)];
}

/**
 * The gh and glab command fields that every forge mod shares. The inputs have
 * the ids "gh" and "glab"; both save on Enter or when focus leaves them.
 *
 * @param {{ gh: object, glab: object }} inputs The `InputState` of each field.
 * @param {string | null} focused The id of the focused input.
 * @returns {object[]}
 */
export function forgeCommandFields(t, inputs, focused) {
  return [
    ...commandField(t, "gh", "gh command", inputs.gh, focused === "gh", "Leave empty to use gh from PATH, else its usual install folders."),
    ...commandField(t, "glab", "glab command", inputs.glab, focused === "glab", "Leave empty to use glab from PATH, else its usual install folders. Both fields save on Enter or when you leave them."),
  ];
}

/**
 * The "Refresh every" setting: a section title and a segmented control of minutes.
 *
 * @param {number[]} intervals The choices, in minutes.
 * @param {number} current
 * @param {(minutes: number, cx: object) => void} onPick
 * @returns {object[]}
 */
export function intervalPicker(t, intervals, current, onPick) {
  const options = intervals.map((minutes) => ({ value: minutes, label: `${minutes} min` }));
  return [sectionTitle(t, "Refresh every"), h_flex().px(8).py(4).child(segmented(t, "interval", options, current, onPick))];
}

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

/**
 * A popup menu: the popover background, keys through `onKey`, and a scroll of
 * `parts` with the menu padding. Give it the height from `menuHeight`.
 * `head` and `foot` stay in view above and below the scroll, so a long list in
 * `parts` scrolls and the choices around it can always be reached. With
 * `footHeight` (from `footHeight` in `lib/menu.js`), the foot scrolls on its own
 * in that height, for a foot that can be long too.
 *
 * @param {{ id: string, listId: string, handle: object, height: number, head?: object[], parts: object[], foot?: object[], footHeight?: number|null, onKey: (event: object, cx: object) => void }} menu
 *   `handle` is the view's focus handle, so the keys reach the menu.
 */
export function menuPopup(t, { id, listId, handle, height, head = [], parts, foot = [], footHeight = null, onKey }) {
  const fixed = head.length > 0 || foot.length > 0;
  const popup = v_flex()
    .id(id)
    .track_focus(handle)
    .w_full()
    .h(height)
    .bg(t.popover)
    .text_color(t.foreground)
    .text_size(12.8)
    .on_key_down(onKey);
  if (!fixed) return popup.child(scrollArea(listId, parts, { padding: MENU_PAD }));
  return popup
    .p(MENU_PAD)
    .child(v_flex().flex_none().children(head))
    .child(scrollArea(listId, parts, { padding: 0 }))
    .child(
      footHeight === null
        ? v_flex().flex_none().children(foot)
        : v_flex().flex_none().h(footHeight).child(scrollArea(`${listId}-foot`, foot, { padding: 0 })),
    );
}

/**
 * The heading of a folding section in a pane: a chevron, the label and, on
 * the right, a summary for the folded section. A click folds or opens it.
 *
 * @param {{ label: string, chevron: string, summary?: string, onToggle: (cx: object) => void }} fold
 *   `chevron` is the path of the chevron icon for the current state (down when open, right when folded).
 */
export function foldTitle(t, id, { label, chevron, summary = "", onToggle }) {
  return h_flex()
    .id(id)
    .mt(4)
    .px(14)
    .py(6)
    .gap(6)
    .items_center()
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onToggle(cx))
    .child(svg(chevron).size(12).flex_none().text_color(t.dim))
    .child(div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child(label))
    .child(div().flex_1())
    .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(summary));
}

/**
 * A 44 px board row of two lines. The first line holds `#number`, the title,
 * then `marks` and the age; the second holds the dim `detail`, then `tail`.
 *
 * @param {{ number: number, title: string, age: string, detail: string, selected?: boolean, marks?: object[], tail?: object[], onClick: Function }} item
 */
export function twoLineRow(t, id, { number, title, age, detail, selected = false, marks = [], tail = [], onClick }) {
  return v_flex()
    .id(id)
    .h(44)
    .flex_none()
    .px(8)
    .gap(2)
    .justify_center()
    .rounded(7)
    .cursor_pointer()
    .when(selected, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`#${number}`))
        .child(div().flex_1().min_w(0).truncate().child(title))
        .children(marks)
        .child(div().flex_none().text_size(11).text_color(t.dim).child(age)),
    )
    .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim).child(div().flex_1().min_w(0).truncate().child(detail)).children(tail));
}

/**
 * The top of an item pane: the provider icon and `place` (for example
 * `owner/repo · #12`), the item's place in the board's order with Previous
 * and Next buttons, the `actions`, then the title at 16 px. Add more children
 * to the result for the lines under the title.
 *
 * @param {{ provider: string, place: string, title: string, position: { index: number, total: number, prev: string | null, next: string | null } | null, noun: string, idPrefix: string, icon: (name: string) => string, onPrev: Function, onNext: Function, actions?: object[] }} head
 *   `noun` names the item in the button tooltips ("pull request", "issue"); `icon` gives an icon's path.
 */
export function paneHead(t, { provider, place, title, position, noun, idPrefix, icon, onPrev, onNext, actions = [] }) {
  return v_flex()
    .px(14)
    .pt(12)
    .gap(6)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(icon(provider === "gitlab" ? "gitlab" : "github")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(place))
        .child(div().flex_1())
        .when(position !== null, (el) =>
          el
            .child(div().flex_none().text_size(12).text_color(t.dim).child(`${position.index} of ${position.total}`))
            .child(iconButton(t, `${idPrefix}-prev`, icon("arrow-up"), (_e, cx) => onPrev(cx), { enabled: position.prev !== null, tooltip: `Previous ${noun}` }))
            .child(iconButton(t, `${idPrefix}-next`, icon("arrow-down"), (_e, cx) => onNext(cx), { enabled: position.next !== null, tooltip: `Next ${noun}` })),
        )
        .children(actions),
    )
    .child(div().text_size(16).font_semibold().whitespace_normal().child(title));
}

/** Muted text inside a pane section, with no padding of its own, so it lines up with the other rows. */
export function mutedText(t, text) {
  return div().text_color(t.muted).whitespace_normal().child(text);
}

/** Markdown from a comment or a description, as Herdr's TextView draws it. A link goes to `onLink(url, cx)`. */
export function markdown(t, id, text, onLink) {
  return div().text_color(t.foreground).child(TextView.markdown(id, text).selectable(true).on_link_click((url, cx) => onLink(url, cx)));
}

/** A display name with the login as its tooltip, so a display name cannot stand in for another login. */
export function nameLabel(id, name, login) {
  const el = div().id(id).min_w(0).truncate().child(name);
  return login !== "" ? el.tooltip(`@${login}`) : el;
}
