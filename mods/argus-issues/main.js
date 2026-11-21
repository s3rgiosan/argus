// The issues board in Herdr. One mod with views picked by `props().view`: the board (the
// layout's panel, with a settings page), the scope list (a popup) and an issue (a pane beside
// the terminals). Reads go through `git`, `gh` and `glab`. The mod writes nothing to a forge.

import { div, View } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { exec, home, appHome, readTextFile, window, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, focused } from "herdr";
import { randomUUID } from "crypto";
import { localFolders, revParseArgs, remoteArgs, parseRevParse, mergeProjects, followProjectKey, missingProjectKeys, newProjectKeys } from "./remote.js";
import { INTERVALS, GH_MISSING, GLAB_MISSING, normalizeSettings, commandCandidates, cliError, missingNotes, openArgs } from "./locate.js";
import { ghSearchArgs, ghListArgs, ghViewArgs, glabArgs, limitNote, GL_USERNAME_QUERY, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY } from "./forge.js";
import { issueKey, parseGhSearch, parseGhList, parseGhView, parseGlUsername, parseGlUser, parseGlProject, parseGlDetail } from "./model.js";
import { assembleBoard, normalizeBoard, normalizeScope, issuesInScope, scopeItems, scopeTitle, scopeRepos, mentionsNote, followStatus, withFolders, buildGroups, shownOrder, matchesFilter, ageText, rowDetail, assigneesText, emptyMessage, issuePaneTitle } from "./board.js";
import { SECTIONS, namesOf, commentItems, sectionSummaries, positionIn } from "./detail.js";
import { issuePane } from "./detail-view.js";
import { followFolder } from "./follow.js";
import { createGate } from "./gate.js";
import { mapPool } from "./pool.js";
import { shouldFetch, takeLock, holdsLock } from "./sync.js";
import { frame, header, subHeader, badge, iconButton, dropdownButton, hint, errorLine, scrollArea, field, footer, sectionTitle, note, segmented, menuRow, MENU_PAD, MENU_ROW } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";
import { menuKey, startAt } from "./menu.js";

const MOD = "argus-issues";
const BOARD_KEY = "argus-issues.board";
const SCOPE_KEY = "argus-issues.scope";
const SELECTED_KEY = "argus-issues.selected";
const SETTINGS_KEY = "argus-issues.settings";
const LOCK_KEY = "argus-issues.lock";
const TITLE_KEY = "argus-issues.paneTitle";
const CLI_TIMEOUT = 30_000;
const GIT_TIMEOUT = 15_000;
const POLL = 5_000;
const AGE_TICK = 60_000;
const LOCK_RETRY = 1_000;
// How many gh or glab calls run at once when listing repos.
const CLI_CONCURRENCY = 4;
const SCOPES_WIDTH = 280;
const SCOPES_HEIGHT = 420;
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

// The searches of the Show choices, with the text of their limit notes.
const GH_SEARCHES = [
  ["assigned", "issues assigned to you"],
  ["created", "issues you opened"],
  ["mentions", "issues that mention you"],
];

/**
 * The trackers the board reads. Each entry names its CLI and reads the board lists and one
 * issue; a project from an open space belongs to the entry of its `provider`. `always` reads
 * the entry without a project, because its searches cover every repo.
 */
const PROVIDERS = {
  github: { cli: "gh", always: true, read: (self, cli, projects, result, notes) => self.readGitHub(cli, projects, result, notes), detail: (self, cli, selected) => self.readGitHubIssue(cli, selected) },
  gitlab: { cli: "glab", always: false, read: (self, cli, projects, result, notes) => self.readGitLab(cli, projects, result, notes), detail: (self, cli, selected) => self.readGitLabIssue(cli, selected) },
};

/**
 * The board lives in `shared` (`argus-issues.board`), so every open copy draws one read.
 * The copy that wins the lock in `shared` runs the commands.
 */
export default class Issues extends View {
  init(_props, cx) {
    this.owner = randomUUID();
    this.view = props()?.view ?? "board";
    this.gate = createGate();
    this.force = false;
    // The project keys that caused a forced read, or null when the force has no key list.
    this.forceKeys = null;
    this.probing = false;
    this.focused = null;
    // Folder -> {folder, top, main, remote}, or null when the folder is not a repository.
    this.repoCache = new Map();
    this.located = { gh: null, glab: null };
    // GitLab host -> {setting, value}: the signed-in username, kept until the glab setting changes or a refresh.
    this.glUsers = new Map();
    // The pane's read: {key, kind: "loading"|"ok"|"error", detail, error, readAt}.
    this.shown = null;
    this.seq = 0;
    // The failed open in browser action: {key, text}, shown on that issue only.
    this.actionError = null;
    // Issue key -> {section: open} for the sections the person folded or opened.
    this.folds = new Map();
    // The icons Herdr ships that this mod can load; its own copies show until the probe ends.
    this.found = new Set();
    // Whether this copy is reading the board now.
    this.reading = false;
    // The scope list's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();

    const settings = readSettings();
    this.filterInput = this.input("filter", { placeholder: "Filter by title, number, author, label or assignee" }, () => {});
    this.filterInput.on("change", (_e, cx) => cx.notify());
    this.ghInput = this.input("gh", { placeholder: "gh (from PATH)", value: settings.gh }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.glabInput = this.input("glab", { placeholder: "glab (from PATH)", value: settings.glab }, (cx) => this.saveSettings(cx), { saveOnBlur: true });

    if (checking()) return;
    if (this.view === "scopes") this.handle.focus();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    if (this.view === "issue") {
      // The pane reads its issue again after each board read.
      cx.timer.every(POLL, (cx) => {
        const selected = readSelected();
        if (!selected || this.shown?.key !== selected.key) return;
        if (readBoard().readAt > this.shown.readAt) this.loadIssue(cx, selected);
      });
      cx.timer.every(AGE_TICK, (cx) => cx.notify());
      return;
    }
    if (this.view !== "board") return;

    this.startSync(cx);
    cx.timer.every(POLL, (cx) => {
      this.watchFolders(cx);
      this.startSync(cx);
    });
    cx.timer.every(AGE_TICK, (cx) => cx.notify());
  }

  /** A text input that tracks focus for its border. `onSubmit` runs on Enter, and on blur with `saveOnBlur`. */
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

  /** Gives the lock back when this copy goes. */
  async close() {
    this.releaseLock();
  }

  releaseLock() {
    if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
    setShared(LOCK_KEY, { owner: this.owner, until: 0 });
  }

  /** Extends the lock while this copy still holds it. */
  renewLock() {
    if (holdsLock(shared(LOCK_KEY), this.owner, Date.now())) setShared(LOCK_KEY, takeLock(this.owner, Date.now()));
  }

  startSync(cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      await this.sync(cx);
    });
  }

  /**
   * Probes the folders the last read did not see, with git only. A project key the board does
   * not have forces a read; any other folder waits for the next scheduled read.
   */
  watchFolders(cx) {
    if (this.probing) return;
    const known = new Set(readBoard().folders);
    const unseen = localFolders(spaces(), panes()).filter((folder) => !known.has(folder));
    if (unseen.length === 0) return;
    this.probing = true;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        await mapPool(unseen.filter((folder) => !this.repoCache.has(folder)), CLI_CONCURRENCY, (folder) => this.probe(folder));
        const entries = unseen.map((folder) => this.repoCache.get(folder) ?? null);
        const fresh = newProjectKeys(entries, readBoard().projects);
        if (fresh.length === 0) {
          // No new project: the board lists the probed folders at once, so Follow space stops waiting on them.
          const board = readBoard();
          const listed = withFolders(board, unseen.filter((folder) => this.repoCache.has(folder)));
          if (listed !== board) setShared(BOARD_KEY, listed);
          return;
        }
        if (!this.force) this.forceKeys = [];
        if (this.forceKeys !== null) this.forceKeys = [...new Set([...this.forceKeys, ...fresh])];
        this.force = true;
        this.startSync(cx);
      } finally {
        this.probing = false;
      }
    });
  }

  /** Asks for a read now, in this copy, even when the board looks fresh. */
  refresh(cx) {
    this.force = true;
    this.forceKeys = null;
    this.startSync(cx);
    cx.notify();
  }

  /** Reads the board into `shared` when it is older than the interval (or a refresh was asked for) and no other copy holds the lock. */
  async sync(cx) {
    if (checking() || !this.gate.start()) return;
    let read = false;
    try {
      // Another copy may have read the project that asked for this force.
      if (this.force && this.forceKeys !== null && missingProjectKeys(this.forceKeys, readBoard().projects).length === 0) {
        this.force = false;
        this.forceKeys = null;
      }
      const startedAt = Date.now();
      const fetch = shouldFetch({
        now: startedAt,
        fetchedAt: readBoard().readAt,
        lock: shared(LOCK_KEY),
        intervalMs: readSettings().interval * 60_000,
        owner: this.owner,
        force: this.force,
      });
      if (!fetch) {
        // Another copy is reading; check again once it is done.
        if (this.force) cx.timer.after(LOCK_RETRY, (cx) => this.startSync(cx));
        return;
      }

      setShared(LOCK_KEY, takeLock(this.owner, startedAt));
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      this.force = false;
      this.forceKeys = null;
      read = true;
      this.reading = true;
      cx.notify();

      const folderedBefore = new Set(readBoard().folders);
      const next = await this.readBoard(startedAt);
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      // Folders that the folder watch added to the board during the read stay on it.
      const added = readBoard().folders.filter((folder) => !folderedBefore.has(folder));
      setShared(BOARD_KEY, withFolders(next, added));
    } finally {
      this.reading = false;
      this.releaseLock();
      const again = this.gate.finish();
      if (read) cx.notify();
      if (again) this.startSync(cx);
    }
  }

  /** One read of every project and search, as the value kept under BOARD_KEY. Failures become notes; nothing throws. */
  async readBoard(startedAt) {
    const notes = [];
    const folders = localFolders(spaces(), panes());
    await mapPool(folders.filter((folder) => !this.repoCache.has(folder)), CLI_CONCURRENCY, (folder) => this.probe(folder));
    const projects = mergeProjects(folders.map((folder) => this.repoCache.get(folder)).filter((entry) => entry));
    this.renewLock();

    const result = { assigned: [], created: [], mentions: [], projectIssues: {} };
    const found = {};
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const own = projects.filter((project) => project.provider === id);
      // A CLI is only looked up when its tracker has work to do.
      found[id] = provider.always || own.length > 0 ? await this.locate(provider.cli) : null;
      if (found[id] !== null) await provider.read(this, found[id], own, result, notes);
      this.renewLock();
    }
    const count = (id) => projects.filter((project) => project.provider === id).length;
    notes.unshift(...missingNotes({ gh: found.github !== null, glab: found.gitlab !== null, githubProjects: count("github"), gitlabProjects: count("gitlab") }));
    return assembleBoard({ projects, folders, ...result, notes: [...new Set(notes)], readAt: startedAt });
  }

  /** Caches what `folder` is: a repository entry, or null. A rejected probe caches nothing. */
  async probe(folder) {
    let entry = null;
    try {
      const top = await exec("git", revParseArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
      const parsed = top.code === 0 ? parseRevParse(top.stdout) : null;
      if (parsed) {
        const origin = await exec("git", remoteArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
        const remote = origin.code === 0 ? origin.stdout.trim() : "";
        entry = { folder, top: parsed.top, main: parsed.main, remote: remote === "" ? null : remote };
      }
    } catch {
      // A probe that timed out or could not start is tried again on the next read.
      return;
    }
    this.repoCache.set(folder, entry);
  }

  /**
   * The command for `name` ("gh" or "glab"), or null when none runs. The first of the setting,
   * the bare name and the install folders whose `--version` runs wins. The result is kept per
   * setting value until the setting changes or the refresh button looks again.
   */
  locate(name) {
    const setting = readSettings()[name];
    const cached = this.located[name];
    if (cached?.setting === setting) return cached.result;
    const result = (async () => {
      for (const command of commandCandidates(setting, name, home())) {
        try {
          const reply = await exec(command, ["--version"], { timeout: CLI_TIMEOUT });
          if (reply.code === 0) return command;
        } catch {
          continue;
        }
      }
      return null;
    })();
    this.located[name] = { setting, result };
    return result;
  }

  /** Runs `command` with `args` and parses its output. A failed run or a parse error adds one note under `label` and gives null. */
  async attempt(label, command, args, parse, notes) {
    let reply;
    try {
      reply = await exec(command, args, { timeout: CLI_TIMEOUT });
    } catch (error) {
      notes.push(`${label}: ${error?.message ?? error}`);
      return null;
    }
    if (reply.code !== 0) {
      notes.push(cliError(label, reply));
      return null;
    }
    try {
      return parse(reply.stdout);
    } catch (error) {
      notes.push(`${label}: ${error?.message ?? error}`);
      return null;
    }
  }

  /** The three GitHub searches, then the open issues of each GitHub project. */
  async readGitHub(gh, projects, result, notes) {
    const searched = await Promise.all(GH_SEARCHES.map(([kind]) => this.attempt("gh", gh, ghSearchArgs(kind), parseGhSearch, notes)));
    this.renewLock();
    GH_SEARCHES.forEach(([kind, what], index) => {
      const issues = searched[index] ?? [];
      const cut = limitNote(what, issues.length);
      if (cut !== null) notes.push(cut);
      result[kind].push(...issues);
    });
    await mapPool(projects, CLI_CONCURRENCY, async (project) => {
      const issues = await this.attempt("gh", gh, ghListArgs(project.repo), (raw) => parseGhList(raw, project.repo), notes);
      this.renewLock();
      if (issues === null) return;
      const cut = limitNote(`issues of ${project.repo}`, issues.length);
      if (cut !== null) notes.push(cut);
      result.projectIssues[project.key] = issues;
    });
  }

  /** The signed-in username on a GitLab host, kept per glab setting; null when the read fails. */
  async glUsername(glab, host, notes) {
    const setting = readSettings().glab;
    const cached = this.glUsers.get(host);
    if (cached?.setting === setting) return cached.value;
    const value = await this.attempt(`glab (${host})`, glab, glabArgs(host, GL_USERNAME_QUERY), parseGlUsername, notes);
    if (value !== null) this.glUsers.set(host, { setting, value });
    return value;
  }

  /** The assigned and created lists of each GitLab host, then the open issues of each GitLab project. */
  async readGitLab(glab, projects, result, notes) {
    const hosts = [...new Set(projects.map((project) => project.host))];
    await Promise.all([
      ...hosts.map(async (host) => {
        const label = `glab (${host})`;
        const user = await this.glUsername(glab, host, notes);
        if (user === null) return;
        const lists = await this.attempt(label, glab, glabArgs(host, GL_USER_QUERY, { user }), (raw) => parseGlUser(raw, host), notes);
        if (lists === null) return;
        for (const [kind, what] of [
          ["assigned", `issues on ${host} assigned to you`],
          ["created", `issues on ${host} that you opened`],
        ]) {
          const cut = limitNote(what, lists[kind].length);
          if (cut !== null) notes.push(cut);
          result[kind].push(...lists[kind]);
        }
      }),
      mapPool(projects, CLI_CONCURRENCY, async (project) => {
        const label = `glab (${project.host})`;
        const issues = await this.attempt(label, glab, glabArgs(project.host, GL_PROJECT_QUERY, { path: project.repo }), (raw) => parseGlProject(raw, project.host, project.repo), notes);
        this.renewLock();
        if (issues === null) return;
        const cut = limitNote(`issues of ${project.repo}`, issues.length);
        if (cut !== null) notes.push(cut);
        result.projectIssues[project.key] = issues;
      }),
    ]);
  }

  openSettings(cx) {
    // Another copy may have changed these since this copy last drew them.
    const settings = readSettings();
    this.ghInput.set_value(settings.gh);
    this.glabInput.set_value(settings.glab);
    this.view = "settings";
    cx.notify();
  }

  /** Saves both command fields; a changed command forces a read. */
  saveSettings(cx) {
    const current = readSettings();
    const next = normalizeSettings({ ...current, gh: this.ghInput.value(), glab: this.glabInput.value() });
    if (next.gh === current.gh && next.glab === current.glab) return;
    setShared(SETTINGS_KEY, next);
    this.refresh(cx);
  }

  render(cx) {
    const t = theme();
    switch (this.view) {
      case "scopes":
        return this.renderScopes(t);
      case "issue":
        return this.renderIssue(t, cx);
      case "settings":
        return this.renderSettings(t);
      default:
        return this.renderBoard(t);
    }
  }

  renderBoard(t) {
    const board = readBoard();
    const scope = readScope();
    const followed = followedOf(board);
    // A new space's folder is unknown until a read or the folder watch lists it; until then, Follow space waits.
    const following = scope.where === "follow" ? followStatus(board, followFolder(focused(), panes(), spaces()), followed) : "followed";
    const unfollowed = following !== "followed";
    const text = this.filterInput.value();
    const shown = issuesInScope(board, scope, followed).filter((issue) => matchesFilter(issue, text));
    const selected = readSelected()?.key ?? null;
    const now = Date.now();

    const icon = iconResolver(MOD, this.found);
    const scopeButton = dropdownButton(t, "scope", scopeTitle(scope, board, followed), icon("chevron-down"), () => openScopes()).max_w(150);
    const refresh = iconButton(
      t,
      "refresh",
      ICON("refresh-cw"),
      (_e, cx) => {
        // Looks for gh and glab again too, in case they were installed, updated or signed in.
        this.located = { gh: null, glab: null };
        this.glUsers.clear();
        this.repoCache.clear();
        this.refresh(cx);
      },
      { busy: this.reading, tooltip: "Read again" },
    );
    const settings = iconButton(t, "settings", icon("settings"), (_e, cx) => this.openSettings(cx), { tooltip: "Settings" });
    const head = header(t, "Issues", [scopeButton, refresh, settings], { badge: badge(t, String(unfollowed ? 0 : shown.length)) });

    const parts = board.notes.map((message, index) => errorLine(t, message).id(`note-${index}`));
    const mentions = unfollowed ? null : mentionsNote(board, scope, followed);
    if (mentions !== null) parts.push(note(t, mentions).text_size(12));
    if (following === "pending") {
      parts.push(note(t, "Reading this space…"));
    } else if (unfollowed) {
      parts.push(note(t, "This space is not a GitHub or GitLab repo."));
    } else if (shown.length === 0) {
      parts.push(note(t, text.trim() === "" ? emptyMessage(board, scopeRepos(board, scope, followed)) : "Nothing matches the filter"));
    } else {
      for (const group of buildGroups(shown)) {
        parts.push(sectionTitle(t, `${group.title} · ${group.issues.length}`));
        for (const issue of group.issues) parts.push(issueRow(t, `issue-${issueKey(issue)}`, issue, issueKey(issue) === selected, now));
      }
    }

    return frame(t, "argus-issues")
      .child(head)
      .child(scrollArea("argus-issues-board", parts, { padding: 6 }))
      .child(footer(t).child(field(t, "filter", this.filterInput, this.focused === "filter")));
  }

  renderScopes(t) {
    const board = readBoard();
    const items = scopeItems(board, followedOf(board), readScope());
    const icon = iconResolver(MOD, this.found);
    const entries = [...items.show, ...items.where, ...items.projects];
    const active = this.at ?? startAt(entries);
    const item = (entry, index, indent = false) =>
      menuRow(t, `scope-${index}-${entry.key}`, {
        label: entry.label,
        indent,
        count: String(entry.count),
        active: index === active,
        current: entry.current,
        tick: icon("check"),
        // The keyboard highlight follows a click, so Up and Down start from the picked row.
        onClick: () => {
          this.at = index;
          pickScope(entry.scope);
        },
      });

    // Show and In are separate choices; picking a row keeps the list open for the other one.
    const parts = [sectionTitle(t, "Show")];
    items.show.forEach((entry, index) => parts.push(item(entry, index)));
    parts.push(sectionTitle(t, "In"));
    items.where.forEach((entry, index) => parts.push(item(entry, items.show.length + index)));
    // Each project is one more In choice, indented under All repos.
    items.projects.forEach((entry, index) => parts.push(item(entry, items.show.length + items.where.length + index, true)));
    // A popup is as tall as its content, up to the height it was opened with,
    // so the list gets an explicit height for its rows and section titles.
    const titles = 2;
    const height = Math.min(SCOPES_HEIGHT, 2 * MENU_PAD + entries.length * MENU_ROW + titles * 30);
    return v_flex()
      .id("argus-issues-scopes")
      .track_focus(this.handle)
      .w_full()
      .h(height)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        const next = menuKey(active, e.key, entries.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") pickScope(entries[next.at].scope);
        else if (next.action === "close") closeOverlay(props()?.overlay);
        cx.notify();
      })
      .child(scrollArea("argus-issues-scope-list", parts, { padding: MENU_PAD }));
  }

  renderSettings(t) {
    const settings = readSettings();
    const icon = iconResolver(MOD, this.found);
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
    const parts = [
      sectionTitle(t, "gh command"),
      h_flex().px(8).py(4).child(field(t, "gh", this.ghInput, this.focused === "gh")),
      hint(t, "Leave empty to use gh from PATH, else its usual install folders.").px(8),
      sectionTitle(t, "glab command"),
      h_flex().px(8).py(4).child(field(t, "glab", this.glabInput, this.focused === "glab")),
      hint(t, "Leave empty to use glab from PATH, else its usual install folders. Both fields save on Enter or when you leave them.").px(8),
      sectionTitle(t, "Refresh every"),
      h_flex()
        .px(8)
        .py(4)
        .child(
          segmented(
            t,
            "interval",
            INTERVALS.map((minutes) => ({ value: minutes, label: `${minutes} min` })),
            settings.interval,
            (minutes) => setShared(SETTINGS_KEY, { ...readSettings(), interval: minutes }),
          ),
        ),
      sectionTitle(t, "Comments"),
      h_flex()
        .px(8)
        .py(4)
        .child(
          segmented(
            t,
            "comments",
            [
              { value: "oldest", label: "Oldest first" },
              { value: "newest", label: "Newest first" },
            ],
            settings.comments,
            (order) => setShared(SETTINGS_KEY, { ...readSettings(), comments: order }),
          ),
        ),
    ];
    return frame(t, "argus-issues-settings")
      .child(subHeader(t, back, "Settings", icon("chevron-left")))
      .child(scrollArea("argus-issues-settings-list", parts, { padding: 6 }));
  }

  /** Reads the selected issue into the pane. A newer call wins over a read still running; the shown issue stays while it is read again. */
  loadIssue(cx, selected) {
    const seq = ++this.seq;
    const readAt = Date.now();
    const switched = this.shown?.key !== selected.key;
    if (switched) {
      this.shown = { key: selected.key, kind: "loading", detail: null, error: null, readAt };
      this.actionError = null;
    } else {
      this.shown = { ...this.shown, readAt };
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let next;
      try {
        next = { kind: "ok", detail: await this.readDetail(selected), error: null };
      } catch (error) {
        next = { kind: "error", detail: null, error: error?.message ?? String(error) };
      }
      if (seq !== this.seq) return;
      // A failed read again keeps the issue on screen, with the error under the header.
      if (next.kind === "error" && !switched && this.shown?.detail) {
        this.shown = { ...this.shown, readAt };
        this.actionError = { key: selected.key, text: next.error };
      } else {
        this.shown = { key: selected.key, readAt, ...next };
        // A good read clears the error line of an earlier failed one.
        if (next.kind === "ok" && this.actionError?.key === selected.key) this.actionError = null;
      }
      cx.notify();
    });
  }

  /** Reads one issue through its tracker's CLI; throws a readable error. */
  async readDetail(selected) {
    const provider = Object.hasOwn(PROVIDERS, selected.provider) ? PROVIDERS[selected.provider] : null;
    if (provider === null) throw new Error(`Unknown tracker: ${selected.provider}`);
    const command = await this.locate(provider.cli);
    if (command === null) throw new Error(provider.cli === "glab" ? GLAB_MISSING : GH_MISSING);
    return provider.detail(this, command, selected);
  }

  async readGitHubIssue(gh, selected) {
    const reply = await exec(gh, ghViewArgs(selected.repo, selected.number), { timeout: CLI_TIMEOUT });
    if (reply.code !== 0) throw new Error(cliError("gh", reply));
    return parseGhView(reply.stdout, selected.repo);
  }

  async readGitLabIssue(glab, selected) {
    const args = glabArgs(selected.host, GL_DETAIL_QUERY, { path: selected.repo, iid: String(selected.number) });
    const reply = await exec(glab, args, { timeout: CLI_TIMEOUT });
    if (reply.code !== 0) throw new Error(cliError("glab", reply));
    return parseGlDetail(reply.stdout, selected.host, selected.repo);
  }

  /** Opens `url` in the browser; only http and https URLs open. A failure shows under the pane header. */
  openInBrowser(cx, key, url) {
    this.actionError = null;
    cx.notify();
    const open = openArgs(window().platform, url ?? "");
    if (open === null) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        const reply = await exec(open[0], open[1]);
        if (reply.code === 0) return;
        this.actionError = { key, text: cliError(open[0], reply) };
      } catch (error) {
        this.actionError = { key, text: error?.message ?? String(error) };
      }
      cx.notify();
    });
  }

  renderIssue(t, cx) {
    const selected = readSelected();
    // A new selection arrives as a re-render; the read runs as a task.
    if (selected && this.shown?.key !== selected.key && !checking()) this.loadIssue(cx, selected);
    if (!checking()) {
      // The board comes first, because every pane copy sees the same board.
      const listed = selected ? (readBoard().issues.find((issue) => issueKey(issue) === selected.key) ?? null) : null;
      const read = this.shown?.key === selected?.key ? (this.shown?.detail?.issue ?? null) : null;
      shareTitle(cx, issuePaneTitle(listed ?? read));
    }

    const empty = (text) => frame(t, "argus-issues-issue").rounded_none().border_0().child(note(t, text));
    if (!selected) return empty("Pick an issue on the board.");
    const shown = this.shown;
    if (!shown || shown.key !== selected.key || shown.kind === "loading") return empty("Loading…");
    if (shown.kind === "error") {
      return frame(t, "argus-issues-issue").rounded_none().border_0().child(note(t, "Could not read this issue.")).child(errorLine(t, shown.error ?? ""));
    }

    const detail = shown.detail;
    const key = shown.key;
    const board = readBoard();
    const position = positionIn(shownOrder(board, readScope(), followedOf(board)), key);
    const folds = this.folds.get(key) ?? {};
    const open = new Set(SECTIONS.map(([id]) => id).filter((id) => folds[id] !== false));
    // Moves to a neighbour in the board's order, as a row click does.
    const go = (target) => {
      const next = target === null ? null : board.issues.find((issue) => issueKey(issue) === target);
      if (next) selectIssue(next);
    };
    const view = {
      detail,
      names: namesOf(detail),
      comments: commentItems(detail, readSettings().comments),
      summaries: sectionSummaries(detail),
      open,
      position,
      error: this.actionError?.key === key ? this.actionError.text : null,
      now: Date.now(),
      age: ageText,
      icon: ICON,
    };
    const on = {
      toggle: (id, cx) => {
        this.folds.set(key, { ...folds, [id]: !open.has(id) });
        cx.notify();
      },
      prev: () => go(position?.prev ?? null),
      next: () => go(position?.next ?? null),
      openBrowser: (cx) => this.openInBrowser(cx, key, detail.issue.url),
      // A link in the description or a comment; only http and https open.
      openLink: (url, cx) => this.openInBrowser(cx, key, url),
    };
    return issuePane(t, view, on);
  }
}

/** A 44 px board row, two lines. Click opens the issue pane. */
function issueRow(t, id, issue, selected, now) {
  const people = assigneesText(issue);
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
    .on_click(() => openIssue(issue))
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`#${issue.number}`))
        .child(div().flex_1().min_w(0).truncate().child(issue.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ageText(issue.updatedAt, now))),
    )
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(rowDetail(issue)))
        .when(people !== "", (el) => el.child(div().flex_none().max_w(120).truncate().child(people))),
    );
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

/** Sets the scope; the list stays open so the other choice can be picked too. Escape or a click outside closes it. */
function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
}

/** Makes `issue` the selected issue, which every issue pane shows. */
function selectIssue(issue) {
  setShared(SELECTED_KEY, { key: issueKey(issue), provider: issue.provider, host: issue.host, repo: issue.repo, number: issue.number });
}

/** Selects an issue and shows it: focuses this mod's pane in the shown tab, or splits the tab's focused pane to the right to open one. */
function openIssue(issue) {
  selectIssue(issue);
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
  run("pane.split", { ...(target ? { pane: target.pane } : {}), direction: "right", mod: MOD, props: { view: "issue" } });
}

function readSettings() {
  return normalizeSettings(shared(SETTINGS_KEY));
}

function readScope() {
  return normalizeScope(shared(SCOPE_KEY));
}

/** The project key of the focused space, or null. */
function followedOf(board) {
  return followProjectKey(board.projects, followFolder(focused(), panes(), spaces()));
}

/** @returns {{key: string, provider: string, host: string, repo: string, number: number} | null} */
function readSelected() {
  const v = shared(SELECTED_KEY);
  if (!v || typeof v !== "object") return null;
  const ok = typeof v.key === "string" && typeof v.provider === "string" && typeof v.host === "string" && typeof v.repo === "string" && Number.isInteger(v.number);
  return ok ? v : null;
}

/** The board all copies share. */
function readBoard() {
  return normalizeBoard(shared(BOARD_KEY));
}

/** Shares the title the Argus pane header shows for this mod's panes. A write renders every mod again, so only a changed title is written, after this render. */
function shareTitle(cx, title) {
  if (shared(TITLE_KEY) === title) return;
  cx.spawn(async (cx) => {
    await cx.sleep(0);
    if (shared(TITLE_KEY) !== title) setShared(TITLE_KEY, title);
  });
}
