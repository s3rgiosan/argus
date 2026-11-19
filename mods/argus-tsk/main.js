// The tsk board in Herdr. One mod with four views, picked by `props().view`:
// the board (the layout's panel), the scope list (a popup), a task (a pane
// beside the terminals) and the status list (a popup). Every change goes through the `tsk` CLI.

import { div, svg, View } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, TextareaState } from "gpui-base";
import { exec, home, appHome, readTextFile, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, watchFolder, layout, focused } from "herdr";
import { randomUUID } from "crypto";
import { listArgs, addArgs, taskArgs, statusArgs, editArgs, stepsArgs, replyArgs, archiveArgs, projectTitleArgs, withStateDir } from "./tsk.js";
import { commandCandidates, expandHome, normalizeSettings, storeDir, tildePath, versionAtLeast, versionOk, MIN_TSK, TITLES_TSK } from "./locate.js";
import { parseRows, parseError } from "./model.js";
import { activitySentence, buildBoard, captureTarget, effectiveScope, followedProject, followFolder, liveNumbersOf, normalizeScope, rowsInScope, scopeTitle, sidebarModel, STATUS_LABELS, titleChange } from "./board.js";
import { answerBlock, applyOptimistic, flowOutcome, retryStatus, sendBack } from "./flows.js";
import { actionsFor, addAfter, blockChange, changeFor, CHECK_LABELS, detailState, fieldSave, normalizeChoices, patchDetail, pickedChange, refusalOffer, reviewChange, statusChoices, statusPick, taskRef } from "./detail.js";
import { debounce } from "./timing.js";
import { expandAction, isExpanded, panelOf } from "./panel.js";
import { parseStamp, stampArgs, storeChanged } from "./store.js";
import { createGate } from "./gate.js";
import { shouldFetch, takeLock, holdsLock } from "./sync.js";
import { frame, header, subHeader, badge, iconButton, row, scrollArea, field, textBox, button, footer, sectionTitle, note, toggle, menuRow, MENU_PAD, MENU_ROW } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";
import { menuKey, startAt } from "./menu.js";

const BOARD_KEY = "argus-tsk.board";
const SCOPE_KEY = "argus-tsk.scope";
const SELECTED_KEY = "argus-tsk.selected";
const SETTINGS_KEY = "argus-tsk.settings";
const LOCK_KEY = "argus-tsk.lock";
const STATUS_PICK_KEY = "argus-tsk.statusPick";
const PANEL_WIDTH_KEY = "argus-tsk.panelWidth";
// The argus layout's panel column, made by scripts/build-layout.mjs.
const PANEL_ID = "argus-panel";
const MOD = "argus-tsk";
const LIVE = { shelf: "live", group: "none", sort: "recent" };
const EXEC_TIMEOUT = 15_000;
const DEBOUNCE = 300;
const POLL = 10_000;
const LOCK_RETRY = 1_000;
const RETIRE_AFTER = 500;
const SCOPES_WIDTH = 280;
const SCOPES_HEIGHT = 420;
const STATUS_WIDTH = 200;
// About how many characters of an 11 px message fit on one line of the scopes popup.
const ERROR_CHARS = 40;
const MIN_VERSION = MIN_TSK.join(".");
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

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
    // The scopes popup: whether tsk can title projects, and the project being renamed.
    this.canTitle = false;
    this.renaming = null;
    this.reload = debounce(
      (cx) => {
        cx.spawn(async (cx) => this.sync(cx));
        if (this.view === "task") this.loadTask(cx, readSelected());
      },
      DEBOUNCE,
      (cx, ms, handler) => cx.timer.after(ms, handler),
    );

    // The task pane. `detail` is the shown task's read; `fields` holds that
    // task's inputs, made again whenever another task is shown.
    this.detail = null;
    this.shownNumber = null;
    this.loadSeq = 0;
    this.fields = null;
    this.card = null;
    this.form = null;
    this.busy = false;
    this.writeError = null;
    this.flowError = null;
    this.refusal = null;
    // Status picks from the status popup older than this are already handled.
    this.pickSince = Date.now();

    // The icons Herdr ships that this mod can load; its own copies show until the probe ends.
    this.found = new Set();
    // Whether this copy is reading the board now.
    this.reading = false;
    // The popup's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();

    this.captureInput = this.input("capture", { placeholder: "New task…" }, (cx) => this.capture(cx));
    this.captureInput.on("change", (_e, cx) => cx.notify());
    const settings = readSettings();
    this.tskInput = this.input("tsk", { placeholder: "tsk (from PATH)", value: settings.tsk }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.storeInput = this.input("store", { placeholder: "TSK_STATE_DIR, else ~/.tsk", value: settings.stateDir }, (cx) => this.saveSettings(cx), {
      saveOnBlur: true,
    });

    if (checking()) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    if (this.view === "status") {
      this.handle.focus();
      return;
    }
    if (this.view === "scopes") {
      this.handle.focus();
      this.checkTitles(cx);
      return;
    }

    this.startWatch(cx);
    cx.spawn(async (cx) => this.sync(cx));
    if (this.view === "task") this.loadTask(cx, readSelected());
    cx.timer.every(POLL, (cx) => {
      if (!this.polling) return;
      this.since = Math.max(this.since, Date.now() - POLL / 2);
      cx.spawn(async (cx) => this.sync(cx));
    });
  }

  /** The path to load for icon `name`: Herdr's file when it has one, else this mod's copy. */
  icon(name) {
    return iconResolver(MOD, this.found)(name);
  }

  /**
   * A text input that tracks focus for its border. `onSubmit` runs on Enter,
   * and also when focus leaves with `saveOnBlur`. A `multiline` input is a
   * textarea: Return adds a line, and only ⌘Return submits.
   */
  input(id, options, onSubmit, { saveOnBlur = false, multiline = false } = {}) {
    const state = multiline ? TextareaState.new(options) : InputState.new(options);
    state.on("submit", (e, cx) => {
      if (multiline && !e?.secondary) return;
      onSubmit(cx);
    });
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
    // Only a found tsk is kept: a missing or old one is looked up again next time.
    result.then((found) => {
      if (!found.ok && this.located?.result === result) this.located = null;
    });
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
   * The store data file's stamp (modification time and size), or null when
   * it cannot be read.
   * @returns {Promise<string | null>}
   */
  async storeStamp(dir) {
    const [command, args] = stampArgs(dir);
    try {
      return parseStamp(await exec(command, args, { timeout: EXEC_TIMEOUT }));
    } catch {
      return null;
    }
  }

  /**
   * Watches the store folder and re-reads the board after a burst of
   * changes. A batch that leaves the data file as it was comes from a read
   * (tsk changes file metadata on every run) and is skipped. When the watch
   * is refused, the 10 s timer reads instead.
   */
  startWatch(cx) {
    const token = {};
    this.watchToken = token;
    this.watch?.cancel();
    this.watch = null;
    cx.spawn(async (cx) => {
      const dir = await this.storePath();
      let stamp = await this.storeStamp(dir);
      // What the last batch asks for, checked once the next watch is in place
      // so no change slips through between two watches.
      let pending = null;
      while (this.watchToken === token) {
        let changed;
        try {
          this.watch = watchFolder(dir);
          if (pending === "restart") {
            // A watch started again may have missed changes, so read now.
            stamp = await this.storeStamp(dir);
            this.since = Date.now();
            this.reload(cx);
          } else if (pending === "batch") {
            const next = await this.storeStamp(dir);
            if (this.watchToken === token && storeChanged(stamp, next)) {
              stamp = next;
              this.since = Date.now();
              this.reload(cx);
            }
          }
          changed = await this.watch;
        } catch {
          if (this.watchToken === token) this.polling = true;
          return;
        }
        if (this.watchToken !== token) return;
        this.polling = false;
        // An empty batch means the watch was given up: wait a little, then watch again.
        if (changed.length === 0) {
          pending = "restart";
          await cx.sleep(POLL);
          continue;
        }
        pending = "batch";
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
      this.reading = true;
      cx.notify();

      const next = await this.readBoard(startedAt);
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      setShared(BOARD_KEY, next);
    } finally {
      this.reading = false;
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
        const scope = effectiveScope(readScope(), followedOf(readBoard().rows));
        const reply = await this.runTsk(addArgs({ title, ...captureTarget(scope) }));
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

  /**
   * Widens the panel column to its max, keeping its width in `shared`, or
   * puts an expanded column back to that width.
   */
  toggleExpand(cx) {
    const panel = panelOf(layout(), PANEL_ID, MOD);
    if (!panel) return;
    const action = expandAction(panel, shared(PANEL_WIDTH_KEY));
    if (action.save !== null) setShared(PANEL_WIDTH_KEY, action.save);
    run("layout.resize", { id: PANEL_ID, px: action.px });
    cx.notify();
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

  // Scopes popup

  /** Shows the rename action once tsk turns out to be new enough to title projects. */
  checkTitles(cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      const tsk = await this.locate();
      this.canTitle = tsk.ok && versionAtLeast(tsk.version, TITLES_TSK);
      cx.notify();
    });
  }

  /** Turns a project's row into a field prefilled with its title, else its folder name. */
  startRename(cx, item) {
    this.retire(cx, this.renaming);
    const state = this.input("rename", { value: item.title ?? item.folder, placeholder: item.folder }, (cx) => this.saveRename(cx));
    this.renaming = { project: item.scope.project, item: { title: item.title, folder: item.folder }, state, error: null, saving: false };
    // The field takes the keyboard once the frame that draws it is up.
    cx.timer.after(0, () => state.focus());
    cx.notify();
  }

  cancelRename(cx) {
    if (!this.renaming) return;
    if (this.focused === "rename") this.focused = null;
    this.retire(cx, this.renaming);
    this.renaming = null;
    cx.notify();
  }

  /**
   * Saves the field as the project's title, or clears the title with `clear`.
   * Nothing to save closes the field. A refusal shows under the field and
   * keeps it open; a saved title closes it and re-reads the board.
   */
  saveRename(cx, clear = false) {
    const rename = this.renaming;
    if (!rename || rename.saving) return;
    const change = titleChange(rename.item, clear ? "" : rename.state.value());
    if (change === null) {
      this.cancelRename(cx);
      return;
    }
    rename.saving = true;
    rename.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.tskWrite(projectTitleArgs(rename.project, change.title));
        if (this.renaming === rename) this.cancelRename(cx);
        this.refresh(cx);
      } catch (error) {
        rename.error = error?.message ?? String(error);
      } finally {
        rename.saving = false;
        cx.notify();
      }
    });
  }

  // Task pane

  /**
   * Reads task `number` into the pane. A newer call wins over a read still
   * running. A task tsk does not know clears the selection.
   */
  loadTask(cx, number) {
    const seq = ++this.loadSeq;
    let oldForm = null;
    if (number !== this.shownNumber) {
      this.shownNumber = number;
      this.card = null;
      oldForm = this.form;
      this.form = null;
      this.writeError = null;
      this.flowError = null;
      this.refusal = null;
      if (number !== null) this.detail = { kind: "loading", number };
    }
    if (checking()) return;
    // This can run from render, so the read and the release start after it.
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.retire(cx, oldForm);
      if (number === null) return;
      let result;
      try {
        result = await this.runTsk(taskArgs(number));
      } catch (error) {
        result = { error };
      }
      if (seq !== this.loadSeq) return;
      const state = detailState(result);
      switch (state.kind) {
        case "ok":
          this.bindFields(cx, state.task);
          this.detail = { kind: "ok", number, task: state.task };
          // A retry only applies while the block or review it answered is still open.
          if (state.task.status !== "blocked" && state.task.status !== "review") this.flowError = null;
          break;
        case "missing":
          this.detail = { kind: "missing", number };
          if (readSelected() === number) setShared(SELECTED_KEY, null);
          break;
        default:
          // A failed re-read keeps the task already shown, under the error.
          this.detail = { kind: "error", number, message: state.message, task: this.detail?.number === number ? this.detail.task : undefined };
          break;
      }
      cx.notify();
    });
  }

  /** The task the pane shows, or null while none is read. */
  shownTask() {
    return this.detail?.task && this.detail.number === this.shownNumber ? this.detail.task : null;
  }

  /**
   * Makes the inputs for a newly shown task. For the task already shown, it
   * puts tsk's values in the fields that do not have the keyboard.
   * Each input saves to the task it was made for.
   */
  bindFields(cx, task) {
    const number = task.number;
    if (this.fields?.number !== number) {
      this.retire(cx, this.fields);
      this.fields = {
        number,
        title: this.input("title", { value: task.title, placeholder: "Title" }, (cx) => this.saveTitle(cx, number), { saveOnBlur: true }),
        notes: this.input("notes", { value: task.notes ?? "", placeholder: "Add notes", rows: 4 }, (cx) => this.saveNotes(cx, number), {
          saveOnBlur: true,
          multiline: true,
        }),
        assignee: this.input("assignee", { value: task.assignee ?? "", placeholder: "Unassigned" }, (cx) => this.saveAssignee(cx, number), {
          saveOnBlur: true,
        }),
        after: this.input("after", { placeholder: "T#" }, (cx) => this.addRunsAfter(cx, number)),
        step: this.input("step", { placeholder: "Add a step" }, (cx) => this.addStep(cx, number)),
        reply: this.input("reply", { placeholder: "Reply" }, (cx) => this.submitReply(cx, number), { multiline: true }),
      };
      // The text each field had when tsk's value was last put in it.
      this.fields.baseline = { title: task.title, notes: task.notes ?? "", assignee: task.assignee ?? "" };
      this.fields.notes.set_auto_grow(3, 12);
      this.fields.reply.set_auto_grow(2, 8);
      this.fields.reply.on("change", (_e, cx) => cx.notify());
      return;
    }
    const sync = (id, state, value) => {
      if (this.focused === id) return;
      if (state.value() !== value) state.set_value(value);
      this.fields.baseline[id] = value;
    };
    sync("title", this.fields.title, task.title);
    sync("notes", this.fields.notes, task.notes ?? "");
    sync("assignee", this.fields.assignee, task.assignee ?? "");
  }

  /**
   * Releases the input states in `states` (an object of states; other values
   * are skipped) once the frame that still draws them is gone.
   */
  retire(cx, states) {
    if (!states) return;
    const old = Object.values(states).filter((s) => typeof s?.release === "function");
    if (old.length === 0) return;
    cx.timer.after(RETIRE_AFTER, () => {
      for (const state of old) {
        try {
          state.release();
        } catch {
          // Already released.
        }
      }
    });
  }

  /** Runs a tsk write and rejects with a parsed tsk error when it fails. */
  async tskWrite(args) {
    const reply = await this.runTsk(args);
    if (reply.code !== 0) throw parseError(reply.stderr, reply.code);
    return reply;
  }

  /** The `api` the block and review flows write through. */
  flowApi() {
    return {
      reply: (number, text, send) => this.tskWrite(replyArgs(number, text, send)),
      setStatus: (number, change) => this.tskWrite(statusArgs(number, change)),
    };
  }

  /**
   * Writes one change to task `number`, showing `patch` on the task until tsk
   * is read again. A status change also shows on the board. `close` clears
   * the selection once the write succeeded, and `done(cx)` runs then.
   * Afterwards the board and the task are read again.
   */
  write(cx, number, label, args, { patch = null, change = null, close = false, done = null } = {}) {
    const task = this.shownTask();
    if (task?.number !== number) return;
    this.writeError = null;
    this.flowError = null;
    this.refusal = null;
    if (patch) this.detail = { ...this.detail, task: patchDetail(task, patch) };
    if (change) {
      const board = readBoard();
      setShared(BOARD_KEY, { ...board, rows: applyOptimistic(board.rows, number, change) });
    }
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.tskWrite(args);
        done?.(cx);
        if (close && readSelected() === number) {
          setShared(SELECTED_KEY, null);
          this.detail = null;
        }
      } catch (error) {
        // The error belongs to task `number`; the pane may show another task by now.
        if (this.shownNumber === number) {
          const message = error?.kind === "store" ? `${error.message}; the board was re-read` : (error?.message ?? String(error));
          this.writeError = `${label} couldn't be completed. ${message}`;
          if (error?.kind === "refused" && change) this.refusal = { code: error.code, number, change };
        }
      } finally {
        this.refresh(cx);
        this.loadTask(cx, readSelected());
        cx.notify();
      }
    });
  }

  /** Writes a status change; a change to done finishes the task and clears the selection. */
  changeStatus(cx, number, change, label) {
    this.write(cx, number, label, statusArgs(number, change), { patch: { kind: "status", change }, change, close: change.kind === "done" });
  }

  saveTitle(cx, number) {
    this.saveField(cx, number, "title", "Edit Title");
  }

  saveNotes(cx, number) {
    this.saveField(cx, number, "notes", "Edit Notes");
  }

  saveAssignee(cx, number) {
    this.saveField(cx, number, "assignee", null);
  }

  /**
   * Saves the title, notes or assignee field of task `number` when it was
   * edited since tsk's value was last put in it (`fieldSave`). `label` names
   * the write; the assignee's is Assign or Unassign.
   */
  saveField(cx, number, field, label) {
    const task = this.shownTask();
    if (task?.number !== number || this.fields?.number !== number) return;
    const state = this.fields[field];
    const value = state.value();
    const save = fieldSave(field, value, this.fields.baseline[field], task);
    switch (save.kind) {
      case "reset":
        state.set_value(task.title);
        this.fields.baseline[field] = task.title;
        return;
      case "write": {
        this.fields.baseline[field] = value;
        const name = label ?? ("unassign" in save.input ? "Unassign" : "Assign");
        this.write(cx, number, name, editArgs(number, save.input), { patch: { kind: "edit", input: save.input } });
        return;
      }
      default:
        return;
    }
  }

  addRunsAfter(cx, number) {
    const task = this.shownTask();
    if (task?.number !== number || this.fields?.number !== number) return;
    const ref = taskRef(this.fields.after.value());
    const after = ref === null ? null : addAfter(task, ref);
    if (after === null) {
      this.writeError = "Type the number of another task, such as T7.";
      cx.notify();
      return;
    }
    this.fields.after.set_value("");
    this.write(cx, number, "Add Dependency", editArgs(number, { after }));
  }

  removeRunsAfter(cx, number, link) {
    const task = this.shownTask();
    if (task?.number !== number) return;
    const after = task.after.map((a) => a.task).filter((n) => n !== link);
    this.write(cx, number, "Remove Dependency", editArgs(number, { after }));
  }

  addStep(cx, number) {
    if (this.fields?.number !== number) return;
    const text = this.fields.step.value().trim();
    if (text === "") return;
    this.fields.step.set_value("");
    this.write(cx, number, "Add Step", stepsArgs(number, { kind: "add", text }));
  }

  stepOp(cx, number, op, label) {
    this.write(cx, number, label, stepsArgs(number, op), { patch: { kind: "step", op } });
  }

  /**
   * Answers the block or sends the review back with the reply field's text:
   * one reply, then the status change the flow picks.
   */
  submitReply(cx, number) {
    const task = this.shownTask();
    if (task?.number !== number || this.fields?.number !== number || this.busy) return;
    if (task.status !== "blocked" && task.status !== "review") return;
    const text = this.fields.reply.value().trim();
    if (text === "") return;
    this.busy = true;
    this.flowError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = task.status === "blocked" ? await answerBlock(this.flowApi(), task, text) : await sendBack(this.flowApi(), task, text);
        this.finishFlow(number, result, false);
      } finally {
        this.busy = false;
        this.refresh(cx);
        this.loadTask(cx, readSelected());
        cx.notify();
      }
    });
  }

  /** Repeats only the status change of a flow whose reply was sent. */
  retryFlow(cx) {
    const task = this.shownTask();
    if (!task || this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.finishFlow(task.number, await retryStatus(this.flowApi(), task), true);
      } finally {
        this.busy = false;
        this.refresh(cx);
        this.loadTask(cx, readSelected());
        cx.notify();
      }
    });
  }

  /** Shows a flow's result, only while the pane still shows task `number`. */
  finishFlow(number, result, clearDraft) {
    const outcome = flowOutcome(result, clearDraft, this.shownNumber === number && this.fields?.number === number);
    if (!outcome.apply) return;
    this.flowError = outcome.flowError;
    if (outcome.clearDraft) this.fields.reply.set_value("");
  }

  /** Opens the block or review form, filled from the task's last block or review. */
  openCard(cx, card) {
    const task = this.shownTask();
    if (!task) return;
    const multi = { multiline: true };
    const none = () => {};
    this.retire(cx, this.form);
    if (card === "block") {
      this.form = {
        why: this.input("why", { value: task.block?.why ?? "", placeholder: "Why", rows: 2 }, none, multi),
        needs: this.input("needs", { value: task.block?.needs ?? "", placeholder: "Needs" }, none),
        options: this.input("options", { value: (task.block?.options ?? []).join("\n"), placeholder: "Options, one per line", rows: 3 }, none, multi),
      };
    } else {
      this.form = {
        done: this.input("done", { value: task.review?.done ?? "", placeholder: "Done", rows: 2 }, none, multi),
        checks: this.input("checks", { value: (task.review?.checks ?? []).map((c) => c.text).join("\n"), placeholder: "Checks, one per line", rows: 3 }, none, multi),
        next: this.input("next", { value: task.review?.next ?? "", placeholder: "Next" }, none),
      };
    }
    this.card = card;
    cx.notify();
  }

  closeCard(cx) {
    this.retire(cx, this.form);
    this.card = null;
    this.form = null;
    cx.notify();
  }

  /** Writes the open form's block or review; the form closes once tsk took it. */
  submitCard(cx) {
    const task = this.shownTask();
    if (!task || !this.form) return;
    const f = this.form;
    const change =
      this.card === "block"
        ? blockChange({ why: f.why.value(), needs: f.needs.value(), options: f.options.value() })
        : reviewChange({ done: f.done.value(), checks: f.checks.value(), next: f.next.value() });
    const label = this.card === "block" ? "Block" : "Request Review";
    const card = this.card;
    this.write(cx, task.number, label, statusArgs(task.number, change), {
      patch: { kind: "status", change },
      change,
      done: (cx) => {
        if (this.card === card) {
          this.retire(cx, this.form);
          this.card = null;
          this.form = null;
        }
      },
    });
  }

  archive(cx, number) {
    this.write(cx, number, "Archive", archiveArgs(number, true), { close: true });
  }

  render(cx) {
    const t = theme();
    switch (this.view) {
      case "scopes":
        return this.renderScopes(t);
      case "status":
        return this.renderStatusMenu(t);
      case "task":
        return this.renderTask(t, cx);
      case "settings":
        return this.renderSettings(t);
      default:
        return this.renderBoard(t);
    }
  }

  renderBoard(t) {
    const board = readBoard();
    const scope = readScope();
    const following = followedOf(board.rows);
    const model = sidebarModel(board.rows, following, scope);
    const sections = buildBoard(rowsInScope(board.rows, scope, following), liveNumbersOf(board.rows));
    const onDeck = [...sections.ready, ...sections.inbox];
    const count = sections.needsYou.length + sections.inMotion.length + onDeck.length;
    const blocking = board.error?.kind === "missing" || board.error?.kind === "old";
    // Only the copy in the layout's panel column can widen it.
    const panel = props()?.overlay ? null : panelOf(layout(), PANEL_ID, MOD);

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
      .child(div().min_w(0).truncate().child(scopeTitle(scope, model, following)))
      .child(svg(this.icon("chevron-down")).size(12).flex_none());

    const head = h_flex()
      .h(42)
      .flex_none()
      .px(14)
      .gap(6)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_none().font_semibold().child("Tasks"))
      .child(scopeButton)
      .when(!blocking && board.readAt > 0, (el) => el.child(badge(t, String(count))))
      .child(div().flex_1())
      .when(panel !== null, (el) =>
        el.child(iconButton(t, "expand", ICON(panel && isExpanded(panel) ? "minimize-2" : "maximize-2"), (_e, cx) => this.toggleExpand(cx))),
      )
      .child(
        iconButton(
          t,
          "refresh",
          ICON("refresh-cw"),
          (_e, cx) => {
            // Looks for tsk again too, in case it was installed or updated.
            this.located = null;
            this.refresh(cx);
          },
          { busy: this.reading },
        ),
      )
      .child(iconButton(t, "settings", this.icon("settings"), (_e, cx) => this.openSettings(cx)));

    const parts = [];
    if (board.error) parts.push(div().px(8).py(6).text_size(12).text_color(blocking ? t.muted : t.blocked).child(board.error.message));
    if (!blocking) {
      const selected = readSelected();
      const section = (id, title, rows, dot) => {
        if (rows.length === 0) return;
        parts.push(sectionTitle(t, `${title} · ${rows.length}`));
        for (const task of rows) parts.push(taskRow(t, `${id}-${task.number}`, task, dot, selected === task.number));
      };
      section("needs-you", "Needs you", sections.needsYou, (el) => el.bg(t.blocked));
      section("in-motion", "In motion", sections.inMotion, (el) => el.bg(t.working));
      section("on-deck", "On deck", onDeck, (el) => el.border_1().border_color(t.muted));
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
    const model = sidebarModel(board.rows, followedOf(board.rows), readScope());
    const rename = this.renaming;
    // The place, the thread and the assignee are separate choices. A list with only
    // its "any" row has nothing to pick, so it is left out.
    const groups = [
      ["In", model.where],
      ["Projects", model.projects],
      ["Threads", model.threads.length > 1 ? model.threads : []],
      ["Assignees", model.assignees.length > 1 ? model.assignees : []],
    ].filter(([, entries]) => entries.length > 0);
    const entries = groups.flatMap(([, list]) => list);
    const active = this.at ?? startAt(entries);
    // Height the rename field adds over the row it replaces.
    let extra = 0;
    const item = (entry, index) => {
      if (entry.scope.kind === "project" && rename?.project === entry.scope.project) {
        extra += 85 + (rename.error ? 6 + 16 * Math.ceil(rename.error.length / ERROR_CHARS) : 0);
        return this.renameField(t, rename);
      }
      return menuRow(t, `scope-${index}`, {
        label: entry.label,
        count: String(entry.count),
        active: index === active,
        current: entry.current,
        tick: this.icon("check"),
        onClick: () => pickScope(entry.scope),
        trailing:
          this.canTitle && entry.scope.kind === "project"
            ? iconButton(t, `rename-${index}`, this.icon("square-pen"), (_e, cx) => {
                cx.stop_propagation();
                this.startRename(cx, entry);
              })
            : null,
      });
    };

    let index = 0;
    const parts = [];
    for (const [title, list] of groups) {
      parts.push(sectionTitle(t, title));
      for (const entry of list) parts.push(item(entry, index++));
    }
    // A popup is as tall as its content, up to the height it was opened with,
    // so the list gets an explicit height for its rows and section titles.
    const height = Math.min(SCOPES_HEIGHT, 2 * MENU_PAD + index * MENU_ROW + groups.length * 30 + extra);
    return v_flex()
      .id("argus-tsk-scopes")
      .track_focus(this.handle)
      .w_full()
      .h(height)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        // Keys in the rename field belong to the field.
        if (rename) return;
        const next = menuKey(active, e.key, entries.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") pickScope(entries[next.at].scope);
        else if (next.action === "close") closeOverlay(props()?.overlay);
        cx.notify();
      })
      .child(scrollArea("argus-tsk-scope-list", parts, { padding: MENU_PAD }));
  }

  /**
   * A project's rename field, the project's path and a hint under it, then
   * Clear and Save. Enter saves, Escape cancels.
   */
  renameField(t, rename) {
    const enabled = !rename.saving;
    return v_flex()
      .id("rename")
      .flex_none()
      .px(8)
      .py(4)
      .gap(6)
      .on_key_down((event, cx) => {
        if (event.keystroke !== "escape") return;
        cx.stop_propagation();
        this.cancelRename(cx);
      })
      .child(h_flex().child(field(t, "rename-field", rename.state, this.focused === "rename")))
      .child(
        v_flex()
          .gap(2)
          .text_size(11)
          .text_color(t.dim)
          .child(div().min_w(0).truncate().child(tildePath(rename.project, home())))
          .child(div().child("Leave empty to use the folder name.")),
      )
      .child(
        h_flex()
          .gap(6)
          .justify_end()
          .child(button(t, "rename-clear", "Clear", (_e, cx) => this.saveRename(cx, true), { enabled: enabled && rename.item.title !== null }))
          .child(button(t, "rename-save", "Save", (_e, cx) => this.saveRename(cx), { primary: true, enabled })),
      )
      .when(Boolean(rename.error), (el) => el.child(div().text_size(11).text_color(t.blocked).whitespace_normal().child(rename.error ?? "")));
  }

  /** The task pane: the selected task's fields, steps, open block or review, activity and actions. */
  renderTask(t, cx) {
    const selected = readSelected();
    // A new selection arrives as a re-render; the read runs as a task.
    if (selected !== this.shownNumber && !checking()) this.loadTask(cx, selected);

    const empty = (text) => paneFrame(t).child(header(t, "Task")).child(note(t, text));
    const detail = this.detail;
    const task = this.shownTask();
    // A status picked in the status popup arrives as a re-render. Every pick
    // for this pane is consumed here; only one for the shown task is written,
    // as a task.
    const pick = statusPick(shared(STATUS_PICK_KEY), { owner: this.owner, number: task?.number ?? null, since: this.pickSince });
    if (pick) {
      this.pickSince = pick.at;
      const picked = pick.run && task ? pickedChange(statusChoices(task), pick.status) : null;
      if (picked) {
        const pickedNumber = task.number;
        cx.spawn(async (cx) => {
          await cx.sleep(0);
          this.changeStatus(cx, pickedNumber, picked.change, picked.label);
        });
      }
    }
    if (detail?.kind === "missing") return empty("Task not found");
    if (selected === null) return empty("Pick a task on the board");
    const fields = this.fields?.number === task?.number ? this.fields : null;
    if (!task || !fields) {
      if (detail?.kind === "error") return empty(detail.message);
      return empty("Loading…");
    }

    const number = task.number;
    const actions = actionsFor(task);
    const has = (action) => actions.includes(action);
    const status = h_flex()
      .flex_none()
      .gap(6)
      .items_center()
      .text_size(12)
      .text_color(t.muted)
      .child(statusDot(t, task.status))
      .child(STATUS_LABELS[task.status] ?? task.status);
    const head = h_flex()
      .h(42)
      .flex_none()
      .pl(14)
      .pr(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_none().text_size(12).text_color(t.muted).child(`T${number}`))
      .child(inlineField(t, "title", fields.title, this.focused === "title").font_semibold())
      .child(status);

    const parts = [];
    if (detail.kind === "error") parts.push(message(t, detail.message));

    parts.push(sectionTitle(t, "Notes"), pad(textBox(t, "notes", fields.notes, this.focused === "notes")));

    // Status: a dropdown of the states to pick, then the changes that need more input.
    const choices = statusChoices(task);
    const statusMenu = h_flex()
      .id("status-menu")
      .h(26)
      .flex_none()
      .px(8)
      .gap(4)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_size(12)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openStatusMenu(this.owner, number, choices))
      .child(div().child(choices.find((c) => c.current)?.label ?? STATUS_LABELS[task.status] ?? task.status))
      .child(svg(this.icon("chevron-down")).size(12).flex_none());
    const more = [];
    if (has("startQuiet")) more.push(chip(t, "start-quiet", "Start Without Agent", (_e, cx) => this.changeStatus(cx, number, changeFor("startQuiet"), "Start")));
    more.push(chip(t, "open-block", "Block…", (_e, cx) => this.openCard(cx, "block"), { selected: this.card === "block" }));
    more.push(chip(t, "open-review", "Request Review…", (_e, cx) => this.openCard(cx, "review"), { selected: this.card === "review" }));
    const offer = refusalOffer(this.refusal, number);
    if (offer) more.push(chip(t, "refusal", offer.label, (_e, cx) => this.changeStatus(cx, number, offer.change, offer.label), { selected: true }));
    parts.push(sectionTitle(t, "Status"), h_flex().px(4).py(4).child(statusMenu), wrapRow(more));

    parts.push(sectionTitle(t, "Assignee"), pad(field(t, "assignee", fields.assignee, this.focused === "assignee")));

    const links = task.after.map((link) =>
      chip(t, `after-${link.task}`, `T${link.task}`, (_e, cx) => this.removeRunsAfter(cx, number, link.task), { icon: this.icon("x"), done: link.done }),
    );
    parts.push(
      sectionTitle(t, "Runs after"),
      wrapRow([...links, div().w(90).flex_none().child(field(t, "after", fields.after, this.focused === "after"))]),
    );

    if (this.card && this.form) parts.push(this.renderCard(t, number));
    if (task.status === "blocked" || task.status === "review") parts.push(this.renderThread(t, task, fields));
    if (this.writeError) parts.push(message(t, this.writeError));

    parts.push(sectionTitle(t, "Steps"));
    for (const step of task.steps) {
      parts.push(
        row(t, `step-${step.shortId}`)
          .child(
            toggle(t, `step-check-${step.shortId}`, step.done, (_e, cx) => this.stepOp(cx, number, { kind: "toggle", id: step.shortId }, "Toggle Step")),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .when(step.done, (el) => el.line_through().text_color(t.muted))
              .child(step.text),
          )
          .child(iconButton(t, `step-remove-${step.shortId}`, this.icon("x"), (_e, cx) => this.stepOp(cx, number, { kind: "remove", id: step.shortId }, "Remove Step"))),
      );
    }
    parts.push(pad(field(t, "step", fields.step, this.focused === "step")));

    if (task.activity.length > 0) {
      parts.push(sectionTitle(t, "Activity"));
      task.activity.forEach((entry, i) => parts.push(div().id(`activity-${i}`).px(8).py(3).text_size(12).text_color(t.muted).child(activitySentence(entry))));
    }

    const bar = footer(t)
      .when(has("markDone"), (el) => el.child(button(t, "mark-done", "Done", (_e, cx) => this.changeStatus(cx, number, changeFor("markDone"), "Mark Done"), { primary: true })))
      .when(has("reply"), (el) => el.child(button(t, "reply", "Reply", () => fields.reply.focus())))
      .child(div().flex_1())
      .child(button(t, "archive", "Archive", (_e, cx) => this.archive(cx, number)));

    return paneFrame(t).child(head).child(scrollArea("argus-tsk-task-body", parts, { padding: 6 })).child(bar);
  }

  /** The open block or review: what it asks or reports, its replies, and the reply field. */
  renderThread(t, task, fields) {
    const number = task.number;
    const block = task.status === "blocked" ? task.block : null;
    const review = task.status === "review" ? task.review : null;
    const waiting = block ?? review;
    const title = review ? `In Review · Round ${review.round}` : "Blocked";
    const parts = [
      h_flex()
        .gap(8)
        .items_center()
        .child(div().flex_1().font_semibold().child(title))
        .when(Boolean(waiting), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`Waiting on ${waiting?.on}`))),
    ];
    const text = (value, muted = false) => div().whitespace_normal().text_color(muted ? t.muted : t.foreground).child(value);
    const replies = (items) =>
      items.map((r, i) =>
        v_flex()
          .id(`reply-${i}`)
          .gap(2)
          .pl(8)
          .border_l(2)
          .border_color(t.border)
          .child(div().text_size(11).text_color(t.dim).child(r.by))
          .child(text(r.text)),
      );
    if (block) {
      if (block.why) parts.push(text(block.why));
      if (block.needs) parts.push(text(`Needs: ${block.needs}`, true));
      if (block.options.length > 0) {
        parts.push(
          wrapRow(
            block.options.map((option, i) =>
              chip(t, `option-${i}`, `${i + 1}  ${option}`, (_e, cx) => {
                fields.reply.set_value(option);
                fields.reply.focus();
                cx.notify();
              }),
            ),
          ).px(0),
        );
      }
      parts.push(...replies(block.replies));
    }
    if (review) {
      if (review.done) parts.push(text(review.done));
      review.checks.forEach((check, i) =>
        parts.push(
          h_flex()
            .id(`check-${i}`)
            .gap(8)
            .items_center()
            .child(
              div()
                .flex_none()
                .px(6)
                .rounded(9)
                .bg(t.raised)
                .text_size(11)
                .text_color(check.state === "failed" ? t.blocked : check.state === "passed" ? t.done : t.muted)
                .child(CHECK_LABELS[check.state] ?? check.state),
            )
            .child(div().flex_1().min_w(0).whitespace_normal().child(check.text)),
        ),
      );
      if (review.next) parts.push(text(`Next: ${review.next}`, true));
      parts.push(...replies(review.feedback));
    }
    parts.push(textBox(t, "reply", fields.reply, this.focused === "reply"));
    const ready = !this.busy && fields.reply.value().trim() !== "";
    const actions = h_flex().gap(8).justify_end();
    if (review) actions.child(button(t, "approve", "Approve", (_e, cx) => this.changeStatus(cx, number, changeFor("approve"), "Approve")));
    actions.child(button(t, "send", review ? "Send Back" : "Answer", (_e, cx) => this.submitReply(cx, number), { primary: true, enabled: ready }));
    parts.push(actions);
    if (this.flowError) {
      parts.push(text(this.flowError.message).text_color(t.blocked));
      if (this.flowError.replied) parts.push(h_flex().child(button(t, "retry", "Retry Status Change", (_e, cx) => this.retryFlow(cx), { enabled: !this.busy })));
    }
    return card(t, "thread", parts);
  }

  /** The block or review form. */
  renderCard(t, number) {
    const f = this.form;
    const labelled = (label, el) => v_flex().gap(4).child(div().text_size(11).text_color(t.muted).child(label)).child(el);
    const parts =
      this.card === "block"
        ? [
            div().font_semibold().child("Block"),
            labelled("Why", textBox(t, "why", f.why, this.focused === "why")),
            labelled("Needs", field(t, "needs", f.needs, this.focused === "needs")),
            labelled("Options, one per line", textBox(t, "options", f.options, this.focused === "options")),
          ]
        : [
            div().font_semibold().child("Request Review"),
            labelled("Done", textBox(t, "done", f.done, this.focused === "done")),
            labelled("Checks, one per line", textBox(t, "checks", f.checks, this.focused === "checks")),
            labelled("Next", field(t, "next", f.next, this.focused === "next")),
          ];
    parts.push(
      h_flex()
        .gap(8)
        .justify_end()
        .child(button(t, "card-cancel", "Cancel", (_e, cx) => this.closeCard(cx)))
        .child(button(t, "card-submit", this.card === "block" ? "Block" : "Request Review", (_e, cx) => this.submitCard(cx), { primary: true })),
    );
    return card(t, `card-${number}`, parts);
  }

  /** The status dropdown: one row per status, the current one ticked, disabled ones dimmed. */
  renderStatusMenu(t) {
    const p = props() ?? {};
    const choices = normalizeChoices(p.choices);
    const active = this.at ?? startAt(choices);
    const pickable = (choice) => choice.enabled && !choice.current;
    const rows = choices.map((choice, index) =>
      menuRow(t, `status-${choice.status}`, {
        label: choice.label,
        active: index === active,
        current: choice.current,
        enabled: choice.enabled,
        tick: this.icon("check"),
        onClick: () => {
          if (pickable(choice)) pickStatus(p, choice.status);
        },
      }),
    );
    return v_flex()
      .id("argus-tsk-status")
      .track_focus(this.handle)
      .w_full()
      .h(statusHeight(rows.length))
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        const next = menuKey(active, e.key, choices.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick" && pickable(choices[next.at])) pickStatus(p, choices[next.at].status);
        else if (next.action === "close") closeOverlay(p.overlay);
        cx.notify();
      })
      .child(scrollArea("argus-tsk-status-list", rows, { padding: MENU_PAD }));
  }

  renderSettings(t) {
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
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
      .child(subHeader(t, back, "Settings", this.icon("chevron-left")))
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

/** The task pane's frame. The pane draws its own border, so this one has none. */
function paneFrame(t) {
  return frame(t, "argus-tsk-task").rounded_none().border_0();
}

/** A status dot in the board's colors. */
function statusDot(t, status) {
  const dot = div().size(8).flex_none().rounded(4);
  switch (status) {
    case "blocked":
    case "review":
      return dot.bg(t.blocked);
    case "started":
      return dot.bg(t.working);
    case "done":
      return dot.bg(t.done);
    default:
      return dot.border_1().border_color(t.muted);
  }
}

/** A field that reads as plain text until it has the keyboard. */
function inlineField(t, id, state, focused) {
  return div()
    .id(id)
    .flex_1()
    .min_w(0)
    .h(30)
    .px(6)
    .flex()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(focused ? t.accent : t.background)
    .hover((s) => s.border_color(focused ? t.accent : t.border))
    .cursor_text()
    .child(Input.new(state).w_full().text_color(t.foreground));
}

/** Indents an element to line up with rows and section titles. */
function pad(el) {
  return h_flex().px(8).py(4).child(el);
}

/** A row of chips that wraps onto more lines. */
function wrapRow(children) {
  return h_flex().flex_wrap().gap(6).px(8).py(4).children(children);
}

/**
 * A 26 px chip button. `selected` draws it on `selected`; a disabled chip
 * takes no clicks. `icon` follows the label; `done` strikes the label out.
 */
function chip(t, id, label, onClick, { selected = false, enabled = true, icon = null, done = false } = {}) {
  return h_flex()
    .id(id)
    .h(26)
    .px(10)
    .gap(4)
    .flex_none()
    .items_center()
    .rounded(6)
    .text_size(12)
    .bg(selected ? t.selected : t.raised)
    .text_color(!enabled || done ? t.dim : t.foreground)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
    .child(div().when(done, (el) => el.line_through()).child(label))
    .when(Boolean(icon), (el) => el.child(svg(icon ?? "").size(12)));
}

/** An error line in the pane. */
function message(t, text) {
  return div().px(8).py(6).text_size(12).text_color(t.blocked).whitespace_normal().child(text);
}

/** A bordered group, for the open block or review and for the forms. */
function card(t, id, children) {
  return div()
    .px(4)
    .py(6)
    .child(v_flex().id(id).p(10).gap(8).rounded(8).border_1().border_color(t.border).bg(t.surface).children(children));
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

/**
 * Opens the status dropdown under the pointer. The popup is another copy of
 * this mod, so it gets the pane's choices, task number and owner in its props.
 */
function openStatusMenu(owner, number, choices) {
  const height = statusHeight(choices.length);
  openOverlay({ mod: MOD, props: { view: "status", owner, number, choices }, kind: "popup", width: STATUS_WIDTH, height });
}

/** Height of the status dropdown for `count` rows. */
function statusHeight(count) {
  return 2 * MENU_PAD + count * MENU_ROW;
}

/** Hands a picked status to the pane that opened the popup, then closes the popup. */
function pickStatus(p, status) {
  setShared(STATUS_PICK_KEY, { owner: p.owner, number: p.number, status, at: Date.now() });
  if (p.overlay) closeOverlay(p.overlay);
}

/** Saves a picked scope. The popup stays open, so the other choices can be set too. */
function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
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

/** The project the focused space is in, among the projects on the board, or null. */
function followedOf(rows) {
  return followedProject(
    rows.map((r) => r.project),
    followFolder(focused(), panes(), spaces()),
  );
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
