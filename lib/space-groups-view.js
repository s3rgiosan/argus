// The space groups of Argus's sidebar copy (`argus-spaces`): group headers that
// fold and take drops, the group order of the spaces, and the buttons that open
// the group popups of `argus-space-groups`. The copy's hooks call these
// functions with the sidebar instance as `view`.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, spaces, openOverlay } from "herdr";
import {
  FOLDED_KEY,
  GROUP_POPUP,
  KEY,
  MENU_WIDTH,
  NAME_HEIGHT,
  NO_GROUP,
  WIDE_WIDTH,
  checklist,
  createGuard,
  groupMenu,
  groupOf,
  guardPaused,
  guardStamp,
  memberKey,
  pruneSpaces,
  readStore,
  sections,
  setMember,
  sortRows,
  stickyKey,
} from "./space-groups.js";
import { menuHeight } from "./menu.js";
import { iconButton } from "./ui.js";

const ELLIPSIS = "mods/argus-spaces/icons/ellipsis.svg";
const FOLDER_PLUS = "mods/workspace-chrome/folder-plus.svg";
const chevron = (folded) => `mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`;
// The fold id of the section for spaces without a group.
const NONE = "none";
const machineOf = (space) => space.machine ?? null;

/**
 * Sets up the group state of a sidebar instance. Call it from `init`.
 *
 * @param {object} view The sidebar instance.
 */
export function argusInit(view) {
  let folded = [];
  try {
    const stored = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
    if (Array.isArray(stored)) folded = stored.filter((id) => typeof id === "string");
  } catch {
    folded = [];
  }
  view.argusFolded = new Set(folded);
  view.argusGuard = createGuard();
  view.argusKeys = new Map();
  // Each space's last repo key, kept while git for a new folder is read.
  view.argusLast = new Map();
  view.argusRows = [];
  view.argusOver = null;
  view.argusHover = null;
}

/**
 * The sidebar rows in group order. It also keeps each space's membership key
 * and the Add spaces rows on `view`. A machine whose order two apps fight over
 * keeps Herdr's order (`guardPaused`).
 *
 * @param {object} view
 * @param {object[]} out The shipped sidebar's rows, each worktree after its main checkout.
 * @param {object[]} sp `spaces()`, in Herdr's order.
 * @param {(space: object) => object | null | undefined} gitOf The sidebar's git info of a space: undefined while unknown.
 * @returns {object[]}
 */
export function argusSort(view, out, sp, gitOf) {
  const store = readStore(shared(KEY));
  // A hot reload keeps the instance without a new `argusInit`, so the map can be missing.
  const last = view.argusLast ?? new Map();
  const keys = new Map(out.map((row) => [row.w.id, stickyKey(row.w, gitOf(row.w), last.get(row.w.id))]));
  const keyOf = (row) => keys.get(row.w.id);
  view.argusKeys = keys;
  view.argusLast = new Map([...keys].filter(([, key]) => !key.startsWith('["space",')));
  const machineOfKey = new Map();
  for (const row of out) if (!machineOfKey.has(keyOf(row))) machineOfKey.set(keyOf(row), machineOf(row.w));
  // A row is named after the first space of its repo, as the sidebar shows it; repo folder names can repeat.
  view.argusRows = checklist(out, keyOf, (row) => row.w.name).map((entry) => ({ ...entry, machine: machineOfKey.get(entry.key) }));
  if (store.groups.length === 0) return out;
  const sorted = sortRows(out, store, keyOf);
  const now = Date.now();
  const result = [];
  for (const machine of [...new Set(out.map((row) => machineOf(row.w)))]) {
    const given = out.filter((row) => machineOf(row.w) === machine);
    const grouped = sorted.filter((row) => machineOf(row.w) === machine);
    const herdr = sp.filter((space) => machineOf(space) === machine).map((space) => space.id);
    const settled = herdr.length === grouped.length && grouped.every((row, i) => row.w.id === herdr[i]);
    const stamp = guardStamp(store, given, keyOf);
    const paused = guardPaused(view.argusGuard, { machine, stamp, settled, now });
    result.push(...(paused ? given : grouped));
  }
  return result;
}

/**
 * The list children of one machine's rows: a header per group, its rows, and
 * the No group section. Narrow, a divider sits between groups instead of headers.
 *
 * @param {object} view
 * @param {object[]} rows The rows of one machine, in order.
 * @param {(row: object) => object} draw Draws one row.
 * @param {object} t `theme()`.
 * @param {boolean} collapsed True for the narrow rail.
 * @param {string | null} machine The machine of the rows; null is this computer.
 * @returns {{ items: object[], active: number }} `active` is the index of the active space's row in `items`, or -1.
 */
export function argusSections(view, rows, draw, t, collapsed, machine) {
  if (view.pressed === null) view.argusOver = null;
  const store = readStore(shared(KEY));
  const keyOf = (row) => view.argusKeys.get(row.w.id) ?? memberKey(row.w, row.g);
  const list = sections(rows, store, keyOf, { local: machine === null });
  const items = [];
  let active = -1;
  const push = (row) => {
    if (row.w.active) active = items.length;
    items.push(draw(row));
  };
  if (list.length === 1 && !list[0].header) {
    rows.forEach(push);
    return { items, active };
  }
  if (collapsed) {
    list.filter((section) => section.rows.length > 0).forEach((section, n) => {
      if (n > 0) items.push(divider(t, `argus-divider-${machine ?? "local"}-${n}`));
      section.rows.forEach(push);
    });
    return { items, active };
  }
  for (const section of list) {
    const id = section.group?.id ?? NONE;
    const folded = view.argusFolded.has(id);
    items.push(header(view, t, section.group, store, machine, folded));
    if (folded) continue;
    if (section.group && section.rows.length === 0) {
      items.push(h_flex().id(`argus-group-empty-${machine ?? "local"}-${id}`).h(28).flex_none().px(8).items_center().text_size(12).text_color(t.dim).child("No spaces"));
    }
    section.rows.forEach(push);
  }
  return { items, active };
}

/**
 * Puts the dragged space's repo in the group of the row it was dropped on.
 * Call it before the shipped drop moves the space.
 *
 * @param {object} view
 * @param {string | null} fromId The dragged space.
 * @param {{ id: string }} target The space it was dropped on.
 */
export function argusDropOnRow(view, fromId, target) {
  if (fromId === null || fromId === target.id) return;
  const targetKey = view.argusKeys.get(target.id);
  if (targetKey === undefined) return;
  const store = readStore(shared(KEY));
  assign(view, fromId, groupOf(store, targetKey));
}

/**
 * The New group button of the sidebar's title row.
 *
 * @param {object} view
 * @param {object} t
 * @returns {object}
 */
export function argusNewGroupButton(view, t) {
  // The title row spreads its children apart; the auto margin keeps this button next to Herdr's "+".
  return iconButton(t, "argus-group-new", FOLDER_PLUS, openNamePopup, { tooltip: "New group" }).ml_auto();
}

/** Puts the repo of space `spaceId` in group `groupId`, or in no group for null. One write. */
function assign(view, spaceId, groupId) {
  const key = view.argusKeys.get(spaceId);
  if (key === undefined) return;
  const store = readStore(shared(KEY));
  if (groupOf(store, key) === groupId) return;
  setShared(KEY, pruneSpaces(setMember(store, key, groupId), new Set(spaces().map((space) => space.id))));
}

/** A section header: the name, the options button on hover and the fold chevron. A drop on it sets the group. */
function header(view, t, group, store, machine, folded) {
  const id = group?.id ?? NONE;
  const elId = `argus-group-${machine ?? "local"}-${id}`;
  const over = view.argusOver === elId;
  const hovered = view.argusHover === elId;
  const options = (_e, cx) => {
    cx.stop_propagation();
    openGroupMenu(view, store, group, machine);
  };
  return h_flex()
    .id(elId)
    .h(26)
    .flex_none()
    .px(8)
    .gap(7)
    .items_center()
    .rounded(6)
    .text_size(11)
    .text_color(t.dim)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .when(over, (el) => el.bg(t.hover))
    .on_hover((on, cx) => {
      if (on) view.argusHover = elId;
      else if (view.argusHover === elId) view.argusHover = null;
      cx.notify();
    })
    .on_click((_e, cx) => {
      if (folded) view.argusFolded.delete(id);
      else view.argusFolded.add(id);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...view.argusFolded]));
      } catch {
        // The fold still works for this run.
      }
      cx.notify();
    })
    .when(Boolean(group), (el) => el.on_mouse_down("right", options))
    .on_mouse_move((_e, cx) => {
      if (view.pressed === null) return;
      const source = spaces().find((space) => space.id === view.pressed);
      const next = source && machineOf(source) === machine ? elId : null;
      if (view.argusOver === next) return;
      view.argusOver = next;
      view.over = null;
      cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => {
      if (view.pressed !== null && view.argusOver === elId) assign(view, view.pressed, group?.id ?? null);
      view.pressed = null;
      view.over = null;
      view.argusOver = null;
      cx.notify();
    })
    .child(div().flex_1().min_w(0).truncate().child(group?.name ?? NO_GROUP))
    .when(hovered && Boolean(group), (el) =>
      el.child(
        div()
          .id(`${elId}-options`)
          .flex_none()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(iconButton(t, `${elId}-options-button`, ELLIPSIS, options, { tooltip: "Group options" })),
      ),
    )
    .child(svg(chevron(folded)).size(11).flex_none());
}

/** A 1 px line between groups in the narrow rail. */
function divider(t, id) {
  return h_flex().id(id).h(9).flex_none().items_center().justify_center().child(div().w(20).h(1).bg(t.border));
}

/** Opens the popup of `group`, with the Add spaces rows of `machine`. */
function openGroupMenu(view, store, group, machine) {
  if (!group) return;
  const rows = view.argusRows.filter((row) => row.machine === machine).map(({ key, name }) => ({ key, name }));
  const height = menuHeight(groupMenu(store, group.id).length);
  openOverlay({ mod: GROUP_POPUP, kind: "popup", width: MENU_WIDTH, height, props: { view: "group", group: group.id, rows } });
}

/** Opens the name dialog for a new group. A pointer popup closes when its text field takes focus, so it is a dialog. */
function openNamePopup() {
  openOverlay({ mod: GROUP_POPUP, kind: "dialog", width: WIDE_WIDTH, height: NAME_HEIGHT, props: { view: "name" } });
}
