// The pull request board in Herdr. One mod with views picked by `props().view`:
// the board (the layout's panel, with a settings page), the scope list (a popup)
// and a pull request (a pane beside the terminals). Reads go through `git`, `gh` and `glab`.

import { div, svg, View } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { exec, home, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, focused } from "herdr";
import { randomUUID } from "crypto";
import { localFolders, revParseArgs, remoteArgs, parseRevParse, mergeProjects, followProjectKey, projectKey } from "./remote.js";
import { INTERVALS, normalizeSettings, commandCandidates, cliError, missingNotes } from "./locate.js";
import { ghLoginArgs, ghSearchArgs, ghListArgs, ghViewArgs, glabArgs, GL_USER_QUERY, GL_PROJECT_QUERY } from "./forge.js";
import { parseGhSearch, parseGhList, parseGhDetail, parseGlabUser, parseGlabProject, prKey } from "./model.js";
import { assembleBoard, normalizeBoard, pickPairs, normalizeScope, prsInScope, scopeItems, scopeTitle, buildGroups, matchesFilter, ageText, checksText, reviewLabel, shortRepo } from "./board.js";
import { followFolder } from "./follow.js";
import { createGate } from "./gate.js";
import { shouldFetch, takeLock, holdsLock } from "./sync.js";
import { frame, header, iconButton, row, scrollArea, field, footer, sectionTitle, note } from "./ui.js";

const BOARD_KEY = "argus-pull-requests.board";
const SCOPE_KEY = "argus-pull-requests.scope";
const SELECTED_KEY = "argus-pull-requests.selected";
const SETTINGS_KEY = "argus-pull-requests.settings";
const LOCK_KEY = "argus-pull-requests.lock";
const MOD = "argus-pull-requests";
const CLI_TIMEOUT = 30_000;
const GIT_TIMEOUT = 15_000;
const POLL = 5_000;
const AGE_TICK = 60_000;
const LOCK_RETRY = 1_000;
const SCOPES_WIDTH = 280;
const SCOPES_HEIGHT = 420;
const ICON = (name) => `mods/argus-pull-requests/icons/${name}.svg`;

/**
 * The board lives in `shared` (`argus-pull-requests.board`), so every open copy draws one
 * read. The copy that wins the lock in `shared` runs the commands.
 */
export default class PullRequests extends View {
  init(_props, cx) {
    this.owner = randomUUID();
    this.view = props()?.view ?? "board";
    this.gate = createGate();
    this.force = false;
    this.focused = null;
    // Folder -> {folder, top, main, remote}, or null when the folder is not a repository.
    this.repoCache = new Map();
    this.located = { gh: null, glab: null };
    this.login = null;

    const settings = readSettings();
    this.filterInput = this.input("filter", { placeholder: "Filter by title, number, author or branch" }, () => {});
    this.filterInput.on("change", (_e, cx) => cx.notify());
    this.ghInput = this.input("gh", { placeholder: "gh (from PATH)", value: settings.gh }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.glabInput = this.input("glab", { placeholder: "glab (from PATH)", value: settings.glab }, (cx) => this.saveSettings(cx), { saveOnBlur: true });

    if (checking() || this.view !== "board") return;

    this.startSync(cx);
    cx.timer.every(POLL, (cx) => {
      const board = readBoard();
      const known = new Set(board.folders);
      if (localFolders(spaces(), panes()).some((folder) => !known.has(folder))) this.force = true;
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

  /** Asks for a read now, in this copy, even when the board looks fresh. */
  refresh(cx) {
    this.force = true;
    this.startSync(cx);
    cx.notify();
  }

  /**
   * Reads the board into `shared` when it is older than the interval (or a
   * refresh was asked for) and no other copy holds the lock.
   */
  async sync(cx) {
    if (checking() || !this.gate.start()) return;

    let read = false;
    try {
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
      read = true;

      const next = await this.readBoard(startedAt);
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      setShared(BOARD_KEY, next);
    } finally {
      this.releaseLock();
      const again = this.gate.finish();
      if (read) cx.notify();
      if (again) this.startSync(cx);
    }
  }

  /**
   * One read of every project and search, as the value kept under BOARD_KEY.
   * Failures become notes on the board; nothing throws.
   */
  async readBoard(startedAt) {
    const notes = [];
    const folders = localFolders(spaces(), panes());

    await Promise.all(folders.filter((folder) => !this.repoCache.has(folder)).map((folder) => this.probe(folder)));
    const entries = folders.map((folder) => this.repoCache.get(folder)).filter((entry) => entry);
    const projects = mergeProjects(entries);
    this.renewLock();

    const gitHub = projects.filter((project) => project.provider === "github");
    const gitLab = projects.filter((project) => project.provider === "gitlab");
    const [gh, glab] = await Promise.all([this.locate("gh"), this.locate("glab")]);
    notes.push(...missingNotes({ gh: gh !== null, glab: glab !== null, githubProjects: gitHub.length, gitlabProjects: gitLab.length }));

    const result = { needsReview: [], mine: [], projectPrs: {} };
    if (gh !== null) {
      await this.readGitHub(gh, gitHub, result, notes);
      this.renewLock();
    }
    if (glab !== null && gitLab.length > 0) {
      await this.readGitLab(glab, gitLab, result, notes);
      this.renewLock();
    }

    return assembleBoard({ projects, folders, needsReview: result.needsReview, mine: result.mine, projectPrs: result.projectPrs, notes, readAt: startedAt });
  }

  /** Caches what `folder` is: a repository entry, or null. */
  async probe(folder) {
    let entry = null;
    try {
      const top = await exec("git", revParseArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
      const parsed = top.code === 0 ? parseRevParse(top.stdout) : null;
      if (parsed) {
        let remote = null;
        try {
          const origin = await exec("git", remoteArgs(), { cwd: folder, timeout: GIT_TIMEOUT });
          if (origin.code === 0 && origin.stdout.trim() !== "") remote = origin.stdout.trim();
        } catch {
          remote = null;
        }
        entry = { folder, top: parsed.top, main: parsed.main, remote };
      }
    } catch {
      entry = null;
    }
    this.repoCache.set(folder, entry);
  }

  /**
   * The command for `name` ("gh" or "glab"), or null when none runs. The first
   * of the setting, the bare name and the install folders whose `--version`
   * runs wins. A found command is kept per setting value; a missing one is looked up again.
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
    result.then((found) => {
      if (found === null && this.located[name]?.result === result) this.located[name] = null;
    });
    return result;
  }

  /**
   * Runs `command` with `args` and parses its output. A failed run or a parse
   * error adds one note under `label` and gives null.
   */
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

  /** The signed-in GitHub login, kept per gh command setting. */
  async ghLogin(gh, notes) {
    const setting = readSettings().gh;
    if (this.login?.setting === setting) return this.login.value;
    const value = await this.attempt("gh", gh, ghLoginArgs(), (text) => {
      const login = text.trim();
      if (login === "") throw new Error("no login returned");
      return login;
    }, notes);
    if (value !== null) this.login = { setting, value };
    return value;
  }

  /** Searches, lists and fills in GitHub pull requests into `result`. */
  async readGitHub(gh, projects, result, notes) {
    const login = await this.ghLogin(gh, notes);
    const [needsPairs, minePairs] = await Promise.all([
      this.attempt("gh", gh, ghSearchArgs("needsReview"), parseGhSearch, notes),
      login === null ? null : this.attempt("gh", gh, ghSearchArgs("mine", login), parseGhSearch, notes),
    ]);
    const pairs = [...(needsPairs ?? []), ...(minePairs ?? [])];

    // Every project repo plus the repos the searches name, each listed once.
    const repos = new Map();
    for (const project of projects) repos.set(projectKey(project), project.repo);
    for (const pair of pairs) if (!repos.has(projectKey(pair))) repos.set(projectKey(pair), pair.repo);
    const listed = await Promise.all(
      [...repos].map(async ([key, repo]) => [key, await this.attempt("gh", gh, ghListArgs(repo), (text) => parseGhList(text, repo), notes)]),
    );
    const all = [];
    for (const [key, prs] of listed) {
      if (prs === null) continue;
      all.push(...prs);
      if (projects.some((project) => project.key === key)) result.projectPrs[key] = prs;
    }

    const pick = async (list) => {
      const { found, missing } = pickPairs(all, list);
      const filled = await Promise.all(
        missing.map((pair) => this.attempt("gh", gh, ghViewArgs(pair.repo, pair.number), (text) => parseGhDetail(text, pair.repo).pr, notes)),
      );
      return [...found, ...filled.filter((pr) => pr !== null)];
    };
    result.needsReview.push(...(await pick(needsPairs ?? [])));
    result.mine.push(...(await pick(minePairs ?? [])));
  }

  /** Reads GitLab merge requests per host and per project into `result`. */
  async readGitLab(glab, projects, result, notes) {
    const hosts = [...new Set(projects.map((project) => project.host))];
    await Promise.all([
      ...hosts.map(async (host) => {
        const user = await this.attempt(`glab (${host})`, glab, glabArgs(host, GL_USER_QUERY), (text) => parseGlabUser(text, host), notes);
        if (user === null) return;
        result.needsReview.push(...user.needsReview);
        result.mine.push(...user.mine);
      }),
      ...projects.map(async (project) => {
        const prs = await this.attempt(
          `glab (${project.host})`,
          glab,
          glabArgs(project.host, GL_PROJECT_QUERY, { path: project.repo }),
          (text) => parseGlabProject(text, project.host),
          notes,
        );
        if (prs !== null) result.projectPrs[project.key] = prs;
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
      case "pr":
        return this.renderPr(t);
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
    const unfollowed = scope.kind === "follow" && followed === null;
    const text = this.filterInput.value();
    const shown = prsInScope(board, scope, followed).filter((pr) => matchesFilter(pr, text));
    const selected = readSelected()?.key ?? null;
    const now = Date.now();

    const scopeButton = h_flex()
      .id("scope")
      .h(26)
      .px(8)
      .gap(4)
      .flex_none()
      .items_center()
      .rounded(6)
      .max_w(150)
      .text_size(12)
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openScopes())
      .child(div().min_w(0).truncate().child(scopeTitle(scope, board, followed)))
      .child(svg(ICON("chevron-down")).size(12).flex_none());
    const head = header(t, "Pull requests", [
      scopeButton,
      div().flex_none().text_size(11).text_color(t.dim).child(String(unfollowed ? 0 : shown.length)),
      iconButton(t, "refresh", ICON("refresh-cw"), (_e, cx) => {
        // Looks for gh and glab again too, in case they were installed or updated.
        this.located = { gh: null, glab: null };
        this.login = null;
        this.refresh(cx);
      }),
      iconButton(t, "settings", ICON("settings"), (_e, cx) => this.openSettings(cx)),
    ]);

    const parts = board.notes.map((message, index) => div().id(`note-${index}`).px(8).py(6).text_size(12).text_color(t.blocked).whitespace_normal().child(message));
    if (unfollowed) {
      parts.push(note(t, "This space is not a GitHub or GitLab repo."));
    } else if (shown.length === 0) {
      parts.push(note(t, board.readAt > 0 ? "No pull requests here" : "Loading…"));
    } else {
      for (const group of buildGroups(shown)) {
        parts.push(sectionTitle(t, `${group.title} · ${group.prs.length}`));
        for (const pr of group.prs) parts.push(prRow(t, `pr-${prKey(pr)}`, pr, prKey(pr) === selected, now));
      }
    }

    return frame(t, "argus-pull-requests")
      .child(head)
      .child(scrollArea("argus-pull-requests-board", parts, { padding: 6 }))
      .child(footer(t).child(field(t, "filter", this.filterInput, this.focused === "filter")));
  }

  renderScopes(t) {
    const board = readBoard();
    const items = scopeItems(board, followedOf(board));
    const current = readScope();
    const item = (entry) =>
      row(t, `scope-${entry.key}`, { selected: sameScope(entry.scope, current) })
        .cursor_pointer()
        .on_click(() => pickScope(entry.scope))
        .child(div().flex_1().min_w(0).truncate().child(entry.label))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(entry.count)));

    const parts = [item(items.needsReview), item(items.mine), item(items.follow)];
    if (items.projects.length > 0) {
      parts.push(sectionTitle(t, "Projects"));
      for (const entry of items.projects) parts.push(item(entry));
    }
    // A popup is as tall as its content, up to the height it was opened with,
    // so the list gets an explicit height for its rows and section title.
    const height = Math.min(SCOPES_HEIGHT, 12 + (3 + items.projects.length) * 28 + (items.projects.length > 0 ? 30 : 0));
    return v_flex()
      .id("argus-pull-requests-scopes")
      .w_full()
      .h(height)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .child(scrollArea("argus-pull-requests-scope-list", parts, { padding: 6 }));
  }

  renderSettings(t) {
    const settings = readSettings();
    const back = iconButton(t, "back", ICON("chevron-left"), (_e, cx) => {
      this.view = "board";
      cx.notify();
    });
    const hint = (text) => div().px(8).text_size(11).text_color(t.dim).child(text);
    const parts = [
      sectionTitle(t, "gh command"),
      h_flex().px(8).py(4).child(field(t, "gh", this.ghInput, this.focused === "gh")),
      hint("Leave empty to use gh from PATH, else its usual install folders."),
      sectionTitle(t, "glab command"),
      h_flex().px(8).py(4).child(field(t, "glab", this.glabInput, this.focused === "glab")),
      hint("Leave empty to use glab from PATH, else its usual install folders. Both fields save on Enter or when you leave them."),
      sectionTitle(t, "Refresh every"),
      h_flex()
        .px(8)
        .py(4)
        .gap(4)
        .children(
          INTERVALS.map((minutes) =>
            row(t, `interval-${minutes}`, { selected: minutes === settings.interval })
              .cursor_pointer()
              .px(10)
              .text_size(12)
              .text_color(minutes === settings.interval ? t.foreground : t.muted)
              .on_click(() => setShared(SETTINGS_KEY, { ...readSettings(), interval: minutes }))
              .child(`${minutes} min`),
          ),
        ),
    ];
    return frame(t, "argus-pull-requests-settings")
      .child(h_flex().h(42).flex_none().pl(8).pr(14).gap(4).items_center().border_b(1).border_color(t.border).child(back).child(div().font_semibold().child("Settings")))
      .child(scrollArea("argus-pull-requests-settings-list", parts, { padding: 6 }));
  }

  /** The pull request pane. */
  renderPr(t) {
    const selected = readSelected();
    const text = selected ? `${selected.repo} #${selected.number}` : "Pick a pull request on the board.";
    return frame(t, "argus-pull-requests-pr").rounded_none().border_0().child(header(t, "Pull request")).child(note(t, text));
  }
}

/** A 44 px board row, two lines. Click opens the pull request pane. */
function prRow(t, id, pr, selected, now) {
  const checks = checksText(pr.checks);
  let checksColor = t.muted;
  if (checks.startsWith("✗")) checksColor = t.blocked;
  else if (checks.startsWith("●")) checksColor = t.working;
  const review = reviewLabel(pr.reviewDecision);
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
    .on_click(() => openPr(pr))
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`#${pr.number}`))
        .child(div().flex_1().min_w(0).truncate().child(pr.title))
        .when(checks !== "", (el) => el.child(div().flex_none().text_size(11).text_color(checksColor).child(checks)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ageText(pr.updatedAt, now))),
    )
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(`${shortRepo(pr.repo)} · ${pr.headRef}`))
        .when(review !== null, (el) => el.child(div().flex_none().text_color(pr.reviewDecision === "changes_requested" ? t.blocked : t.dim).child(review ?? ""))),
    );
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
  const overlay = props()?.overlay;
  if (overlay) closeOverlay(overlay);
}

function sameScope(a, b) {
  if (a.kind !== b.kind) return false;
  return a.kind !== "project" || a.key === b.key;
}

/**
 * Selects a pull request and shows it: focuses this mod's pane in the shown tab,
 * or splits the tab's focused pane to the right to open one.
 */
export function openPr(pr) {
  setShared(SELECTED_KEY, { key: prKey(pr), provider: pr.provider, host: pr.host, repo: pr.repo, number: pr.number });
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
  run("pane.split", { ...(target ? { pane: target.pane } : {}), direction: "right", mod: MOD, props: { view: "pr" } });
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
  const ok = typeof v.key === "string" && typeof v.repo === "string" && Number.isInteger(v.number);
  return ok ? v : null;
}

/** The board all copies share. */
function readBoard() {
  return normalizeBoard(shared(BOARD_KEY));
}
