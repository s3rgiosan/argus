// The pull request board in Herdr. One mod with views picked by `props().view`:
// the board (the layout's panel, with a settings page), the scope list (a popup),
// a pull request (a pane beside the terminals) and Review with agent (a dialog).
// Reads go through `git`, `gh` and `glab`.

import { div, svg, image, View } from "gpui-kit";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { exec, home, appHome, readTextFile, window, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, focused, knownAgents, notify } from "herdr";
import { readdir, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { localFolders, revParseArgs, remoteArgs, parseRevParse, mergeProjects, followProjectKey, projectKey, localPathFor, missingProjectKeys, newProjectKeys } from "./remote.js";
import { INTERVALS, GH_MISSING, GLAB_MISSING, normalizeSettings, commandCandidates, cliError, missingNotes, openArgs, orderConversation } from "./locate.js";
import { NO_METHOD, OWN_PR, canAct, ownPr, actionCommand, actionFailure, afterAction, leavePr, ghMethodArgs, pickMergeMethod, mergePrompt, clearsComment, confirmedDetail, draftListArgs, draftPlan, loginFresh, runningOf, withRunning, withoutRunning } from "./actions.js";
import { ghLoginArgs, ghSearchArgs, ghListArgs, ghViewArgs, glabArgs, limitNote, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY } from "./forge.js";
import { parseGhSearch, parseGhList, parseGhDetail, parseGlabDetail, parseGlabUser, parseGlabProject, prKey } from "./model.js";
import { assembleBoard, normalizeBoard, markStale, fetchedAtOf, keepStale, pickPairs, withoutFailedRepos, normalizeScope, prsInScope, scopeItems, scopeTitle, buildGroups, matchesFilter, ageText, checksText, prPaneTitle, reviewLabel, shortRepo } from "./board.js";
import { followFolder } from "./follow.js";
import { worktreeRoot, checkoutPlan, spaceFor, gitError, aheadCount, aheadRefusal } from "./worktree.js";
import { createGate } from "./gate.js";
import { mapPool } from "./pool.js";
import { agentArgv, agentChoices, branchDelete, branchRefusal, dirtyRefusal, removePlan, reviewBranch, reviewInstructions, reviewPlan, reviewPrompt, reviewRuns, startRefusal, goneRefusal, keepRuns, takesRequest, resultFor } from "./review.js";
import { discover, readFirst } from "./accounts.js";
import { shouldFetch, takeLock, holdsLock } from "./sync.js";
import { frame, header, subHeader, badge, iconButton, scrollArea, field, textBox, footer, sectionTitle, note, button, segmented, menuRow, MENU_PAD, MENU_ROW } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";
import { menuKey, startAt } from "./menu.js";

const BOARD_KEY = "argus-pull-requests.board";
const SCOPE_KEY = "argus-pull-requests.scope";
const SELECTED_KEY = "argus-pull-requests.selected";
const SETTINGS_KEY = "argus-pull-requests.settings";
const LOCK_KEY = "argus-pull-requests.lock";
// PR key -> {kind, at} for the review and merge actions running in any copy.
const RUNNING_KEY = "argus-pull-requests.running";
const TITLE_KEY = "argus-pull-requests.paneTitle";
// The argus-claude-usage settings: account names and hidden accounts, read only.
const USAGE_SETTINGS_KEY = "argus-claude-usage.settings";
// A Start request from a Review with agent dialog, run by the pull request pane that opened it:
// {id, owner, pr, argv, branch, extra}. The pane keeps running it when the dialog closes.
const REVIEW_START_KEY = "argus-pull-requests.reviewStart";
// The state of the last Start request: {id, state: "running"|"done", error}.
const REVIEW_RESULT_KEY = "argus-pull-requests.reviewResult";
// How long a dialog waits for its pane to take a Start request.
const REVIEW_TAKE_MS = 5_000;
const REVIEW_WIDTH = 460;
const REVIEW_HEIGHT = 600;
const MOD = "argus-pull-requests";
const CLI_TIMEOUT = 30_000;
const GIT_TIMEOUT = 15_000;
const POLL = 5_000;
const AGE_TICK = 60_000;
const LOCK_RETRY = 1_000;
const GIT_LONG_TIMEOUT = 600_000;
// How many gh or glab calls run at once when listing repos and filling in pull requests.
const CLI_CONCURRENCY = 4;
const SCOPES_WIDTH = 280;
const SCOPES_HEIGHT = 420;
const ICON = (name) => `mods/${MOD}/icons/${name}.svg`;

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
    // The project keys that caused a forced read, or null when the force has no key list.
    this.forceKeys = null;
    this.probing = false;
    this.focused = null;
    // Folder -> {folder, top, main, remote}, or null when the folder is not a repository.
    this.repoCache = new Map();
    this.located = { gh: null, glab: null };
    this.login = null;
    // The pane's read: {key, kind: "loading"|"ok"|"error", detail, error, readAt}.
    this.shown = null;
    this.prSeq = 0;
    // The check out action: {key, running, error}.
    // PR key -> {running, error} for the check out action of each pull request.
    this.checkouts = new Map();
    // The failed open in browser action: {key, text}, shown on that pull request only.
    this.actionError = null;
    // PR key -> {running, error, composing, confirm, text, draftText} for the review and merge actions of each pull
    // request. `draftText` is the comment this pane left as a pending GitLab draft.
    this.actions = new Map();
    // The PR key whose comment the comment box holds now.
    this.boxKey = null;
    // Worktree path -> {confirm: null|"plain"|"dirty", running, error} for Remove worktree in the Agent section.
    this.removals = new Map();
    // The Review with agent dialog: the pull request it was opened for, the agents (null while they load), the picked one.
    this.review = this.view === "review" ? { pr: props()?.pr ?? null, owner: props()?.owner ?? null, choices: null, picked: 0, error: null, starting: false, startId: null, handled: null } : null;
    // The id of the last Start request this pane copy took.
    this.takenReview = null;

    const settings = readSettings();
    // The icons Herdr ships that this mod can load; its own copies show until the probe ends.
    this.found = new Set();
    // Whether this copy is reading the board now.
    this.reading = false;
    // The scope list's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();
    this.filterInput = this.input("filter", { placeholder: "Filter by title, number, author or branch" }, () => {});
    this.filterInput.on("change", (_e, cx) => cx.notify());
    this.ghInput = this.input("gh", { placeholder: "gh (from PATH)", value: settings.gh }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.glabInput = this.input("glab", { placeholder: "glab (from PATH)", value: settings.glab }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    // The body of a review comment, for Request changes and Comment.
    this.bodyInput = this.view === "pr" ? this.input("body", { placeholder: "Write a comment", rows: 4 }, (cx) => this.submitBody(cx), { multiline: true }) : null;
    if (this.review) {
      const pr = this.review.pr;
      this.modelInput = this.input("model", { placeholder: "Agent default" }, (cx) => this.startReview(cx));
      this.branchInput = this.input("branch", { value: pr ? reviewBranch(pr, randomUUID().replaceAll("-", "").slice(0, 8)) : "" }, (cx) => this.startReview(cx));
      this.extraInput = this.input("extra", { placeholder: "Extra instructions (optional)", rows: 4 }, (cx) => this.startReview(cx), { multiline: true });
    }

    if (checking()) return;
    if (this.view === "scopes" || this.view === "review") this.handle.focus();
    if (this.review) this.loadAgents(cx);
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    if (this.view === "pr") {
      cx.timer.every(POLL, (cx) => {
        const selected = readSelected();
        if (!selected || this.shown?.key !== selected.key) return;
        const boardReadAt = readBoard().readAt;
        if (boardReadAt > this.shown.readAt) this.loadPr(cx, selected);
      });
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

  /**
   * A text input that tracks focus for its border. `onSubmit` runs on Enter, and on blur
   * with `saveOnBlur`. A `multiline` input is a textarea: Return adds a line, and only ⌘Return submits.
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
   * Probes the folders the last read did not see, with git only. A project key the
   * board does not have forces a read; any other folder waits for the next scheduled read.
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
        await Promise.all(unseen.filter((folder) => !this.repoCache.has(folder)).map((folder) => this.probe(folder)));
        const entries = unseen.map((folder) => this.repoCache.get(folder) ?? null);
        const fresh = newProjectKeys(entries, readBoard().projects);
        if (fresh.length === 0) return;
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

  /**
   * Reads the board into `shared` when it is older than the interval (or a
   * refresh was asked for) and no other copy holds the lock.
   */
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
        fetchedAt: fetchedAtOf(readBoard()),
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

      const next = await this.readBoard(startedAt);
      if (!holdsLock(shared(LOCK_KEY), this.owner, Date.now())) return;
      setShared(BOARD_KEY, keepStale(next, readBoard(), startedAt));
    } finally {
      this.reading = false;
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
    // glab is only looked up when a project needs it.
    const [gh, glab] = await Promise.all([this.locate("gh"), gitLab.length > 0 ? this.locate("glab") : null]);
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

    const reviews = await this.readReviews(projects);
    this.renewLock();
    return assembleBoard({ projects, folders, needsReview: result.needsReview, mine: result.mine, projectPrs: result.projectPrs, notes: [...new Set(notes)], readAt: startedAt, reviews });
  }

  /**
   * The review agent worktrees of the projects with a local checkout. A project whose git call
   * fails keeps the runs of the last read.
   */
  async readReviews(projects) {
    const local = projects.filter((project) => project.localPath);
    const listings = await mapPool(local, CLI_CONCURRENCY, async (project) => {
      let listing = null;
      try {
        const reply = await exec("git", ["worktree", "list", "--porcelain"], { cwd: project.localPath, timeout: GIT_TIMEOUT });
        listing = reply.code === 0 ? { project, porcelain: reply.stdout } : null;
      } catch {
        listing = null;
      }
      this.renewLock();
      return listing;
    });
    const failed = local.filter((_project, index) => listings[index] === null);
    return keepRuns(reviewRuns(listings.filter((listing) => listing !== null)), readBoard().reviews, failed);
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
   * The command for `name` ("gh" or "glab"), or null when none runs. The first
   * of the setting, the bare name and the install folders whose `--version`
   * runs wins. The result, found or missing, is kept per setting value until the
   * setting changes or the refresh button looks again.
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

  /**
   * The signed-in GitHub login, kept per gh command setting for LOGIN_TTL. `keepFailure`
   * keeps a failed read too, so the pane does not ask again before every detail read.
   */
  async ghLogin(gh, notes, keepFailure = false) {
    const setting = readSettings().gh;
    if (loginFresh(this.login, setting, Date.now())) return this.login.value;
    const value = await this.attempt("gh", gh, ghLoginArgs(), (text) => {
      const login = text.trim();
      if (login === "") throw new Error("no login returned");
      return login;
    }, notes);
    if (value !== null || keepFailure) this.login = { setting, value, at: Date.now() };
    return value;
  }

  /** Searches, lists and fills in GitHub pull requests into `result`. */
  async readGitHub(gh, projects, result, notes) {
    const login = await this.ghLogin(gh, notes);
    this.renewLock();
    const [needsPairs, minePairs] = await Promise.all([
      this.attempt("gh", gh, ghSearchArgs("needsReview"), parseGhSearch, notes),
      login === null ? null : this.attempt("gh", gh, ghSearchArgs("mine", login), parseGhSearch, notes),
    ]);
    this.renewLock();
    const searchNotes = [
      [needsPairs, "pull requests that need your review"],
      [minePairs, "pull requests you opened"],
    ];
    for (const [found, what] of searchNotes) {
      const note = limitNote(what, found?.length ?? 0);
      if (note !== null) notes.push(note);
    }
    const pairs = [...(needsPairs ?? []), ...(minePairs ?? [])];

    // Every project repo plus the repos the searches name, each listed once.
    const repos = new Map();
    for (const project of projects) repos.set(projectKey(project), project.repo);
    for (const pair of pairs) if (!repos.has(projectKey(pair))) repos.set(projectKey(pair), pair.repo);
    const listed = await mapPool([...repos], CLI_CONCURRENCY, async ([key, repo]) => [
      key,
      await this.attempt("gh", gh, ghListArgs(repo), (text) => parseGhList(text, repo), notes),
    ]);
    this.renewLock();
    const all = [];
    const failed = new Set();
    for (const [key, prs] of listed) {
      if (prs === null) {
        failed.add(key);
        continue;
      }
      const note = limitNote(`pull requests of ${repos.get(key)}`, prs.length);
      if (note !== null) notes.push(note);
      all.push(...prs);
      if (projects.some((project) => project.key === key)) result.projectPrs[key] = prs;
    }

    const pick = async (list) => {
      const { found, missing } = pickPairs(all, list);
      const wanted = withoutFailedRepos(missing, failed);
      const filled = await mapPool(wanted, CLI_CONCURRENCY, (pair) =>
        this.attempt("gh", gh, ghViewArgs(pair.repo, pair.number), (text) => parseGhDetail(text, pair.repo).pr, notes),
      );
      this.renewLock();
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
        for (const [found, what] of [
          [user.needsReview, `merge requests on ${host} that need your review`],
          [user.mine, `merge requests on ${host} that you opened`],
        ]) {
          const note = limitNote(what, found.length);
          if (note !== null) notes.push(note);
        }
        result.needsReview.push(...user.needsReview);
        result.mine.push(...user.mine);
      }),
      mapPool(projects, CLI_CONCURRENCY, async (project) => {
        const prs = await this.attempt(
          `glab (${project.host})`,
          glab,
          glabArgs(project.host, GL_PROJECT_QUERY, { path: project.repo }),
          (text) => parseGlabProject(text, project.host),
          notes,
        );
        if (prs === null) return;
        const note = limitNote(`merge requests of ${project.repo}`, prs.length);
        if (note !== null) notes.push(note);
        result.projectPrs[project.key] = prs;
      }),
    ]);
    this.renewLock();
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
        return this.renderPr(t, cx);
      case "review":
        return this.renderReview(t, cx);
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
    const unfollowed = scope.where === "follow" && followed === null;
    const text = this.filterInput.value();
    const shown = prsInScope(board, scope, followed).filter((pr) => matchesFilter(pr, text));
    const selected = readSelected()?.key ?? null;
    const now = Date.now();

    const icon = iconResolver(MOD, this.found);
    const scopeButton = h_flex()
      .id("scope")
      .h(26)
      .px(8)
      .gap(4)
      .min_w(0)
      .items_center()
      .rounded(6)
      .max_w(150)
      .text_size(12)
      .cursor_pointer()
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openScopes())
      .child(div().min_w(0).truncate().child(scopeTitle(scope, board, followed)))
      .child(svg(icon("chevron-down")).size(12).flex_none());
    const refresh = iconButton(
      t,
      "refresh",
      ICON("refresh-cw"),
      (_e, cx) => {
        // Looks for gh and glab again too, in case they were installed or updated.
        this.located = { gh: null, glab: null };
        this.login = null;
        this.repoCache.clear();
        this.refresh(cx);
      },
      { busy: this.reading },
    );
    const settings = iconButton(t, "settings", icon("settings"), (_e, cx) => this.openSettings(cx));
    const head = header(t, "Pull requests", [scopeButton, refresh, settings], { badge: badge(t, String(unfollowed ? 0 : shown.length)) });

    const parts = board.notes.map((message, index) => div().id(`note-${index}`).px(8).py(6).text_size(12).text_color(t.blocked).whitespace_normal().child(message));
    if (unfollowed) {
      parts.push(note(t, "This space is not a GitHub or GitLab repo."));
    } else if (shown.length === 0) {
      parts.push(note(t, board.readAt > 0 ? "No pull requests here" : "Loading…"));
    } else {
      for (const group of buildGroups(shown)) {
        parts.push(sectionTitle(t, `${group.title} · ${group.prs.length}`));
        for (const pr of group.prs) parts.push(prRow(t, `pr-${prKey(pr)}`, pr, prKey(pr) === selected, now, (board.reviews[prKey(pr)] ?? []).length > 0));
      }
    }

    return frame(t, "argus-pull-requests")
      .child(head)
      .child(scrollArea("argus-pull-requests-board", parts, { padding: 6 }))
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
      .id("argus-pull-requests-scopes")
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
      .child(scrollArea("argus-pull-requests-scope-list", parts, { padding: MENU_PAD }));
  }

  /** Lists the agents for the dialog: Herdr's installed agents, with Claude Code once per account. */
  loadAgents(cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let known = [];
      let error = null;
      try {
        known = await knownAgents();
      } catch (caught) {
        error = `Could not list the agents: ${caught?.message ?? String(caught)}`;
      }
      const usage = usageSettings();
      let profiles = [];
      try {
        profiles = await discover(discoveryIO(), { extra: usage.extra });
      } catch {
        // Without the profiles, Claude Code shows once with its plain command.
      }
      this.review = { ...this.review, choices: agentChoices(known, profiles, usage, home()), error };
      cx.notify();
    });
  }

  /**
   * Checks the dialog's fields, then hands a Start request to the pull request pane that
   * opened the dialog. The pane runs it, so closing the dialog does not stop the run.
   */
  startReview(cx) {
    const review = this.review;
    if (!review?.pr || review.starting || !review.choices || review.choices.length === 0) return;
    const choice = review.choices[review.picked] ?? review.choices[0];
    const branch = this.branchInput.value().trim();
    const refusal = branchRefusal(branch, review.pr.number);
    if (refusal !== null) {
      this.review = { ...review, error: refusal };
      cx.notify();
      return;
    }
    const model = choice.model ? this.modelInput.value() : "";
    const id = randomUUID();
    this.review = { ...review, starting: true, error: null, startId: id };
    setShared(REVIEW_START_KEY, { id, owner: review.owner, pr: review.pr, argv: agentArgv(choice, model), branch, extra: this.extraInput.value() });
    cx.timer.after(REVIEW_TAKE_MS, (cx) => {
      if (this.review?.startId !== id || resultFor(shared(REVIEW_RESULT_KEY), id) !== null) return;
      this.review = { ...this.review, starting: false, error: "The pull request pane is not open. Open it, then start again." };
      cx.notify();
    });
    cx.notify();
  }

  /** Runs a Start request in this pane copy, shares its state, and shows a toast when it fails. */
  runRequest(cx, request) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      setShared(REVIEW_RESULT_KEY, { id: request.id, state: "running", error: null });
      let error;
      try {
        error = await this.runReview(request.pr, request.argv, request.branch, request.extra);
      } catch (caught) {
        error = caught?.message ?? String(caught);
      }
      setShared(REVIEW_RESULT_KEY, { id: request.id, state: "done", error });
      if (error !== null) notify({ title: "Review with agent did not start", body: error, level: "warning" });
      cx.notify();
    });
  }

  /** Runs a review: reads the settings and the pull request, adds the worktree, opens the space. Gives an error text, or null. */
  async runReview(pr, argv, branch, extra) {
    const resolved = worktreeRoot(await readTextFile(`${appHome()}/settings.json`), home());
    if ("error" in resolved) return resolved.error;
    const configured = reviewInstructions(await readTextFile(`${appHome()}/argus.json`));
    if (configured.error !== null) return configured.error;
    // The prompt names the head commit, so the pull request is read again now. A gh or glab error throws.
    const detail = await this.readDetail(pr);
    const refusal = startRefusal(detail);
    if (refusal !== null) return refusal;
    const plan = reviewPlan({ localPath: pr.localPath, root: resolved.root, branch });
    const checked = await exec("git", plan.check, { cwd: plan.cwd, timeout: GIT_TIMEOUT });
    if (checked.code !== 0) return gitError(checked);
    const added = await exec("git", plan.add, { cwd: plan.cwd, timeout: GIT_LONG_TIMEOUT });
    if (added.code !== 0) return gitError(added);
    run("space.new", {
      name: `PR #${pr.number} · ${pr.title}`,
      folder: plan.path,
      argv,
      task: reviewPrompt({ detail, configured: configured.instructions, extra }),
    });
    setShared(BOARD_KEY, markStale(readBoard(), Date.now()));
    return null;
  }

  /** The Review with agent dialog: the pull request, the agents, Model, Branch and Extra instructions. */
  renderReview(t, cx) {
    // The pane shares the outcome of this dialog's request. A success closes the dialog after this
    // render; an error shows in it.
    const outcome = this.review?.startId ? resultFor(shared(REVIEW_RESULT_KEY), this.review.startId) : null;
    if (outcome?.state === "done" && this.review.handled !== this.review.startId) {
      this.review = { ...this.review, handled: this.review.startId, starting: outcome.error !== null ? false : this.review.starting, error: outcome.error };
      if (outcome.error === null) {
        cx.spawn(async (cx) => {
          await cx.sleep(0);
          closeOverlay(props()?.overlay);
        });
      }
    }
    const review = this.review;
    const pr = review?.pr ?? null;
    const close = () => closeOverlay(props()?.overlay);
    const label = (text) => div().text_size(11.5).font_medium().text_color(t.dim).child(text);
    const choices = review?.choices ?? null;
    const choice = choices?.[review.picked] ?? null;
    const tiles = (choices ?? []).map((entry, index) => {
      const picked = index === review.picked;
      const pic = entry.icon ? (entry.tint ? svg(entry.icon).size(18).text_color(t.foreground) : image(entry.icon).w(18).h(18)) : null;
      return v_flex()
        .id(`agent-${index}`)
        .w(128)
        .p(8)
        .gap(6)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(picked ? t.accent : t.border)
        .when(picked, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.review = { ...this.review, picked: index };
          cx.notify();
        })
        .when(pic !== null, (el) => el.child(pic))
        .child(div().w_full().text_size(11.5).text_center().whitespace_normal().child(entry.label));
    });
    const canStart = pr !== null && !review.starting && choice !== null;
    const starting = Boolean(review?.starting);
    // A field grows along its row, so each one sits in its own row.
    const row = (child) => h_flex().w_full().child(child);
    const body = [
      label("Agent"),
      choices === null
        ? note(t, "Looking for agents…")
        : choices.length === 0
          ? note(t, "No agent is installed.")
          : h_flex().flex_wrap().gap(8).children(tiles),
    ];
    if (choice?.model) body.push(label("Model"), row(field(t, "model", this.modelInput, this.focused === "model")));
    body.push(label("Branch"), row(field(t, "branch", this.branchInput, this.focused === "branch")));
    body.push(label("Extra instructions"), textBox(t, "extra", this.extraInput, this.focused === "extra"));
    return v_flex()
      .id("argus-pull-requests-review")
      .track_focus(this.handle)
      .size_full()
      .p(14)
      .gap(10)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        // The pane runs a started review, so closing the dialog never stops it.
        if (e.key !== "escape") return;
        cx.stop_propagation();
        close();
      })
      .child(div().flex_none().text_size(14).font_semibold().child("Review with agent"))
      .when(pr !== null, (el) =>
        el.child(h_flex().flex_none().gap(8).px(10).py(8).rounded(8).bg(t.raised).child(div().flex_none().text_color(t.muted).child(`#${pr.number}`)).child(div().flex_1().min_w(0).truncate().child(pr.title))),
      )
      // The fields scroll, so Cancel and Start stay in view with many agents.
      .child(scrollArea("argus-pull-requests-review-body", body, { padding: 0, gap: 10 }))
      // The error stays in view below the fields.
      .when(Boolean(this.review?.error), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).whitespace_normal().child(this.review?.error ?? "")))
      .child(
        h_flex()
          .flex_none()
          .gap(8)
          .justify_end()
          .child(button(t, "review-cancel", starting ? "Close" : "Cancel", close))
          .child(button(t, "review-start", starting ? "Starting…" : "Start", (_e, cx) => this.startReview(cx), { primary: true, enabled: canStart })),
      );
  }

  /** One review run in the Agent section: its branch, Open space and Remove worktree, with the remove confirm. */
  reviewRunRow(t, index, reviewRun, localPath) {
    const state = this.removals.get(reviewRun.path) ?? { confirm: null, running: false, error: null };
    // A removed run stays on the board until the next read; its row goes at once.
    if (state.removed) return null;
    const set = (patch, cx) => {
      this.removals.set(reviewRun.path, { ...state, ...patch });
      cx.notify();
    };
    let row = v_flex()
      .id(`run-${index}`)
      .px(8)
      .py(4)
      .gap(6)
      .child(div().text_size(12).truncate().child(reviewRun.branch))
      .child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .child(button(t, `run-open-${index}`, "Open space", () => openRun(reviewRun), { enabled: !reviewRun.prunable }))
          .child(button(t, `run-remove-${index}`, "Remove worktree", (_e, cx) => set({ confirm: "plain", error: null }, cx), { enabled: !state.running && state.confirm === null && !reviewRun.locked })),
      )
      .when(Boolean(reviewRun.locked), (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child("Locked. Run git worktree unlock on it to remove it.")))
      .when(Boolean(reviewRun.prunable), (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child("Its folder is gone. Remove worktree clears it.")));
    if (state.confirm !== null) {
      const dirty = state.confirm === "dirty";
      row = row.child(div().text_size(12).whitespace_normal().child(dirty ? "The worktree has changes. Remove it and lose them?" : `Remove ${reviewRun.branch}?`)).child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .child(button(t, `run-confirm-${index}`, "Remove", (_e, cx) => this.removeRun(cx, reviewRun, localPath, dirty), { primary: true, enabled: !state.running }))
          .child(button(t, `run-cancel-${index}`, "Cancel", (_e, cx) => set({ confirm: null }, cx), { enabled: !state.running })),
      );
    }
    if (state.error) row = row.child(div().text_size(11).text_color(t.blocked).whitespace_normal().child(state.error));
    return row;
  }

  /**
   * Removes a review worktree, then its branch (`-d` keeps a branch with commits; a toast says so).
   * A worktree with changes turns the confirm into a second one that removes it with `--force`.
   * A worktree that is already gone counts as removed.
   */
  removeRun(cx, reviewRun, localPath, force) {
    const key = reviewRun.path;
    if (this.removals.get(key)?.running) return;
    this.removals.set(key, { ...(this.removals.get(key) ?? { confirm: null, error: null }), running: true, error: null });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let next;
      try {
        const removed = await exec("git", removePlan(reviewRun, force), { cwd: localPath, timeout: GIT_TIMEOUT });
        if (removed.code === 0 || goneRefusal(removed.stderr)) {
          next = { removed: true };
        } else if (!force && dirtyRefusal(removed.stderr)) {
          next = { confirm: "dirty", running: false, error: null };
        } else {
          next = { confirm: null, running: false, error: gitError(removed) };
        }
      } catch (caught) {
        next = { confirm: null, running: false, error: caught?.message ?? String(caught) };
      }
      this.removals.set(key, next);
      cx.notify();
      if (!next.removed) return;
      setShared(BOARD_KEY, markStale(readBoard(), Date.now()));
      let kept = null;
      try {
        const deleted = await exec("git", branchDelete(reviewRun.branch), { cwd: localPath, timeout: GIT_TIMEOUT });
        if (deleted.code !== 0) kept = gitError(deleted);
      } catch (caught) {
        kept = caught?.message ?? String(caught);
      }
      if (kept !== null) notify({ title: `The worktree is removed. The branch ${reviewRun.branch} stays.`, body: kept, level: "info" });
    });
  }

  renderSettings(t) {
    const settings = readSettings();
    const icon = iconResolver(MOD, this.found);
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
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
        .child(
          segmented(
            t,
            "interval",
            INTERVALS.map((minutes) => ({ value: minutes, label: `${minutes} min` })),
            settings.interval,
            (minutes) => setShared(SETTINGS_KEY, { ...readSettings(), interval: minutes }),
          ),
        ),
      sectionTitle(t, "Conversation"),
      h_flex()
        .px(8)
        .py(4)
        .child(
          segmented(
            t,
            "conversation",
            [
              { value: "oldest", label: "Oldest first" },
              { value: "newest", label: "Newest first" },
            ],
            settings.conversation,
            (order) => setShared(SETTINGS_KEY, { ...readSettings(), conversation: order }),
          ),
        ),
    ];
    return frame(t, "argus-pull-requests-settings")
      .child(subHeader(t, back, "Settings", icon("chevron-left")))
      .child(scrollArea("argus-pull-requests-settings-list", parts, { padding: 6 }));
  }

  /**
   * Reads the selected pull request into the pane. A newer call wins over a read
   * still running. The shown detail stays on screen while the same pull request is read again.
   */
  loadPr(cx, selected) {
    const seq = ++this.prSeq;
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
      if (switched) this.swapComment(selected.key);
      let next;
      try {
        next = { kind: "ok", detail: await this.readDetail(selected), error: null };
      } catch (error) {
        next = { kind: "error", detail: null, error: error?.message ?? String(error) };
      }
      if (seq !== this.prSeq) return;
      this.shown = { key: selected.key, readAt, ...next };
      cx.notify();
    });
  }

  /** Reads one pull request through gh or glab; throws a readable error. */
  async readDetail(selected) {
    const gitLab = selected.provider === "gitlab";
    const name = gitLab ? "glab" : "gh";
    const command = await this.locate(name);
    if (command === null) throw new Error(gitLab ? GLAB_MISSING : GH_MISSING);
    const args = gitLab
      ? glabArgs(selected.host, GL_DETAIL_QUERY, { path: selected.repo, iid: String(selected.number) })
      : ghViewArgs(selected.repo, selected.number);
    // The pane needs the GitHub login to turn off the review buttons on your own pull request.
    if (!gitLab) await this.ghLogin(command, [], true);
    const reply = await exec(command, args, { timeout: CLI_TIMEOUT });
    if (reply.code !== 0) throw new Error(cliError(name, reply));
    return gitLab ? parseGlabDetail(reply.stdout, selected.host) : parseGhDetail(reply.stdout, selected.repo);
  }

  openInBrowser(cx, pr) {
    const key = prKey(pr);
    this.actionError = null;
    const open = openArgs(window().platform, pr.url);
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

  /** Opens the space of the pull request's worktree, creating the worktree first when needed. */
  checkOut(cx, pr, localPath) {
    const key = prKey(pr);
    if (this.checkouts.get(key)?.running) return;
    this.actionError = null;
    this.checkouts.set(key, { running: true, error: null });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let error = null;
      try {
        error = await this.runCheckout(pr, localPath);
      } catch (caught) {
        error = caught?.message ?? String(caught);
      }
      this.checkouts.set(key, { running: false, error });
      cx.notify();
    });
  }

  /** Runs the check out plan; gives an error text, or null on success. */
  async runCheckout(pr, localPath) {
    const resolved = worktreeRoot(await readTextFile(`${appHome()}/settings.json`), home());
    if ("error" in resolved) return resolved.error;
    const list = await exec("git", ["worktree", "list", "--porcelain"], { cwd: localPath, timeout: GIT_TIMEOUT });
    if (list.code !== 0) return gitError(list);
    const plan = checkoutPlan({ pr, localPath, root: resolved.root, porcelain: list.stdout });
    if (plan.kind === "create") {
      const git = (args) => exec("git", args, { cwd: plan.cwd, timeout: GIT_LONG_TIMEOUT });
      const exists = await git(plan.exists);
      if (exists.code === 0) {
        // A branch left from an earlier check out only updates when it holds nothing that is not on the PR head.
        const peeked = await git(plan.peek);
        if (peeked.code !== 0) return gitError(peeked);
        const counted = await git(plan.ahead);
        if (counted.code !== 0) return gitError(counted);
        const ahead = aheadCount(counted.stdout);
        if (ahead === null) return "git: could not count the commits of the local branch";
        if (ahead > 0) return aheadRefusal(plan.branch, ahead);
      }
      const fetched = await git(plan.fetch);
      if (fetched.code !== 0) return gitError(fetched);
      const added = await git(plan.add);
      if (added.code !== 0) return gitError(added);
      run("space.new", { folder: plan.path });
      return null;
    }
    const id = spaceFor(spaces(), panes(), plan.path);
    if (id !== null) run("space.select", { id });
    else run("space.new", { folder: plan.path });
    return null;
  }

  /** The review and merge state of one pull request in this pane. */
  actionState(key) {
    return this.actions.get(key) ?? { running: null, error: null, composing: null, confirm: null, text: "", draftText: null };
  }

  /** The action running on a pull request in this copy or in another copy of the mod, or null. */
  runningOn(key) {
    return this.actionState(key).running ?? runningOf(shared(RUNNING_KEY), key, Date.now());
  }

  /** Marks an action as running in this copy and in shared state, so other copies wait. */
  startRunning(key, kind) {
    this.setAction(key, { running: kind });
    setShared(RUNNING_KEY, withRunning(shared(RUNNING_KEY), key, kind, Date.now()));
  }

  finishRunning(key, patch) {
    this.setAction(key, { running: null, ...patch });
    setShared(RUNNING_KEY, withoutRunning(shared(RUNNING_KEY), key));
  }

  /**
   * Keeps the comment typed for the pull request whose comment the box holds, and
   * shows the one kept for the pull request the pane opens.
   */
  swapComment(key) {
    const left = this.boxKey;
    if (left === key) return;
    if (left !== null) {
      const kept = leavePr(this.actionState(left), this.bodyInput?.value() ?? "");
      if (kept === null) this.actions.delete(left);
      else this.actions.set(left, kept);
    }
    this.bodyInput?.set_value(this.actionState(key).text);
    this.boxKey = key;
  }

  setAction(key, patch) {
    this.actions.set(key, { ...this.actionState(key), ...patch });
  }

  /** Opens the composer for Request changes or Comment. */
  compose(cx, key, kind) {
    this.setAction(key, { composing: kind, confirm: null, error: null });
    cx.timer.after(0, () => this.bodyInput?.focus());
    cx.notify();
  }

  /** Runs the composer's action with the typed body. */
  submitBody(cx) {
    const shown = this.shown;
    if (shown?.kind !== "ok") return;
    const state = this.actionState(shown.key);
    // Until the box holds this pull request's comment, it holds the one left behind.
    if (state.composing === null || this.boxKey !== shown.key) return;
    this.runAction(cx, shown.key, state.composing, shown.detail, this.bodyInput?.value() ?? "", null);
  }

  /** Shows the merge confirm; on GitHub it reads the repo's merge method first. */
  askMerge(cx, key, detail) {
    if (this.runningOn(key) !== null) return;
    // The confirm keeps the head it was shown for; a merge of a newer head fails.
    const headSha = detail.headSha;
    if (detail.pr.provider === "gitlab") {
      this.setAction(key, { confirm: { method: null, headSha }, composing: null, error: null });
      cx.notify();
      return;
    }
    this.setAction(key, { running: "merge", composing: null, confirm: null, error: null });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let patch;
      try {
        const gh = await this.locate("gh");
        if (gh === null) {
          patch = { error: GH_MISSING };
        } else {
          const reply = await exec(gh, ghMethodArgs(detail.pr.repo), { timeout: CLI_TIMEOUT });
          const method = reply.code === 0 ? pickMergeMethod(reply.stdout) : null;
          if (reply.code !== 0) patch = { error: cliError("gh", reply) };
          else if (method === null) patch = { error: NO_METHOD };
          // A merge confirm shows only on the pull request it was asked for.
          else patch = this.shown?.key === key ? { confirm: { method, headSha } } : {};
        }
      } catch (error) {
        patch = { error: error?.message ?? String(error) };
      }
      this.setAction(key, { running: null, ...patch });
      cx.notify();
    });
  }

  /**
   * Runs one review or merge action, then reads the pull request again and marks the board
   * stale so a board copy reads it. On success it closes the confirm, and the composer after
   * its own action while the box still holds the sent text.
   */
  runAction(cx, key, kind, detail, body, method) {
    if (this.runningOn(key) !== null) return;
    const command = actionCommand({ kind, detail, body, method });
    if ("error" in command) {
      this.setAction(key, { error: command.error });
      cx.notify();
      return;
    }
    const kept = this.actionState(key).draftText;
    // A GitLab Request changes reads the user's pending comments first (`draftPlan`).
    const draftStep = kind === "request_changes" && detail.pr.provider === "gitlab";
    this.startRunning(key, kind);
    this.setAction(key, { error: null });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let error = null;
      // The comment left as a pending GitLab draft once this run ends, and whether this run drafted it.
      let draftText = kept;
      let drafted = false;
      try {
        const cli = await this.locate(command.name);
        if (cli === null) {
          error = command.name === "glab" ? GLAB_MISSING : GH_MISSING;
        } else {
          let run = command;
          if (draftStep) {
            const list = await exec(cli, draftListArgs(detail), { timeout: CLI_TIMEOUT });
            const plan = list.code === 0 ? draftPlan(list.stdout, kept, body) : { error: cliError(command.name, list) };
            if ("error" in plan) {
              error = plan.error;
            } else {
              // No pending comment means a kept draft is gone, so it is drafted again.
              if (!plan.publishOnly) draftText = null;
              run = actionCommand({ kind, detail, body, method, publishOnly: plan.publishOnly });
            }
          }
          if (error === null) {
            const reply = await exec(cli, run.args, { timeout: CLI_TIMEOUT });
            if (reply.code !== 0) {
              error = cliError(command.name, reply);
            } else if (run.then) {
              draftText = body;
              drafted = true;
              const next = await exec(cli, run.then, { timeout: CLI_TIMEOUT });
              if (next.code !== 0) error = cliError(command.name, next);
            }
          }
        }
      } catch (caught) {
        error = caught?.message ?? String(caught);
      }
      const after = afterAction(kind, error === null);
      if (error !== null) {
        this.finishRunning(key, { error: actionFailure(error, drafted), draftText });
      } else {
        const done = kind === "request_changes" ? { draftText: null } : {};
        const inBox = this.boxKey === key;
        const current = inBox ? (this.bodyInput?.value() ?? "") : this.actionState(key).text;
        const clear = clearsComment(after, body, current);
        this.finishRunning(key, { error: null, confirm: null, ...done, ...(clear ? { composing: null, text: "" } : {}) });
        if (clear && inBox) this.bodyInput?.set_value("");
      }
      // A failed action may still have reached the forge (a timeout), so the board reads it again either way.
      setShared(BOARD_KEY, markStale(readBoard(), Date.now()));
      // A refused head pin shows the new head after this read.
      const selected = readSelected();
      if (after.reread && selected?.key === key) this.loadPr(cx, selected);
      cx.notify();
    });
  }

  /** The pull request pane: header, actions and the five sections. */
  renderPr(t, cx) {
    // A Start request from the Review with agent dialog this pane opened runs here.
    const request = shared(REVIEW_START_KEY);
    if (!checking() && takesRequest(request, this.owner, this.takenReview)) {
      this.takenReview = request.id;
      this.runRequest(cx, request);
    }
    const selected = readSelected();
    // A new selection arrives as a re-render; the read runs as a task.
    if (selected && this.shown?.key !== selected.key && !checking()) this.loadPr(cx, selected);
    if (!checking()) {
      // The board comes first, because every pane copy sees the same board; a pane's own read
      // can lag, and two copies with different titles would overwrite each other.
      const listed = selected ? (readBoard().prs.find((pr) => prKey(pr) === selected.key) ?? null) : null;
      const read = this.shown?.key === selected?.key ? (this.shown?.detail?.pr ?? null) : null;
      shareTitle(cx, prPaneTitle(listed ?? read));
    }

    const empty = (text) => frame(t, "argus-pull-requests-pr").rounded_none().border_0().child(note(t, text));
    if (!selected) return empty("Pick a pull request on the board.");
    const shown = this.shown;
    if (!shown || shown.key !== selected.key || shown.kind === "loading") return empty("Loading…");
    if (shown.kind === "error") {
      return frame(t, "argus-pull-requests-pr")
        .rounded_none()
        .border_0()
        .child(note(t, "Could not read this pull request."))
        .child(div().px(8).text_size(12).text_color(t.blocked).whitespace_normal().child(shown.error ?? ""));
    }

    const detail = shown.detail;
    const pr = detail.pr;
    const localPath = localPathFor(readBoard().projects, pr.host, pr.repo);
    const now = Date.now();
    const checkout = this.checkouts.get(shown.key) ?? { running: false, error: null };
    const act = this.actionState(shown.key);
    const busy = this.runningOn(shown.key) !== null;
    const error = (this.actionError?.key === shown.key ? this.actionError.text : null) ?? checkout.error;
    const small = (text) => div().text_size(12).text_color(t.muted).child(text);

    const head = v_flex()
      .flex_none()
      .p(10)
      .gap(6)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(svg(ICON(pr.provider === "gitlab" ? "gitlab" : "github")).size(14).flex_none().text_color(t.muted))
          .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(pr.repo))
          .child(small(`#${pr.number}`).flex_none())
          .child(div().flex_none().text_size(12).text_color(t.muted).child(prState(pr))),
      )
      .child(div().text_size(11).text_color(t.dim).whitespace_normal().child(`${pr.headRef} → ${pr.baseRef}`))
      .child(div().font_semibold().whitespace_normal().child(pr.title))
      .when(localPath === null, (el) => el.child(note(t, "No local checkout")))
      .child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .child(button(t, "open-browser", "Open in browser", (_e, cx) => this.openInBrowser(cx, pr)))
          .child(
            button(t, "check-out", "Check out in a worktree", (_e, cx) => this.checkOut(cx, pr, localPath ?? ""), {
              enabled: localPath !== null && !checkout.running,
            }),
          )
          .child(button(t, "review-agent", "Review with agent", () => openReview(pr, localPath ?? "", this.owner), { enabled: localPath !== null && canAct(pr) })),
      )
      .when(checkout.running, (el) => el.child(div().text_size(11).text_color(t.muted).child("Checking out…")))
      .when(Boolean(error), (el) => el.child(div().text_size(11).text_color(t.blocked).whitespace_normal().child(error ?? "")))
      .when(canAct(pr), (el) => el.child(this.reviewActions(t, shown.key, detail, act)))
      .when(busy, (el) => el.child(div().text_size(11).text_color(t.muted).child("Working…")))
      .when(act.error !== null, (el) => el.child(div().text_size(11).text_color(t.blocked).whitespace_normal().child(act.error ?? "")));

    const text = (value) => div().px(8).py(2).whitespace_normal().child(value);
    const parts = [sectionTitle(t, "Checks")];
    if (detail.checks.length === 0) parts.push(note(t, "No checks"));
    for (const [index, check] of detail.checks.entries()) {
      const color = check.state === "failed" ? t.blocked : check.state === "running" ? t.working : t.muted;
      const mark = check.state === "failed" ? "✗" : check.state === "running" ? "●" : "✓";
      parts.push(
        h_flex()
          .id(`check-${index}`)
          .px(8)
          .py(2)
          .gap(6)
          .child(div().flex_none().text_color(color).child(mark))
          .child(div().flex_1().min_w(0).whitespace_normal().child(check.name)),
      );
    }
    parts.push(sectionTitle(t, "Reviews"));
    if (detail.reviewers.length === 0) parts.push(note(t, "No reviews yet"));
    for (const [index, reviewer] of detail.reviewers.entries()) {
      parts.push(
        h_flex()
          .id(`reviewer-${index}`)
          .px(8)
          .py(2)
          .gap(8)
          .child(div().flex_1().min_w(0).truncate().child(reviewer.name))
          .child(div().flex_none().text_color(reviewer.state === "changes_requested" ? t.blocked : t.muted).child(REVIEW_WORDS[reviewer.state] ?? reviewer.state)),
      );
    }
    parts.push(sectionTitle(t, "Merge state"), text(MERGE_WORDS[detail.merge.state] ?? "Not checked yet"));
    if (detail.merge.reason) parts.push(div().px(8).py(2).text_size(12).text_color(t.muted).whitespace_normal().child(detail.merge.reason));
    const runs = readBoard().reviews[shown.key] ?? [];
    if (runs.length > 0 && localPath !== null) {
      parts.push(sectionTitle(t, "Agent"));
      runs.forEach((reviewRun, index) => {
        const row = this.reviewRunRow(t, index, reviewRun, localPath);
        if (row !== null) parts.push(row);
      });
    }
    parts.push(sectionTitle(t, "Description"));
    const body = detail.body.trim();
    parts.push(body === "" ? note(t, "No description") : text(detail.body));
    parts.push(sectionTitle(t, "Conversation"));
    if (detail.conversation.length === 0) parts.push(note(t, "No comments"));
    for (const [index, entry] of orderConversation(detail.conversation, readSettings().conversation).entries()) {
      parts.push(
        v_flex()
          .id(`entry-${index}`)
          .px(8)
          .py(4)
          .gap(2)
          .child(div().text_size(11).text_color(t.dim).child(`${entry.author} · ${ageText(entry.at, now)}`))
          .child(div().whitespace_normal().child(entry.body)),
      );
    }

    return frame(t, "argus-pull-requests-pr")
      .rounded_none()
      .border_0()
      .child(head)
      .child(scrollArea("argus-pull-requests-pr-detail", parts, { padding: 6 }));
  }

  /** Approve, Request changes, Comment and Merge, with the open composer or merge confirm under them. */
  reviewActions(t, key, detail, act) {
    const enabled = this.runningOn(key) === null;
    // A null login leaves the buttons on; GitHub's own message then explains a refusal.
    const own = ownPr(detail.pr, this.login?.value ?? null);
    const cancel = (patch) => (_e, cx) => {
      this.setAction(key, { ...patch, error: null });
      cx.notify();
    };
    let box = v_flex()
      .gap(6)
      .child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .child(button(t, "approve", "Approve", (_e, cx) => this.runAction(cx, key, "approve", detail, "", null), { enabled: enabled && !own }))
          .child(button(t, "request-changes", "Request changes", (_e, cx) => this.compose(cx, key, "request_changes"), { enabled: enabled && !own }))
          .child(button(t, "comment", "Comment", (_e, cx) => this.compose(cx, key, "comment"), { enabled }))
          .child(button(t, "merge", "Merge", (_e, cx) => this.askMerge(cx, key, detail), { enabled })),
      )
      .when(own, (el) => el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child(OWN_PR)));
    if (act.composing !== null && this.bodyInput) {
      box = box.child(
        v_flex()
          .gap(6)
          .child(div().text_size(12).font_semibold().child(act.composing === "request_changes" ? "Request changes" : "Comment"))
          .when(act.composing === "request_changes" && act.draftText !== null, (el) =>
            el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child("Your comment is already a pending review comment. Submit publishes it.")),
          )
          .child(textBox(t, "body", this.bodyInput, this.focused === "body"))
          .child(
            h_flex()
              .gap(8)
              .child(button(t, "submit-body", "Submit", (_e, cx) => this.submitBody(cx), { primary: true, enabled }))
              .child(button(t, "cancel-body", "Cancel", cancel({ composing: null }))),
          ),
      );
    }
    if (act.confirm !== null) {
      const method = act.confirm.method;
      box = box.child(
        v_flex()
          .gap(6)
          .child(div().text_size(12).whitespace_normal().child(mergePrompt(detail, method)))
          .child(
            h_flex()
              .gap(8)
              .child(button(t, "confirm-merge", "Merge", (_e, cx) => this.runAction(cx, key, "merge", confirmedDetail(detail, act.confirm), "", method), { primary: true, enabled }))
              .child(button(t, "cancel-merge", "Cancel", cancel({ confirm: null }))),
          ),
      );
    }
    return box;
  }
}

const REVIEW_WORDS = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  dismissed: "Dismissed",
  pending: "Pending",
  requested: "Review requested",
};

const MERGE_WORDS = { mergeable: "Mergeable", conflicting: "Has conflicts", blocked: "Blocked", unknown: "Not checked yet" };

function prState(pr) {
  if (pr.state === "merged") return "Merged";
  if (pr.state === "closed") return "Closed";
  return pr.isDraft ? "Draft" : "Open";
}

/** A 44 px board row, two lines. Click opens the pull request pane. `reviewed` adds a dot when a review agent worktree exists. */
function prRow(t, id, pr, selected, now, reviewed) {
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
        .when(review !== null, (el) => el.child(div().flex_none().text_color(pr.reviewDecision === "changes_requested" ? t.blocked : t.dim).child(review ?? "")))
        .when(reviewed, (el) => el.child(div().id(`${id}-agent`).size(6).flex_none().rounded_full().bg(t.accent).tooltip("Review agent worktree"))),
    );
}

/**
 * Opens the Review with agent dialog for a pull request. The dialog gets what it needs in its
 * props, and `owner` names the pane copy that runs its Start request.
 */
function openReview(pr, localPath, owner) {
  const target = { key: prKey(pr), provider: pr.provider, host: pr.host, repo: pr.repo, number: pr.number, title: pr.title, localPath };
  // A click beside the dialog does not close it, so a running Start is not cut off by a stray click.
  openOverlay({ mod: MOD, props: { view: "review", pr: target, owner }, kind: "dialog", modal: true, width: REVIEW_WIDTH, height: REVIEW_HEIGHT });
}

/** Shows a review run's space: the one that holds its worktree, else a new one there. */
function openRun(reviewRun) {
  const id = spaceFor(spaces(), panes(), reviewRun.path);
  if (id !== null) run("space.select", { id });
  else run("space.new", { folder: reviewRun.path });
}

/** The argus-claude-usage settings this mod reads: account names, hidden and extra profile folders. */
function usageSettings() {
  const value = shared(USAGE_SETTINGS_KEY);
  const v = value && typeof value === "object" ? value : {};
  const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  const names = v.names && typeof v.names === "object" && !Array.isArray(v.names) ? Object.fromEntries(Object.entries(v.names).filter(([, name]) => typeof name === "string" && name.trim() !== "")) : {};
  return { names, hidden: strings(v.hidden), extra: strings(v.extra) };
}

/** File access for the Claude Code profile search, as argus-claude-usage does it. */
function discoveryIO() {
  const dir = home();
  return {
    home: dir,
    async listHome() {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
      } catch {
        return [];
      }
    },
    // readTextFile reads up to 1 MiB; .claude.json can grow past that.
    readText: (path) => readFirst([readTextFile, (p) => readFile(p, "utf8")], path),
  };
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

/** Sets the scope; the list stays open so the other choice can be picked too. Escape or a click outside closes it. */
function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
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

/**
 * Shares the title the Argus pane header shows for this mod's panes. A write
 * renders every mod again, so only a changed title is written, after this render.
 */
function shareTitle(cx, title) {
  if (shared(TITLE_KEY) === title) return;
  cx.spawn(async (cx) => {
    await cx.sleep(0);
    if (shared(TITLE_KEY) !== title) setShared(TITLE_KEY, title);
  });
}
