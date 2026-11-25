// Claude plan usage for every Claude Code profile on this computer, one
// section per account. Usage comes from Claude Code itself through usage.sh, so the
// mod never touches a sign-in token.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, appHome, readTextFile, checking, theme, shared, setShared, props, closeOverlay, notify } from "herdr";
import { randomUUID } from "crypto";
import { discover, visibleProfiles } from "./accounts.js";
import { expandHome, tildePath } from "./paths.js";
import { openInBrowser, openModPane, createInputs } from "./pane.js";
import { profileIO } from "./profile-io.js";
import { parseReply, mergeEntry, pace, paceText } from "./usage.js";
import { formatDuration, formatAgo } from "./format.js";
import { normalizeSettings, isHidden, toggleHidden, addExtra, removeExtra, setName, pendingMoves, INTERVALS } from "./settings.js";
import { createGate } from "./gate.js";
import { shouldFetch, takeLock, holdsLock, lockNeedsRenewal, releasedLock } from "./sync.js";
import { accountTitle } from "./title.js";
import { dueAlerts } from "./alerts.js";
import { frame, header, subHeader, iconButton, fieldLabel, row, scrollArea, field, button, footer, sectionTitle, note, errorLine, meter, toggle, commandField, intervalPicker } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";

const SETTINGS_KEY = "argus-claude-usage.settings";
const FOLDED_KEY = "argus-claude-usage.folded";
const DATA_KEY = "argus-claude-usage.data";
const LOCK_KEY = "argus-claude-usage.lock";
const MINUTE = 60_000;
const TICK = 30_000;
const DISCOVERY_TTL = 60 * MINUTE;
const EXEC_TIMEOUT = 25_000;
const STATUS_URL = "https://status.anthropic.com";
const ALERTS_KEY = "argus-claude-usage.alerts";
const ALERT_THRESHOLD = 80;
const MOD = "argus-claude-usage";
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

/**
 * Every open copy (a pane, a popup) draws the usage kept in `shared`. The
 * copy that wins the lock in `shared` runs Claude Code, writes the results
 * there, and posts the limit toasts, so at most one
 * `claude` process runs.
 */
export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.owner = randomUUID();
    this.view = "usage";
    this.gate = createGate();
    this.force = false;
    this.nameInputs = new Map();

    this.focused = null;
    // Makes the text inputs; each one tracks focus in `this.focused`.
    this.input = createInputs(this);

    this.folderInput = this.input("folder", { placeholder: "~/path/to/profile" }, (cx) => this.addFolder(cx));
    this.claudeInput = this.input("claude", { placeholder: "claude (from PATH)", value: readSettings().claude }, (cx) => this.saveClaudeCommand(cx), {
      saveOnBlur: true,
    });

    // The icons Herdr ships that this panel can load; the panel's own copies show until the probe ends.
    this.found = new Set();
    if (checking()) return;
    moveOldKeys();

    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    this.startSync(cx);
    cx.timer.every(TICK, (cx) => {
      if (this.view === "settings" && this.ensureNameInputs()) cx.notify();
      this.startSync(cx);
    });
    cx.timer.every(MINUTE, (cx) => cx.notify());
  }

  /** Gives the lock back when this copy goes, so another copy can fetch at once. */
  async close() {
    this.releaseLock();
  }

  /** Clears the account in progress and frees the lock, when this copy holds it. */
  releaseLock() {
    if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
    writeData({ fetching: null });
    setShared(LOCK_KEY, releasedLock(this.owner));
  }

  /** Starts a sync in a task. */
  startSync(cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      await this.sync(cx);
    });
  }

  /**
   * Fetches usage when the shared data is stale or a refresh was asked for,
   * and no other copy is fetching.
   */
  async sync(cx) {
    if (checking() || !this.gate.start()) return;

    let fetched = false;
    try {
      const settings = readSettings();
      const data = readData();
      const startedAt = Date.now();
      // A refresh asked for "in the future" means the clock stepped back; the
      // interval check still covers that case.
      const force = this.force || (data.requestedAt > data.fetchedAt && data.requestedAt <= startedAt + MINUTE);
      const fetch = shouldFetch({
        now: startedAt,
        fetchedAt: data.fetchedAt,
        lock: shared(LOCK_KEY),
        intervalMs: settings.interval * MINUTE,
        owner: this.owner,
        force,
      });
      if (!fetch) return;

      setShared(LOCK_KEY, takeLock(this.owner, startedAt));
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      this.force = false;

      fetched = true;
      // A forced refresh reads the profiles again; so does a change of the extra folders.
      const extraKey = JSON.stringify(settings.extra ?? []);
      // An empty result can come from a failed read, so the next sync looks again.
      if (force || this.discovered?.extraKey !== extraKey || this.discovered.profiles.length === 0 || startedAt - this.discovered.at >= DISCOVERY_TTL) {
        this.discovered = { extraKey, at: startedAt, profiles: await discover(profileIO(), { extra: settings.extra }) };
      }
      const profiles = this.discovered.profiles;
      const folders = new Set(profiles.map((profile) => profile.folder));
      const kept = Object.fromEntries(Object.entries(readData().byFolder).filter(([folder]) => folders.has(folder)));
      writeData({ profiles, byFolder: kept });
      if (this.view === "settings" && this.ensureNameInputs()) cx.notify();

      for (const profile of visibleProfiles(profiles, settings.hidden, home())) {
        const checkedAt = Date.now();
        if (!holdsLock(shared(LOCK_KEY), this.owner, checkedAt)) return;
        if (lockNeedsRenewal(shared(LOCK_KEY), this.owner, checkedAt)) setShared(LOCK_KEY, takeLock(this.owner, checkedAt));
        writeData({ fetching: profile.folder });

        const reply = await fetchUsage(profile, settings);
        // Another copy may have taken over while Claude Code ran.
        if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
        const now = Date.now();
        const entry = mergeEntry(readData().byFolder[profile.folder], reply, now, settings.interval * MINUTE * 2 + MINUTE);
        writeData({ fetching: null, byFolder: { ...readData().byFolder, [profile.folder]: entry } });
      }

      writeData({ fetchedAt: startedAt, fetching: null });
      setShared(LOCK_KEY, releasedLock(this.owner));
      announce(settings);
    } finally {
      this.releaseLock();
      const again = this.gate.finish();
      if (fetched) cx.notify();
      if (again) this.startSync(cx);
    }
  }

  /** Asks every copy for a fresh fetch; this copy tries first. */
  requestRefresh(cx) {
    this.force = true;
    writeData({ requestedAt: Date.now() });
    this.startSync(cx);
    cx.notify();
  }

  render() {
    const t = theme();
    return this.view === "settings" ? this.renderSettings(t) : this.renderUsagePanel(t);
  }

  renderUsagePanel(t) {
    const fetching = Boolean(readData().fetching);
    const icon = iconResolver(MOD, this.found);
    const actions = [
      iconButton(t, "refresh", ICON("refresh-cw"), (_e, cx) => this.requestRefresh(cx), { busy: fetching, tooltip: "Refresh" }),
      ...(props()?.overlay ? [iconButton(t, "as-pane", icon("panel-right"), () => openAsPane(), { tooltip: "Open as a pane" })] : []),
      iconButton(t, "settings", icon("settings"), (_e, cx) => this.openSettings(cx), { tooltip: "Settings" }),
    ];
    const link = (id, label, url) =>
      row(t, id)
        .cursor_pointer()
        .text_size(12)
        .text_color(t.muted)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => openInBrowser(cx, url))
        .child(label);

    return frame(t, "argus-claude-usage")
      .child(header(t, "Claude usage", actions))
      .child(scrollArea("argus-claude-usage-list", [this.renderAccounts(t)].flat(), { padding: 6 }))
      .child(footer(t).p(6).gap(2).child(link("status", "Status page", STATUS_URL)));
  }

  renderAccounts(t) {
    const settings = readSettings();
    const data = readData();
    const dir = home();
    const profiles = visibleProfiles(data.profiles, settings.hidden, dir);

    if (data.profiles.length === 0) return note(t, data.fetchedAt > 0 ? "No Claude Code accounts found" : "Loading…");
    if (profiles.length === 0) return note(t, "All accounts hidden");

    const entries = freshEntries(data, settings, Date.now());
    const folded = new Set(readFolded());
    return profiles.map((profile, index) =>
      this.renderAccount(t, profile, index, entries[profile.folder] ?? null, data.fetching === profile.folder, folded.has(profile.folder), index > 0),
    );
  }

  renderAccount(t, profile, index, entry, loading, isFolded, separated) {
    const reply = entry?.reply ?? null;
    const title = accountTitle(profile, readSettings().names, home());

    const head = h_flex()
      .id(`account-head-${index}`)
      .px(8)
      .py(6)
      .gap(8)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        toggleFolded(profile.folder);
        cx.notify();
      })
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().font_semibold().child(title))
          .when(Boolean(profile.email) && profile.email !== title, (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(profile.email))),
      )
      .child(div().flex_none().text_size(12).text_color(t.muted).child(reply?.plan ?? ""));

    const section = v_flex()
      .id(`account-${index}`)
      .flex_none()
      .gap(4)
      .pb(6)
      .when(separated, (el) => el.pt(6).border_t(1).border_color(t.border))
      .child(head);
    if (isFolded) return section;
    if (!reply) return section.child(note(t, "Loading…"));
    if (reply.state !== "ok") return section.child(div().px(8).text_size(12).text_color(t.muted).child(longState(reply)));
    const parts = renderUsage(t, reply, entry.updatedAt, loading);
    if (entry.lastError) parts.splice(1, 0, errorLine(t, `Last refresh failed · ${entry.lastError.message} · ${formatAgo(Date.now() - entry.lastError.at)}`));
    return section.children(parts);
  }

  openSettings(cx) {
    // Another copy may have changed these since this copy last drew them.
    const settings = readSettings();
    const dir = home();
    this.claudeInput.set_value(settings.claude);
    for (const [folder, input] of this.nameInputs) input.set_value(settings.names[tildePath(folder, dir)] ?? "");
    this.ensureNameInputs();
    this.view = "settings";
    cx.notify();
  }

  /**
   * Makes the Display name field of every known profile that has none yet.
   * Herdr refuses `InputState.new` during render, so this runs from event
   * handlers, timers and tasks. Returns whether it made any.
   */
  ensureNameInputs() {
    let made = false;
    for (const profile of readData().profiles) {
      if (this.nameInputs.has(profile.folder)) continue;
      this.nameInputs.set(profile.folder, this.makeNameInput(profile));
      made = true;
    }
    return made;
  }

  makeNameInput(profile) {
    const dir = home();
    const input = this.input(
      `name:${profile.folder}`,
      { placeholder: profile.label, value: readSettings().names[tildePath(profile.folder, dir)] ?? "" },
      (cx) => {
        const next = setName(readSettings(), profile.folder, input.value(), home());
        if (JSON.stringify(next.names) !== JSON.stringify(readSettings().names)) this.saveSettings(next, cx);
      },
      { saveOnBlur: true },
    );
    return input;
  }

  /** Saves settings; `refetch` also asks for fresh usage. */
  saveSettings(next, cx, { refetch = false } = {}) {
    setShared(SETTINGS_KEY, next);
    if (refetch) this.requestRefresh(cx);
    cx.notify();
  }

  toggleAccount(folder, cx) {
    const next = toggleHidden(readSettings(), folder, home());
    const shownWithoutData = !isHidden(next, folder, home()) && !readData().byFolder[folder];
    this.saveSettings(next, cx, { refetch: shownWithoutData });
  }

  addFolder(cx) {
    const settings = readSettings();
    const next = addExtra(settings, this.folderInput.value(), home());
    this.folderInput.set_value("");
    if (next !== settings) this.saveSettings(next, cx, { refetch: true });
    else cx.notify();
  }

  saveClaudeCommand(cx) {
    const value = this.claudeInput.value().trim();
    const settings = readSettings();
    if (value === settings.claude) return;
    this.saveSettings({ ...settings, claude: value }, cx, { refetch: true });
  }

  renderSettings(t) {
    const dir = home();
    const settings = readSettings();
    const profiles = readData().profiles;
    const icon = iconResolver(MOD, this.found);
    const back = (_e, cx) => {
      this.view = "usage";
      cx.notify();
    };

    const parts = [sectionTitle(t, "Accounts")];
    if (profiles.length === 0) parts.push(note(t, "No Claude Code accounts found"));
    profiles.forEach((profile, index) => {
      const shown = !isHidden(settings, profile.folder, dir);
      parts.push(
        row(t, `account-toggle-${index}`)
          .cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => this.toggleAccount(profile.folder, cx))
          .child(div().flex_1().min_w(0).truncate().text_color(shown ? t.foreground : t.muted).child(profile.label))
          .child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.dim).child(tildePath(profile.folder, dir)))
          .child(toggle(t, `account-switch-${index}`, shown, (_e, cx) => {
            cx.stop_propagation();
            this.toggleAccount(profile.folder, cx);
          })),
      );
      // A folder found after settings opened gets its field on the next tick.
      const input = this.nameInputs.get(profile.folder);
      if (input) {
        parts.push(
          h_flex()
            .px(8)
            .pb(4)
            .pl(8)
            .gap(8)
            .items_center()
            .child(fieldLabel(t, "Display name").flex_none())
            .child(field(t, `name-${index}`, input, this.focused === `name:${profile.folder}`)),
        );
      }
    });

    parts.push(sectionTitle(t, "Added folders"));
    settings.extra.forEach((entry, index) => {
      parts.push(
        row(t, `extra-${index}`)
          .child(div().flex_1().min_w(0).truncate().child(entry))
          .child(
            div()
              .id(`remove-${index}`)
              .flex_none()
              .text_size(12)
              .cursor_pointer()
              .text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => this.saveSettings(removeExtra(readSettings(), entry), cx, { refetch: true }))
              .child("Remove"),
          ),
      );
    });
    parts.push(
      h_flex()
        .px(8)
        .py(4)
        .gap(8)
        .items_center()
        .child(field(t, "folder", this.folderInput, this.focused === "folder"))
        .child(button(t, "add-folder", "Add", (_e, cx) => this.addFolder(cx))),
    );

    parts.push(...intervalPicker(t, INTERVALS, settings.interval, (minutes, cx) => this.saveSettings({ ...readSettings(), interval: minutes }, cx)));
    parts.push(...commandField(t, "claude", "Claude command", this.claudeInput, this.focused === "claude", "Leave empty to use claude from PATH. Saved on Enter or when you leave the field."));

    return frame(t, "argus-claude-usage-settings")
      .child(subHeader(t, back, "Settings", icon("chevron-left")))
      .child(scrollArea("argus-claude-usage-settings-list", parts, { padding: 6 }));
  }
}

function renderUsage(t, reply, updatedAt, loading) {
  const now = Date.now();
  const parts = [
    h_flex()
      .px(8)
      .gap(6)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .when(loading, (el) => el.child(svg(ICON("refresh-cw")).size(11).flex_none().spin(900)))
      .child(`Updated ${formatAgo(now - updatedAt)}`),
  ];

  reply.windows.forEach((window) => parts.push(renderWindow(t, window, now)));

  if (reply.surfaces.length > 0) {
    parts.push(sectionTitle(t, "This week by surface"));
    reply.surfaces.forEach((surface) => {
      parts.push(
        h_flex()
          .px(8)
          .h(22)
          .gap(8)
          .items_center()
          .text_size(12)
          .child(div().w(84).flex_none().truncate().text_color(t.muted).child(surface.label))
          .child(meter(t, surface.percent).flex_1())
          .child(div().w(34).flex_none().text_color(t.muted).child(`${Math.round(surface.percent)}%`)),
      );
    });
  }

  if (reply.extra) {
    parts.push(
      h_flex()
        .px(8)
        .pt(6)
        .justify_between()
        .text_size(12)
        .child(div().text_color(t.muted).child(reply.extra.enabled ? "Extra usage this month" : "Extra usage"))
        .child(div().child(extraText(reply.extra))),
    );
  }

  return parts;
}

function longState(reply) {
  switch (reply.state) {
    case "signed-out":
      return "Open Claude with this account to sign in";
    case "no-limits":
      return "No plan limits for this account";
    default:
      return `Usage unavailable · ${reply.reason ?? "unknown error"}`;
  }
}

/** Shared usage with entries too old to trust left out (after a restart, say). */
function freshEntries(data, settings, now) {
  const maxAge = settings.interval * MINUTE * 2 + MINUTE;
  return Object.fromEntries(Object.entries(data.byFolder).filter(([, entry]) => now - (entry?.updatedAt ?? 0) <= maxAge));
}

/** Opens the panel as a pane beside the terminals and closes this popup. */
function openAsPane() {
  openModPane("argus-claude-usage");
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
}

/** Posts toasts for limits near their end. */
function announce(settings) {
  const data = readData();
  const dir = home();
  const now = Date.now();
  const profiles = visibleProfiles(data.profiles, settings.hidden, dir);
  const entries = freshEntries(data, settings, now);

  const sent = shared(ALERTS_KEY);
  const { alerts, sent: next } = dueAlerts(profiles, entries, sent && typeof sent === "object" ? sent : {}, {
    threshold: ALERT_THRESHOLD,
    names: settings.names,
    home: dir,
    now,
  });
  setShared(ALERTS_KEY, next);
  for (const alert of alerts) notify({ title: alert.title, body: alert.body, level: "warning" });
}

/** Copies settings, folds and sent alerts stored under the `claude-usage.` keys to this mod's keys. */
function moveOldKeys() {
  for (const [key, value] of pendingMoves(shared, "claude-usage.", "argus-claude-usage.", ["settings", "folded", "alerts"])) {
    setShared(key, value);
  }
}

function readSettings() {
  return normalizeSettings(shared(SETTINGS_KEY));
}

/** The usage all copies share. */
function readData() {
  const value = shared(DATA_KEY);
  const v = value && typeof value === "object" ? value : {};
  return {
    profiles: Array.isArray(v.profiles) ? v.profiles : [],
    byFolder: v.byFolder && typeof v.byFolder === "object" ? v.byFolder : {},
    fetchedAt: Number.isFinite(v.fetchedAt) ? v.fetchedAt : 0,
    requestedAt: Number.isFinite(v.requestedAt) ? v.requestedAt : 0,
    fetching: typeof v.fetching === "string" ? v.fetching : null,
  };
}

function writeData(changes) {
  setShared(DATA_KEY, { ...readData(), ...changes });
}

function renderWindow(t, window, now) {
  const left = Math.round(100 - window.used);
  const remaining = window.resetsAt === null ? null : window.resetsAt - now;
  const resets = remaining === null ? "" : remaining > 0 ? `Resets in ${formatDuration(remaining)}` : "Resets soon";
  const p = pace(window, now);
  const text = paceText(p);

  return v_flex()
    .px(8)
    .py(4)
    .gap(4)
    .child(
      h_flex()
        .justify_between()
        .gap(8)
        .text_size(12)
        .child(div().truncate().font_semibold().child(`${window.label} ${left}% left`))
        .child(div().flex_none().text_color(t.muted).child(resets)),
    )
    .child(meter(t, 100 - window.used, p ? p.timeLeft : null))
    .when(Boolean(text), (el) => el.child(div().text_size(11).text_color(t.muted).child(text)));
}

function extraText(extra) {
  if (!extra.enabled) return "Off";
  if (extra.used && extra.limit) return `${extra.used} of ${extra.limit}`;
  return extra.used ?? "On";
}

/** Runs usage.sh for one profile and turns its result into a reply. */
async function fetchUsage(profile, settings) {
  const script = `${appHome()}/mods/argus-claude-usage/usage.sh`;
  const command = settings.claude ? [expandHome(settings.claude, home())] : [];
  const args = profile.isDefault
    ? ["-u", "CLAUDE_CONFIG_DIR", "sh", script, ...command]
    : [`CLAUDE_CONFIG_DIR=${profile.folder}`, "sh", script, ...command];

  let result;
  try {
    result = await exec("/usr/bin/env", args, { timeout: EXEC_TIMEOUT });
  } catch {
    return errorReply("Could not run Claude Code");
  }

  switch (result.code) {
    case 0:
      return parseReply(result.stdout);
    case 127:
      return errorReply("Claude Code not found");
    case 1:
      return errorReply("No usage reply");
    default:
      return errorReply(`usage.sh exited with ${result.code}`);
  }
}

function errorReply(reason) {
  return { state: "error", reason, plan: null, windows: [], surfaces: [], extra: null };
}

function readFolded() {
  const value = shared(FOLDED_KEY);
  return Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
}

function toggleFolded(folder) {
  const folded = new Set(readFolded());
  if (folded.has(folder)) folded.delete(folder);
  else folded.add(folder);
  setShared(FOLDED_KEY, [...folded]);
}
