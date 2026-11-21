// The agents board in Herdr: the agents that wait on you, failed or finished,
// and folded lists of the working, idle and older ones, with snooze and reopen. One mod with two views, picked by `props().view`:
// the board (the layout's panel) and the snooze menu (a popup).

import { View, div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, spaces, theme, shared, setShared, props, run, openOverlay, closeOverlay, checking, readTextFile, appHome } from "herdr";
import {
  SNOOZES,
  advance,
  boardItems,
  buildSections,
  duration,
  normalizeHolds,
  normalizeTrack,
  pruneHolds,
  reopenHold,
  snoozeHold,
  snoozeUntil,
  untilLabel,
  wakeLabel,
} from "./model.js";
import { frame, header, badge, iconButton, row, scrollArea, sectionTitle, note, menuRow, menuPopup, foldTitle } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";
import { menuKey, menuHeight } from "./menu.js";

const MOD = "argus-agents";
const TRACK_KEY = "argus-agents.track";
const HOLDS_KEY = "argus-agents.holds";
// How often the tracker looks at the agents, and how often the times redraw.
const TICK = 1_000;
const CLOCK = 30_000;
// Wide enough for the longest label and its wake time on one row.
const SNOOZE_WIDTH = 250;
const SNOOZE_HEIGHT = menuHeight(SNOOZES.length);

const SECTIONS = [
  { key: "waiting", title: "Needs you", color: (t) => t.blocked },
  { key: "failed", title: "Failed", color: (t) => t.ansi1 },
  { key: "finished", title: "Finished", color: (t) => t.done },
];

// Folded at first, in this order. A row's dot uses the color of its own kind.
const FOLDS = [
  { key: "working", title: "Working" },
  { key: "idle", title: "Idle" },
  { key: "older", title: "Older" },
  { key: "snoozed", title: "Snoozed" },
];

export default class AgentsBoard extends View {
  init(_props, cx) {
    this.view = props()?.view ?? "board";
    this.found = new Set();
    // The row under the pointer, which shows its snooze or reopen button.
    this.hovered = null;
    // The folds that are open, by key.
    this.open = new Set();
    // The snooze menu's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();

    if (checking()) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    if (this.view === "snooze") {
      this.handle.focus();
      return;
    }
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      tick();
    });
    cx.timer.every(TICK, () => tick());
    cx.timer.every(CLOCK, (cx) => cx.notify());
  }

  /** The path to load for icon `name`: Herdr's file when it has one, else this mod's copy. */
  icon(name) {
    return iconResolver(MOD, this.found)(name);
  }

  render() {
    const t = theme();
    return this.view === "snooze" ? this.renderSnooze(t) : this.renderBoard(t);
  }

  renderBoard(t) {
    const now = Date.now();
    const list = agents();
    const items = boardItems(list, terminals(), spaces());
    // The tracker as the next tick will write it, so the board never lags a change.
    const track = advance(readTrack(), items, now).track;
    const sections = buildSections(items, track, readHolds(), now);
    const count = sections.waiting.length + sections.failed.length + sections.finished.length;

    const actions = [];
    if (sections.working.length > 0) actions.push(div().flex_none().text_size(11).text_color(t.dim).child(`${sections.working.length} working`));
    const head = header(t, "Overview", actions, { badge: badge(t, String(count)) });

    const parts = [];
    for (const section of SECTIONS) {
      const rows = sections[section.key];
      if (rows.length === 0) continue;
      parts.push(sectionTitle(t, `${section.title} · ${rows.length}`).text_color(section.color(t)));
      for (const r of rows) parts.push(this.agentRow(t, r, now, section.color(t)));
    }
    if (count === 0) parts.push(note(t, list.length === 0 ? "No agent reports a status yet." : "Nothing needs you now."));
    for (const fold of FOLDS) {
      const rows = sections[fold.key];
      if (rows.length === 0) continue;
      parts.push(this.foldHead(t, fold, rows.length));
      if (!this.open.has(fold.key)) continue;
      for (const r of rows) parts.push(this.agentRow(t, r, now, colorOf(t, r.kind)));
    }

    return frame(t, MOD).child(head).child(scrollArea("argus-agents-board", parts, { padding: 6 }));
  }

  /** A fold's heading: a click folds or unfolds its rows. */
  foldHead(t, fold, total) {
    const open = this.open.has(fold.key);
    return foldTitle(t, fold.key, {
      label: `${fold.title} · ${total}`,
      chevron: this.icon(open ? "chevron-down" : "chevron-right"),
      onToggle: (cx) => {
        if (open) this.open.delete(fold.key);
        else this.open.add(fold.key);
        cx.notify();
      },
    });
  }

  /**
   * One agent: its program icon, space and detail, then the time in its state
   * (or the snooze's end) and a dot in the section's color. On hover the time
   * gives way to the snooze button, or Reopen on a snoozed row.
   */
  agentRow(t, r, now, color) {
    const id = `${r.until !== undefined ? "snoozed" : r.kind}-${r.address}`;
    const snoozed = r.until !== undefined;
    const hovered = this.hovered === id;
    const pic = programIcon(r.program, 16, t.foreground);
    const when = snoozed ? untilLabel(r.until, now) : duration(now - r.since);
    const action = r.kind === "working" || r.kind === "idle"
      ? null
      : snoozed
      ? iconButton(
          t,
          `reopen-${r.address}`,
          this.icon("undo-2"),
          (_e, cx) => {
            cx.stop_propagation();
            reopen(r.address);
            this.hovered = null;
            cx.notify();
          },
          { tooltip: "Reopen" },
        )
      : iconButton(
          t,
          `snooze-${r.address}`,
          this.icon("clock"),
          (_e, cx) => {
            cx.stop_propagation();
            openSnooze(r.address);
          },
          { tooltip: "Snooze" },
        );
    const name = r.space || r.detail;
    const detail = r.space ? r.detail : "";
    return row(t, id, { selected: r.focused })
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) this.hovered = id;
        else if (this.hovered === id) this.hovered = null;
        cx.notify();
      })
      .on_click(() => focusRow(r))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .items_center()
          .child(div().min_w(0).max_w(detail ? 120 : 240).truncate().text_color(snoozed ? t.muted : t.foreground).child(name))
          .when(Boolean(detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${detail}`))),
      )
      .when(hovered && action !== null, (el) => el.child(div().id(`act-${id}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(action)))
      .when(!hovered || action === null, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(when)))
      .child(div().size(7).mx(3).flex_none().rounded(4).bg(color));
  }

  /** The snooze menu: one row per choice, with its wake time. */
  renderSnooze(t) {
    const p = props() ?? {};
    const now = Date.now();
    const active = this.at ?? 0;
    const rows = SNOOZES.map((choice, index) =>
      menuRow(t, `snooze-${choice.id}`, {
        label: choice.label,
        count: wakeLabel(snoozeUntil(choice.id, now), now),
        active: index === active,
        tick: this.icon("check"),
        onClick: () => pickSnooze(p, choice.id),
      }),
    );
    return menuPopup(t, {
      id: "argus-agents-snooze",
      listId: "argus-agents-snooze-list",
      handle: this.handle,
      height: SNOOZE_HEIGHT,
      parts: rows,
      onKey: (e, cx) => {
        const next = menuKey(active, e.key, SNOOZES.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") pickSnooze(p, SNOOZES[next.at].id);
        else if (next.action === "close") closeOverlay(p.overlay);
        cx.notify();
      },
    });
  }
}

function readTrack() {
  return normalizeTrack(shared(TRACK_KEY));
}

function readHolds() {
  return normalizeHolds(shared(HOLDS_KEY));
}

/**
 * Writes the tracker and the holds when they change. Every open copy runs it;
 * a copy that runs after another reads the written values and writes nothing.
 * Returns the tracker as written.
 */
function tick() {
  const now = Date.now();
  const next = advance(readTrack(), boardItems(agents(), terminals(), spaces()), now);
  if (next.changed) setShared(TRACK_KEY, next.track);
  const pruned = pruneHolds(readHolds(), next.track, now);
  if (pruned.changed) setShared(HOLDS_KEY, pruned.holds);
  return next.track;
}

function colorOf(t, kind) {
  if (kind === "working") return t.working;
  if (kind === "idle") return t.idle;
  return SECTIONS.find((section) => section.key === kind)?.color(t) ?? t.dim;
}

/** The program's icon from Herdr's program table: a one-color glyph or a picture. */
function programIcon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

/** Shows the agent: its pane, or a peek for a terminal without one. */
function focusRow(r) {
  if (r.peek) run("terminal.peek", { terminal: r.address });
  else run("pane.focus", { pane: r.pane });
}

function openSnooze(address) {
  openOverlay({ mod: MOD, props: { view: "snooze", address }, kind: "popup", width: SNOOZE_WIDTH, height: SNOOZE_HEIGHT });
}

/** Saves a snooze for the agent in the popup's props, then closes the popup. */
function pickSnooze(p, id) {
  // The tracker is brought up to date first, so the hold gets the agent's current change count.
  const track = tick();
  const next = snoozeHold(readHolds(), track, p.address, id, Date.now());
  if (next !== null) setShared(HOLDS_KEY, next);
  if (p.overlay) closeOverlay(p.overlay);
}

function reopen(address) {
  const next = reopenHold(readHolds(), address);
  if (next !== null) setShared(HOLDS_KEY, next);
}
