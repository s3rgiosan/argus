// The popups of the space groups in Argus's sidebar copy (`argus-spaces`). One
// mod with three views, picked by `props().view`: the group menu, the Add
// spaces checklist and the group name field.

import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, theme, shared, setShared, props, openOverlay, closeOverlay, checking, readTextFile, appHome } from "herdr";
import {
  GROUP_POPUP,
  KEY,
  LIST_MAX,
  NAME_HEIGHT,
  WIDE_WIDTH,
  addGroup,
  checkName,
  deleteGroup,
  groupMenu,
  groupOf,
  moveGroup,
  newGroupId,
  pruneSpaces,
  readStore,
  renameGroup,
  setMember,
} from "./space-groups.js";
import { errorLine, field, menuPopup, menuRow } from "./ui.js";
import { menuHeight, menuKey } from "./menu.js";
import { createInputs } from "./pane.js";
import { iconResolver, probeIcons } from "./icons.js";

const store = () => readStore(shared(KEY));

/** Saves `next` with the members of closed spaces dropped. One write. */
function save(next) {
  setShared(KEY, pruneSpaces(next, new Set(spaces().map((space) => space.id))));
}

/** Closes this popup and opens `view` of this mod with `extra` props. */
function switchTo(p, view, extra, width, height) {
  if (p.overlay) closeOverlay(p.overlay);
  openOverlay({ mod: GROUP_POPUP, kind: "popup", width, height, props: { view, ...extra } });
}

export default class SpaceGroups extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.view = p.view ?? "group";
    this.found = new Set();
    // The highlighted row of a menu; null until a key moves it.
    this.at = null;
    this.error = null;
    this.focused = null;
    this.handle = cx.focus_handle();
    if (this.view === "name") {
      const group = store().groups.find((item) => item.id === p.group);
      this.renaming = group?.id ?? null;
      this.nameInput = createInputs(this)("name", { value: group?.name ?? "", placeholder: "Group name" }, (cx) => this.saveName(cx));
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    // The field or the menu takes the keyboard once the frame that draws it is up.
    cx.timer.after(0, () => (this.view === "name" ? this.nameInput.focus() : this.handle.focus()));
  }

  /** The path to load for icon `name`: Herdr's file when it has one, else this mod's copy. */
  icon(name) {
    return iconResolver(GROUP_POPUP, this.found)(name);
  }

  render() {
    const t = theme();
    switch (this.view) {
      case "add":
        return this.renderAdd(t);
      case "name":
        return this.renderName(t);
      default:
        return this.renderGroup(t);
    }
  }

  /** The group menu: Add spaces…, Rename, Move up, Move down and Delete group. */
  renderGroup(t) {
    const p = props() ?? {};
    const items = groupMenu(store(), p.group);
    const active = this.at ?? 0;
    const parts = items.length
      ? items.map((item, index) => menuRow(t, `group-${item.id}`, { label: item.label, active: index === active, tick: this.icon("check"), onClick: () => this.pick(p, item.id) }))
      : [menuRow(t, "group-gone", { label: "This group was deleted.", enabled: false, tick: this.icon("check"), onClick: () => {} })];
    return menuPopup(t, {
      id: "argus-space-groups-group",
      listId: "argus-space-groups-group-list",
      handle: this.handle,
      height: menuHeight(Math.max(items.length, 1)),
      parts,
      onKey: (e, cx) => {
        const next = menuKey(active, e.key, items.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") this.pick(p, items[next.at].id);
        else if (next.action === "close" && p.overlay) closeOverlay(p.overlay);
        cx.notify();
      },
    });
  }

  /** Runs a group menu row. */
  pick(p, id) {
    const current = store();
    switch (id) {
      case "add": {
        const rows = Array.isArray(p.rows) ? p.rows : [];
        switchTo(p, "add", { group: p.group, rows }, WIDE_WIDTH, menuHeight(Math.max(rows.length, 1), 0, { max: LIST_MAX }));
        return;
      }
      case "rename":
        switchTo(p, "name", { group: p.group }, WIDE_WIDTH, NAME_HEIGHT);
        return;
      case "up":
        save(moveGroup(current, p.group, -1));
        break;
      case "down":
        save(moveGroup(current, p.group, 1));
        break;
      case "delete":
        save(deleteGroup(current, p.group));
        break;
      default:
        return;
    }
    if (p.overlay) closeOverlay(p.overlay);
  }

  /** Add spaces: one row per repo or space; a click puts it in this group or takes it out. */
  renderAdd(t) {
    const p = props() ?? {};
    const current = store();
    const rows = (Array.isArray(p.rows) ? p.rows : []).filter((row) => typeof row?.key === "string" && typeof row?.name === "string");
    const names = new Map(current.groups.map((group) => [group.id, group.name]));
    const active = this.at ?? 0;
    const toggle = (row) => {
      const latest = store();
      save(setMember(latest, row.key, groupOf(latest, row.key) === p.group ? null : p.group));
    };
    const parts = rows.length
      ? rows.map((row, index) => {
          const group = groupOf(current, row.key);
          return menuRow(t, `add-${index}`, {
            label: row.name,
            count: group !== null && group !== p.group ? (names.get(group) ?? null) : null,
            current: group === p.group,
            active: index === active,
            tick: this.icon("check"),
            onClick: () => toggle(row),
          });
        })
      : [menuRow(t, "add-none", { label: "No open spaces", enabled: false, tick: this.icon("check"), onClick: () => {} })];
    return menuPopup(t, {
      id: "argus-space-groups-add",
      listId: "argus-space-groups-add-list",
      handle: this.handle,
      height: menuHeight(Math.max(rows.length, 1), 0, { max: LIST_MAX }),
      parts,
      onKey: (e, cx) => {
        const next = menuKey(active, e.key, rows.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") toggle(rows[next.at]);
        else if (next.action === "close" && p.overlay) closeOverlay(p.overlay);
        cx.notify();
      },
    });
  }

  /** The name field of a new group, or of the group that is renamed. */
  renderName(t) {
    return v_flex()
      .id("argus-space-groups-name")
      .size_full()
      .p(8)
      .gap(4)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(field(t, "name", this.nameInput, this.focused === "name"))
      .when(this.error !== null, (el) => el.child(errorLine(t, this.error)));
  }

  /** Saves the name, or shows why it is refused. */
  saveName(cx) {
    const p = props() ?? {};
    const current = store();
    const name = this.nameInput.value();
    const error = checkName(current, name, this.renaming ?? undefined);
    if (error !== null) {
      this.error = error;
      cx.notify();
      return;
    }
    save(this.renaming === null ? addGroup(current, name, newGroupId(Date.now(), Math.random)) : renameGroup(current, this.renaming, name));
    if (p.overlay) closeOverlay(p.overlay);
  }
}
