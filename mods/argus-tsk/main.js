// The tsk board in Herdr. One mod with three views, picked by `props().view`:
// the board (the layout's panel), the scope list (a popup) and a task
// (a pane beside the terminals). Every change goes through the `tsk` CLI.

import { div, svg, View } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { exec, home, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, watchFolder } from "herdr";
import { randomUUID } from "crypto";
import { listArgs, addArgs, withStateDir } from "./tsk.js";
import { commandCandidates, expandHome, normalizeSettings, storeDir, versionOk, MIN_TSK } from "./locate.js";
import { parseRows, parseError } from "./model.js";
import { buildBoard, captureTarget, liveNumbersOf, normalizeScope, rowsInScope, sameScope, scopeTitle, sidebarModel, STATUS_LABELS } from "./board.js";
import { debounce } from "./timing.js";
import { createGate } from "./gate.js";
import { shouldFetch, takeLock, holdsLock } from "./sync.js";
import { frame, header, iconButton, row, scrollArea, field, button, footer, sectionTitle, note } from "./ui.js";

const BOARD_KEY = "argus-tsk.board";
const SCOPE_KEY = "argus-tsk.scope";
const SELECTED_KEY = "argus-tsk.selected";
const SETTINGS_KEY = "argus-tsk.settings";
const LOCK_KEY = "argus-tsk.lock";
const MOD = "argus-tsk";
const LIVE = { shelf: "live", group: "none", sort: "recent" };
const EXEC_TIMEOUT = 15_000;
const DEBOUNCE = 300;
const POLL = 10_000;
const LOCK_RETRY = 1_000;
const SCOPES_WIDTH = 280;
const SCOPES_HEIGHT = 420;
const MIN_VERSION = MIN_TSK.join(".");
const ICON = (name) => `mods/argus-tsk/icons/${name}.svg`;

/**
 * Board rows live in `shared` (`argus-tsk.board`), so every open copy draws one
 * read. A copy that sees the store change re-reads it; the copy that wins the
 * lock in `shared` runs `tsk`, so copies do not read the store side by side.
 */
export default class Tasks extends View {
  init(_props, cx) {
    this.owner = randomUUID();
    this.view = props()?.view ?? "board";
    this.gate = createGate();
    this.force = false;
    // A read is due while the shared board is older than this time.
    this.since = Date.now();
    this.focused = null;
    this.located = null;
    this.envStore = null;
    this.watchToken = null;
    this.watch = null;
    this.polling = false;
    this.capturing = false;
    this.captureError = null;
    this.reload = debounce((cx) => cx.spawn(async (cx) => this.sync(cx)), DEBOUNCE, (cx, ms, handler) => cx.timer.after(ms, handler));

    this.captureInput = this.input("capture", { placeholder: "New task…" }, (cx) => this.capture(cx));
    this.captureInput.on("change", (_e, cx) => cx.notify());
    const settings = readSettings();
    this.tskInput = this.input("tsk", { placeholder: "tsk (from PATH)", value: settings.tsk }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.storeInput = this.input("store", { placeholder: "TSK_STATE_DIR, else ~/.tsk", value: settings.stateDir }, (cx) => this.saveSettings(cx), {
      saveOnBlur: true,
    });

    if (checking() || this.view === "scopes") return;

    this.startWatch(cx);
    cx.spawn(async (cx) => this.sync(cx));
    cx.timer.every(POLL, (cx) => {
      if (!this.polling) return;
      this.since = Math.max(this.since, Date.now() - POLL / 2);
      cx.spawn(async (cx) => this.sync(cx));
    });
  }

  /**
   * A text input that tracks focus for its border. `onSubmit` runs on Enter,
   * and also when focus leaves with `saveOnBlur`.
   */
  input(id, options, onSubmit, { saveOnBlur = false } = {}) {
    const state = InputState.new(options);
    state.on("submit", (_e, cx) => onSubmit(cx));
    state.on("focus", (_e, cx) => {
      this.focused = id;
      cx.notify();
    });
    state.on("blur", (_e, cx) => {
      if (this.focused === id) this.focused = null;
      if (saveOnBlur) onSubmit(cx);
      cx.notify();
    });
    return state;
  }

  /** Stops the watch and gives the lock back when this copy goes. */
  async close() {
    this.watchToken = null;
    this.watch?.cancel();
    this.reload.cancel();
    this.releaseLock();
  }

  releaseLock() {
    if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
    setShared(LOCK_KEY, { owner: this.owner, until: 0 });
  }

  /**
   * Runs `tsk` with `args`, adding `--state-dir` when the store folder setting
   * is set. Resolves with the exit code and output whatever the exit code.
   * Rejects with a `{ kind, message }` error when tsk cannot run: "missing"
   * (not found), "old" (older than MIN_TSK) or "unexpected" (exec failed).
   *
   * @param {string[]} args
   * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
   */
  async runTsk(args) {
    const tsk = await this.locate();
    if (!tsk.ok) throw tsk.error;
    const dir = expandHome(readSettings().stateDir, home());
    try {
      return await exec(tsk.command, withStateDir(args, dir), { timeout: EXEC_TIMEOUT });
    } catch (error) {
      throw { kind: "unexpected", exit: null, message: `Could not run tsk: ${error?.message ?? error}` };
    }
  }

  /**
   * Finds the tsk command once per "tsk command" setting: the first of the
   * setting, `tsk` on the PATH and the install locations whose `--version`
   * runs, then checks that version.
   */
  locate() {
    const setting = readSettings().tsk;
    if (this.located?.setting === setting) return this.located.result;
    const result = (async () => {
      for (const command of commandCandidates(setting, home())) {
        let reply;
        try {
          reply = await exec(command, ["--version"], { timeout: EXEC_TIMEOUT });
        } catch {
          continue;
        }
        if (reply.code !== 0) continue;
        const version = reply.stdout.trim();
        if (versionOk(version)) return { ok: true, command, version };
        return { ok: false, error: { kind: "old", message: `${version || command} is too old. This board needs tsk ${MIN_VERSION} or newer.` } };
      }
      return { ok: false, error: { kind: "missing", message: `tsk not found. Install tsk ${MIN_VERSION} or newer, or set the tsk command in settings.` } };
    })();
    this.located = { setting, result };
    return result;
  }

  /** The store folder: the setting, else `TSK_STATE_DIR` as a login shell sees it, else `~/.tsk`. */
  async storePath() {
    const dir = readSettings().stateDir;
    if (dir) return expandHome(dir, home());
    if (this.envStore === null) {
      try {
        const reply = await exec("/bin/sh", ["-c", 'printf %s "$TSK_STATE_DIR"'], { timeout: EXEC_TIMEOUT });
        this.envStore = reply.code === 0 ? reply.stdout : "";
      } catch {
        this.envStore = "";
      }
    }
    return storeDir({ TSK_STATE_DIR: this.envStore }, home());
  }

  /**
   * Watches the store folder and re-reads the board after a burst of
   * changes. When the watch is refused, the 10 s timer reads instead.
   */
  startWatch(cx) {
    const token = {};
    this.watchToken = token;
    this.watch?.cancel();
    this.watch = null;
    cx.spawn(async (cx) => {
      const dir = await this.storePath();
      while (this.watchToken === token) {
        let changed;
        try {
          this.watch = watchFolder(dir);
          changed = await this.watch;
        } catch {
          if (this.watchToken === token) this.polling = true;
          return;
        }
        if (this.watchToken !== token) return;
        this.polling = false;
        // An empty batch means the watch was given up; read again, then wait a little.
        this.since = Date.now();
        this.reload(cx);
        if (changed.length === 0) await cx.sleep(POLL);
      }
    });
  }

  /** Asks for a read now, in this copy, even when the board looks fresh. */
  refresh(cx) {
    this.force = true;
    this.since = Date.now();
    cx.spawn(async (cx) => this.sync(cx));
    cx.notify();
  }

  /**
   * Reads the board into `shared` when it is older than `this.since` (or a
   * refresh was asked for) and no other copy holds the lock.
   */
  async sync(cx) {
    if (checking() || !this.gate.start()) return;

    let read = false;
    try {
      const startedAt = Date.now();
      const board = readBoard();
      const due = this.force || board.readAt < this.since;
      const fetch = shouldFetch({ now: startedAt, fetchedAt: board.readAt, lock: shared(LOCK_KEY), intervalMs: Infinity, owner: this.owner, force: due });
      if (!fetch) {
        // Another copy is reading; check again once it is done.
        if (due) cx.timer.after(LOCK_RETRY, (cx) => cx.spawn(async (cx) => this.sync(cx)));
        return;
      }

      setShared(LOCK_KEY, takeLock(this.owner, startedAt));
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      this.force = false;
      read = true;

      const next = await this.readBoard(startedAt);
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      setShared(BOARD_KEY, next);
    } finally {
      this.releaseLock();
      const again = this.gate.finish();
      if (read) cx.notify();
      if (again) cx.spawn(async (cx) => this.sync(cx));
    }
  }

  /** One `tsk list --all` read, as the value kept under BOARD_KEY. */
  async readBoard(startedAt) {
    try {
      const reply = await this.runTsk(listArgs({ kind: "all" }, LIVE));
      if (reply.code !== 0) return { ...readBoard(), readAt: startedAt, error: parseError(reply.stderr, reply.code) };
      return { rows: parseRows(reply.stdout), readAt: startedAt, error: null };
    } catch (error) {
      return { ...readBoard(), readAt: startedAt, error };
    }
  }

  /** Adds a task from the capture field into the current scope's target. */
  async capture(cx) {
    const title = this.captureInput.value().trim();
    if (title === "" || this.capturing) return;
    this.capturing = true;
    this.captureError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const reply = await this.runTsk(addArgs({ title, ...captureTarget(readScope()) }));
        if (reply.code === 0) {
          this.captureInput.set_value("");
          this.refresh(cx);
        } else {
          this.captureError = parseError(reply.stderr, reply.code).message;
        }
      } catch (error) {
        this.captureError = error?.message ?? String(error);
      } finally {
        this.capturing = false;
        cx.notify();
      }
    });
  }

  openSettings(cx) {
    // Another copy may have changed these since this copy last drew them.
    const settings = readSettings();
    this.tskInput.set_value(settings.tsk);
    this.storeInput.set_value(settings.stateDir);
    this.view = "settings";
    cx.notify();
  }

  /** Saves both settings fields; a new store folder restarts the watch. */
  saveSettings(cx) {
    const current = readSettings();
    const next = normalizeSettings({ tsk: this.tskInput.value(), stateDir: this.storeInput.value() });
    if (next.tsk === current.tsk && next.stateDir === current.stateDir) return;
    setShared(SETTINGS_KEY, next);
    if (next.stateDir !== current.stateDir) this.startWatch(cx);
    this.refresh(cx);
  }

  render() {
    const t = theme();
    switch (this.view) {
      case "scopes":
        return this.renderScopes(t);
      case "task":
        return this.renderTask(t);
      case "settings":
        return this.renderSettings(t);
      default:
        return this.renderBoard(t);
    }
  }

  renderBoard(t) {
    const board = readBoard();
    const scope = readScope();
    const model = sidebarModel(board.rows);
    const sections = buildBoard(rowsInScope(board.rows, scope), liveNumbersOf(board.rows));
    const onDeck = [...sections.ready, ...sections.inbox];
    const count = sections.needsYou.length + sections.inMotion.length + onDeck.length;
    const blocking = board.error?.kind === "missing" || board.error?.kind === "old";

    const scopeButton = h_flex()
      .id("scope")
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
      .on_click(() => openScopes())
      .child(div().min_w(0).truncate().child(scopeTitle(scope, model)))
      .child(svg(ICON("chevron-down")).size(12).flex_none());
    const badge = div().flex_none().px(6).rounded(9).bg(t.raised).text_size(11).text_color(t.muted).child(String(count));

    const head = h_flex()
      .h(42)
      .flex_none()
      .pl(14)
      .pr(8)
      .gap(6)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_none().font_semibold().child("Tasks"))
      .child(scopeButton)
      .when(!blocking && board.readAt > 0, (el) => el.child(badge))
      .child(div().flex_1())
      .child(
        iconButton(t, "refresh", ICON("refresh-cw"), (_e, cx) => {
          // Looks for tsk again too, in case it was installed or updated.
          this.located = null;
          this.refresh(cx);
        }),
      )
      .child(iconButton(t, "settings", ICON("settings"), (_e, cx) => this.openSettings(cx)));

    const parts = [];
    if (board.error) parts.push(div().px(8).py(6).text_size(12).text_color(blocking ? t.muted : t.blocked).child(board.error.message));
    if (!blocking) {
      const selected = readSelected();
      const section = (id, title, rows, dot) => {
        if (rows.length === 0) return;
        parts.push(sectionTitle(t, `${title} · ${rows.length}`));
        for (const task of rows) parts.push(taskRow(t, `${id}-${task.number}`, task, dot, selected === task.number));
      };
      section("needs-you", "NEEDS YOU", sections.needsYou, (el) => el.bg(t.blocked));
      section("in-motion", "IN MOTION", sections.inMotion, (el) => el.bg(t.working));
      section("on-deck", "ON DECK", onDeck, (el) => el.border_1().border_color(t.muted));
      if (count === 0 && !board.error) parts.push(note(t, board.readAt > 0 ? "No tasks here" : "Loading…"));
    }

    const bar = footer(t)
      .child(field(t, "capture", this.captureInput, this.focused === "capture"))
      .child(button(t, "add", "Add", (_e, cx) => this.capture(cx), { primary: true, enabled: !this.capturing && !blocking && this.captureInput.value().trim() !== "" }));

    return frame(t, "argus-tsk")
      .child(head)
      .child(scrollArea("argus-tsk-board", parts, { padding: 6 }))
      .when(Boolean(this.captureError), (el) => el.child(div().flex_none().px(14).pt(6).text_size(11).text_color(t.blocked).child(this.captureError ?? "")))
      .child(bar);
  }

  renderScopes(t) {
    const board = readBoard();
    const model = sidebarModel(board.rows);
    const current = readScope();
    const item = (entry, index) =>
      row(t, `scope-${index}`, { selected: sameScope(entry.scope, current) })
        .cursor_pointer()
        .on_click(() => pickScope(entry.scope))
        .child(div().flex_1().min_w(0).truncate().child(entry.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(entry.count)));

    let index = 0;
    let titles = 0;
    const parts = [item(model.desk, index++), item(model.all, index++)];
    for (const [title, entries] of [
      ["Projects", model.projects],
      ["Threads", model.threads],
      ["Assignees", model.assignees],
    ]) {
      if (entries.length === 0) continue;
      parts.push(sectionTitle(t, title));
      titles++;
      for (const entry of entries) parts.push(item(entry, index++));
    }
    // A popup is as tall as its content, up to the height it was opened with,
    // so the list gets an explicit height for its rows and section titles.
    const height = Math.min(SCOPES_HEIGHT, 12 + index * 28 + titles * 30);
    return v_flex()
      .id("argus-tsk-scopes")
      .w_full()
      .h(height)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .child(scrollArea("argus-tsk-scope-list", parts, { padding: 6 }));
  }

  /** The task pane: the selected task's number, title and status from the board. */
  renderTask(t) {
    const number = readSelected();
    const task = readBoard().rows.find((r) => r.number === number);
    if (!task) return frame(t, "argus-tsk-task").child(header(t, "Task")).child(note(t, number === null ? "Pick a task on the board" : `T${number} is not on the board`));
    const status = div().flex_none().text_size(12).text_color(t.muted).child(STATUS_LABELS[task.status] ?? task.status);
    return frame(t, "argus-tsk-task").child(header(t, `T${task.number}  ${task.title}`, [status]));
  }

  renderSettings(t) {
    const back = iconButton(t, "back", ICON("chevron-left"), (_e, cx) => {
      this.view = "board";
      cx.notify();
    });
    const hint = (text) => div().px(8).text_size(11).text_color(t.dim).child(text);
    const parts = [
      sectionTitle(t, "tsk command"),
      h_flex().px(8).py(4).child(field(t, "tsk", this.tskInput, this.focused === "tsk")),
      hint("Leave empty to use tsk from PATH, else its usual install folders."),
      sectionTitle(t, "Store folder"),
      h_flex().px(8).py(4).child(field(t, "store", this.storeInput, this.focused === "store")),
      hint("Leave empty to use TSK_STATE_DIR, else ~/.tsk. Both fields save on Enter or when you leave them."),
    ];
    return frame(t, "argus-tsk-settings")
      .child(h_flex().h(42).flex_none().pl(8).pr(14).gap(4).items_center().border_b(1).border_color(t.border).child(back).child(div().font_semibold().child("Settings")))
      .child(scrollArea("argus-tsk-settings-list", parts, { padding: 6 }));
  }
}

/** A 28 px board row: status dot, `T<number>`, title, status word. Click opens the task pane. */
function taskRow(t, id, task, dot, selected) {
  return row(t, id, { selected })
    .cursor_pointer()
    .on_click(() => openTask(task.number))
    .child(dot(div().size(8).flex_none().rounded(4)))
    .child(div().flex_none().text_size(12).text_color(t.muted).child(`T${task.number}`))
    .child(div().flex_1().min_w(0).truncate().child(task.title))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(STATUS_LABELS[task.status] ?? task.status));
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
}

/**
 * Selects a task and shows it: focuses this mod's pane in the shown tab, or
 * splits the tab's focused pane to the right to open one.
 */
function openTask(number) {
  setShared(SELECTED_KEY, { number });
  const tab = spaces()
    .find((space) => space.active)
    ?.tabs.find((candidate) => candidate.active);
  if (!tab) return;
  const inTab = panes().filter((pane) => pane.tab === tab.id);
  const own = inTab.find((pane) => pane.mod === MOD);
  if (own) {
    run("pane.focus", { pane: own.pane });
    return;
  }
  const target = inTab.find((pane) => pane.focused) ?? inTab[0];
  run("pane.split", { ...(target ? { pane: target.pane } : {}), direction: "right", mod: MOD, props: { view: "task" } });
}

function readSettings() {
  return normalizeSettings(shared(SETTINGS_KEY));
}

function readScope() {
  return normalizeScope(shared(SCOPE_KEY));
}

/** @returns {number | null} */
function readSelected() {
  const value = shared(SELECTED_KEY);
  const number = value && typeof value === "object" ? /** @type {{ number?: unknown }} */ (value).number : null;
  return Number.isInteger(number) ? /** @type {number} */ (number) : null;
}

/** The board all copies share. */
function readBoard() {
  const value = shared(BOARD_KEY);
  const v = value && typeof value === "object" ? /** @type {Record<string, any>} */ (value) : {};
  return {
    rows: Array.isArray(v.rows) ? v.rows : [],
    readAt: Number.isFinite(v.readAt) ? v.readAt : 0,
    error: v.error && typeof v.error === "object" && typeof v.error.message === "string" ? v.error : null,
  };
}
