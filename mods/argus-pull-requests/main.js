// The pull request board in Herdr. One mod with views picked by `props().view`:
// the board (the layout's panel, with a settings page), the scope list (a popup),
// a pull request (a pane beside the terminals) and Review with agent (a dialog).
// Reads go through `git`, `gh` and `glab`.

import { div, svg, image, View } from "gpui-kit";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { exec, home, appHome, readTextFile, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, focused, knownAgents, notify } from "herdr";
import { randomUUID } from "crypto";
import { localFolders, followProjectKey, projectKey, localPathFor } from "./remote.js";
import { normalizeSettings } from "./locate.js";
import { GH_MISSING, GLAB_MISSING, cliError, missingNotes, glabArgs, limitNote, ghDefaultBranchArgs, GL_DEFAULT_BRANCH_QUERY, parseGhDefaultBranch, parseGlDefaultBranch } from "./forge-cli.js";
import { OWN_PR, canAct, ownPr, actionCommand, actionFailure, afterAction, leavePr, ghMethodArgs, headRefusal, mergePrompt, clearsComment, confirmedDetail, draftListArgs, draftPlan, loginFresh, runningOf, withRunning, withoutRunning } from "./actions.js";
import { ghLoginArgs, ghSearchArgs, ghListArgs, ghViewArgs, ghThreadsArgs, ghMergedArgs, ghMergedListArgs, ghPrStateArgs, ghIssuesArgs, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY, GL_MERGED_QUERY, GL_MERGED_LIST_QUERY, GL_MR_STATE_QUERY, GL_ISSUES_QUERY } from "./forge.js";
import { parseGhSearch, parseGhList, parseGhDetail, parseGhThreads, mergeThreads, parseGlabDetail, parseGlabUser, parseGlabProject, parseGhMerged, parseGhMergedList, parseGlMergedList, parseGhMergedFull, parseGlMergedFull, parseGhPrState, parseGlMerged, parseGlMrState, parseGhIssues, parseGlIssues, prKey } from "./model.js";
import { answerFromList, candidates, candidateSignature, mergedHeadsFresh, countMerged, freshForReview, defaultBranchArgs, defaultBranchOf, rowsFor, branchStep, tipArgs, statusArgs, ignoredArgs, ignoredOf, tickedByDefault, readsOnOpen, recheck, reflogArgs, reflogShas, unsavedArgs, hasOutput, submoduleArgs, worktreesInSpaces } from "./cleanup.js";
import { prSignature, assembleBoard, normalizeBoard, emptyMessage, openBranches, mergedCounts, mergedInScope, mergedText, mergedListRead, markStale, fetchedAtOf, keepStale, pickPairs, withoutFailedRepos, keptLists, changesRequested, normalizeScope, prsInScope, scopeItems, scopeTitle, buildGroups, matchesFilter, checksText, prPaneTitle, reviewLabel, shortRepo } from "./board.js";
import { followFolder } from "./follow.js";
import { INTERVALS, ageText, displayName, followStatus, positionIn, rereadDue, scopeProjects, scopeRepos, scopeWhereTitle } from "./forge-board.js";
import { remoteHeadsArgs, parseRemoteHeads, branchRead, issueRead, remoteBranchPlan, issueBranch, issuePlan, filterItems, aheadBehind, localBranchStep, branchNote, fastForwardArgs, remoteBranchArgs, remoteHasBranch, refspecMissing, branchNameError, noticeFor, folderExistsMessage, emptyText, defaultProjectKey, holdsWorktree } from "./newworktree.js";
import { worktreeRoot, checkoutBranch, checkoutPlan, spaceFor, gitError, aheadCount, aheadRefusal } from "./worktree.js";
import { createBoardSync } from "./board-sync.js";
import { createLimiter, mapPool } from "./pool.js";
import { createForgeRunner, CLI_CONCURRENCY, CLI_TIMEOUT, GIT_TIMEOUT } from "./forge-runner.js";
import { agentArgv, agentChoices, branchDelete, branchRefusal, dirtyRefusal, removePlan, reviewBranch, accountSettings, prefillNext, reviewInstructions, reviewPlan, reviewPrompt, reviewRuns, startRefusal, promptFileRefusal, promptFileFor, promptFileReadError, accountFolderOf, templateUses, goneRefusal, keepRuns, takesRequest, resultFor, withResult, markSeen, startState, startMessage, hidesRemoved, templateRefusal, REVIEW_RUN_MS, REVIEW_TAKE_MS } from "./review.js";
import { discover, usageSettings } from "./accounts.js";
import { expandHome } from "./paths.js";
import { profileIO, openInBrowser } from "./pane.js";
import { checkLayout, conversationItems, ghMergeMethods, glMergeMethods, mergeAllowed, mergeMenuNote, openByDefault, sectionOpen, sectionSummaries, shownOrder, verdictOf } from "./detail.js";
import { prPane } from "./detail-view.js";
import { frame, header, subHeader, badge, iconButton, dropdownButton, fieldLabel, hint, errorLine, row as listRow, scrollArea, field, textBox, footer, sectionTitle, note, button, segmented, menuRow, MENU_PAD, MENU_ROW } from "./ui.js";
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
// {id, owner, pr, argv, branch, extra}. The pane clears the key when it takes the request, and keeps
// running it when the dialog closes.
const REVIEW_START_KEY = "argus-pull-requests.reviewStart";
// The state of each recent Start request, by id: {state: "running"|"done", error, at, seen}.
const REVIEW_RESULT_KEY = "argus-pull-requests.reviewResult";
// How long the pane waits for the dialog to show a failed start before it shows a toast.
const REVIEW_TOAST_MS = 1_500;
const REVIEW_WIDTH = 460;
const REVIEW_HEIGHT = 600;
const MOD = "argus-pull-requests";
const POLL = 5_000;
const AGE_TICK = 60_000;
const GIT_LONG_TIMEOUT = 600_000;

/** The most height, in px, of the area above the pane's footer row. */
const BOTTOM_MAX_HEIGHT = 260;
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
    this.focused = null;
    // The gh, glab and folder reads, with what they found. Kept until the refresh button.
    this.forge = createForgeRunner({ exec, home, settings: () => readSettings() });
    // The board read: the lock, forced reads and the folder watch.
    this.boardSync = createBoardSync({
      boardKey: BOARD_KEY,
      lockKey: LOCK_KEY,
      owner: this.owner,
      mod: MOD,
      failure: "Could not read the pull requests",
      shared,
      setShared,
      checking,
      readBoard,
      read: (startedAt) => this.readBoard(startedAt),
      intervalMs: () => readSettings().interval * 60_000,
      folders: () => localFolders(spaces(), panes()),
      forge: this.forge,
      fetchedAt: fetchedAtOf,
      merge: keepStale,
    });
    // Project key -> the default branch (or null) read by git. Kept until the refresh button.
    this.defaultBranches = new Map();
    // Project key -> {heads, signature, at}: the merged heads list and the candidate worktrees it was read for.
    this.mergedHeads = new Map();
    this.login = null;
    // The pane's read: {key, kind: "loading"|"ok"|"error", detail, error, readAt}.
    this.shown = null;
    this.prSeq = 0;
    // The check out action: {key, running, error}.
    // PR key -> {running, error} for the check out action of each pull request.
    this.checkouts = new Map();
    // PR key -> {running, error, confirm, text, draftText, menu, methods} for the review and merge actions of each pull
    // request. `draftText` is the comment this pane left as a pending GitLab draft.
    this.actions = new Map();
    // The PR key whose comment the comment box holds now.
    this.boxKey = null;
    // Worktree path -> {confirm: null|"plain"|"dirty", running, error} for Remove worktree in the Agent section.
    this.removals = new Map();
    // The Merged worktrees view: {phase, scope, notes, groups, ticked, results, current}, or null before it opens.
    // `current` is the path being removed now, else null.
    this.cleanup = null;
    // The New worktree view: {project, picking, tab, items, loading, errors, creating, createError, createNote, lastPr}, or null before it opens. The error and the note are {key, tab, text}.
    // `items` holds the read lists per tab and project key; `loading` and `errors` are keyed by `<tab>|<project key>`.
    this.newWorktree = null;
    // The Review with agent dialog: the pull request it was opened for, the agents (null while they load), the picked one.
    this.review = this.view === "review" ? { pr: props()?.pr ?? null, owner: props()?.owner ?? null, choices: null, picked: 0, accounts: {}, prefilled: null, error: null, starting: false, startId: null, handled: null } : null;
    // The id of the last Start request this pane copy took.
    this.takenReview = null;

    const settings = readSettings();
    // The icons Herdr ships that this mod can load; its own copies show until the probe ends.
    this.found = new Set();
    // The scope list's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();
    this.filterInput = this.input("filter", { placeholder: "Filter by title, number, author or branch" }, () => {});
    this.filterInput.on("change", (_e, cx) => cx.notify());
    this.worktreeFilter = this.input("worktree-filter", { placeholder: "Filter" }, (cx) => this.pickOnlyWorktreeRow(cx));
    this.worktreeFilter.on("change", (_e, cx) => cx.notify());
    this.ghInput = this.input("gh", { placeholder: "gh (from PATH)", value: settings.gh }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.glabInput = this.input("glab", { placeholder: "glab (from PATH)", value: settings.glab }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    // The body of a review comment, for Request changes and Comment.
    this.bodyInput = this.view === "pr" ? this.input("body", { placeholder: "Write a comment", rows: 4 }, (cx) => this.submitComment(cx), { multiline: true }) : null;
    // PR key -> {section: open} for the sections the person folded or opened, and the PR keys whose passed checks show.
    this.folds = new Map();
    this.passedOpen = new Set();
    // Repo -> the merge methods `ghMergeMethods` read for it, kept for this pane copy.
    this.methodCache = new Map();
    if (this.review) {
      const pr = this.review.pr;
      this.modelInput = this.input("model", {}, (cx) => this.startReview(cx));
      this.branchInput = this.input("branch", { value: pr ? reviewBranch(pr, randomUUID().replaceAll("-", "").slice(0, 8)) : "" }, (cx) => this.startReview(cx));
      this.extraInput = this.input("extra", { rows: 4 }, (cx) => this.startReview(cx), { multiline: true });
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
        const board = readBoard();
        const row = board.prs.find((pr) => prKey(pr) === selected.key);
        const due = rereadDue({ signature: prSignature(row), seen: this.shown.seen, boardReadAt: board.readAt, shownReadAt: this.shown.readAt, now: Date.now(), intervalMs: readSettings().interval * 60_000 });
        if (due) this.loadPr(cx, selected);
      });
      return;
    }
    if (this.view !== "board") return;

    this.boardSync.start(cx);
    cx.timer.every(POLL, (cx) => {
      this.boardSync.watchFolders(cx);
      this.boardSync.start(cx);
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
    this.boardSync.release();
  }

  /**
   * One read of every project and search, as the value kept under BOARD_KEY.
   * Failures become notes on the board; nothing throws.
   */
  async readBoard(startedAt) {
    const notes = [];
    const folders = localFolders(spaces(), panes());

    const found = await this.forge.readProjects(folders);
    this.boardSync.renew();

    const gitHub = found.filter((project) => project.provider === "github");
    const gitLabFound = found.filter((project) => project.provider === "gitlab");
    // glab is only looked up when a project needs it.
    const [gh, glab] = await Promise.all([this.forge.locate("gh"), gitLabFound.length > 0 ? this.forge.locate("glab") : null]);
    // A host other than gitlab.com stays only when glab is signed in to it. Without glab, the note says glab is missing.
    const gitLab = glab === null ? gitLabFound : await this.forge.signedInGitLab(glab, gitLabFound, notes);
    const projects = found.filter((project) => project.provider === "github" || gitLab.includes(project));
    this.boardSync.renew();
    notes.push(...missingNotes({ gh: gh !== null, glab: glab !== null, githubProjects: gitHub.length, gitlabProjects: gitLab.length }));

    const result = { needsReview: [], mine: [], projectPrs: {}, listedAt: {} };
    if (gh !== null) {
      await this.readGitHub(gh, gitHub, result, notes);
      this.boardSync.renew();
    }
    if (glab !== null && gitLab.length > 0) {
      await this.readGitLab(glab, gitLab, result, notes);
      this.boardSync.renew();
    }

    const { reviews, listings, failed } = await this.readReviews(projects);
    this.boardSync.renew();
    const counted = await this.readMergedCounts(listings, gh, glab);
    const previous = readBoard();
    const { merged, mergedSeen } = mergedCounts(previous.merged ?? {}, previous.mergedSeen ?? {}, mergedListRead(counted, failed.map((project) => project.key)), Date.now());
    this.boardSync.renew();
    return assembleBoard({ projects, folders, needsReview: result.needsReview, mine: result.mine, projectPrs: result.projectPrs, notes: [...new Set(notes)], readAt: startedAt, reviews, merged, mergedSeen, listedAt: result.listedAt });
  }

  /**
   * The review agent worktrees of the projects with a local checkout, and the worktree lists read.
   * A project whose git call fails keeps the runs of the last read.
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
      this.boardSync.renew();
      return listing;
    });
    const failed = local.filter((_project, index) => listings[index] === null);
    const now = Date.now();
    const read = listings.filter((listing) => listing !== null);
    return { reviews: keepRuns(reviewRuns(read, now), readBoard().reviews, failed, now), listings: read, failed };
  }

  /**
   * The merged worktree count of each project whose worktree list was read. A project without
   * candidate worktrees needs no forge call; a failed call gives null, so the last count stays.
   * Failures add no note: the Merged worktrees view shows them.
   */
  async readMergedCounts(listings, gh, glab) {
    return mapPool(listings, CLI_CONCURRENCY, async ({ project, porcelain }) => {
      let count = null;
      try {
        let defaultBranch = this.defaultBranches.get(project.key);
        if (defaultBranch === undefined) {
          const remoteHead = await exec("git", defaultBranchArgs(), { cwd: project.localPath, timeout: GIT_TIMEOUT });
          defaultBranch = remoteHead.code === 0 ? defaultBranchOf(remoteHead.stdout) : null;
          this.defaultBranches.set(project.key, defaultBranch);
        }
        const worktrees = candidates(porcelain, defaultBranch);
        if (worktrees.length === 0) {
          count = 0;
        } else {
          const github = project.provider === "github";
          const command = github ? gh : glab;
          if (command !== null) {
            const label = github ? "gh" : `glab (${project.host})`;
            const args = github ? ghMergedListArgs(project.repo) : glabArgs(project.host, GL_MERGED_LIST_QUERY, { path: project.repo });
            const signature = candidateSignature(worktrees);
            const kept = this.mergedHeads.get(project.key);
            let heads = null;
            if (mergedHeadsFresh(kept, signature, Date.now())) {
              heads = kept.heads;
            } else {
              heads = await this.forge.attempt(label, command, args, github ? parseGhMergedList : parseGlMergedList, []);
              if (heads !== null) this.mergedHeads.set(project.key, { heads, signature, at: Date.now() });
            }
            if (heads !== null) count = countMerged(worktrees, heads, defaultBranch);
          }
        }
      } catch {
        count = null;
      }
      this.boardSync.renew();
      return { key: project.key, count };
    });
  }

  /**
   * The signed-in GitHub login, kept per gh command setting for LOGIN_TTL. `keepFailure`
   * keeps a failed read too, so the pane does not ask again before every detail read.
   */
  async ghLogin(gh, notes, keepFailure = false) {
    const setting = readSettings().gh;
    if (loginFresh(this.login, setting, Date.now())) return this.login.value;
    const value = await this.forge.attempt("gh", gh, ghLoginArgs(), (text) => {
      const login = text.trim();
      if (login === "") throw new Error("no login returned");
      return login;
    }, notes);
    if (value !== null || keepFailure) this.login = { setting, value, at: Date.now() };
    return value;
  }

  /**
   * Searches, lists and fills in GitHub pull requests into `result`. A repo whose list fails keeps
   * the pull requests of the previous board (`keptLists`), and its note shows.
   */
  async readGitHub(gh, projects, result, notes) {
    const login = await this.ghLogin(gh, notes);
    this.boardSync.renew();
    const [needsPairs, minePairs] = await Promise.all([
      this.forge.attempt("gh", gh, ghSearchArgs("needsReview"), parseGhSearch, notes),
      login === null ? null : this.forge.attempt("gh", gh, ghSearchArgs("mine", login), parseGhSearch, notes),
    ]);
    this.boardSync.renew();
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
      await this.forge.attempt("gh", gh, ghListArgs(repo), (text) => parseGhList(text, repo), notes),
    ]);
    this.boardSync.renew();
    const listedAt = Date.now();
    const all = [];
    const failed = new Set();
    for (const [key, prs] of listed) {
      if (prs === null) {
        failed.add(key);
        continue;
      }
      result.listedAt[key] = listedAt;
      const note = limitNote(`pull requests of ${repos.get(key)}`, prs.length);
      if (note !== null) notes.push(note);
      all.push(...prs);
      if (projects.some((project) => project.key === key)) result.projectPrs[key] = prs;
    }
    const kept = keptLists(readBoard(), [...failed], listedAt);
    all.push(...kept.prs);
    for (const [key, prs] of Object.entries(kept.projectPrs)) if (projects.some((project) => project.key === key)) result.projectPrs[key] = prs;
    Object.assign(result.listedAt, kept.listedAt);

    const pick = async (list) => {
      const { found, missing } = pickPairs(all, list);
      const wanted = withoutFailedRepos(missing, failed);
      const filled = await mapPool(wanted, CLI_CONCURRENCY, (pair) =>
        this.forge.attempt("gh", gh, ghViewArgs(pair.repo, pair.number), (text) => parseGhDetail(text, pair.repo).pr, notes),
      );
      this.boardSync.renew();
      return [...found, ...filled.filter((pr) => pr !== null)];
    };
    result.needsReview.push(...(await pick(needsPairs ?? [])));
    result.mine.push(...(await pick(minePairs ?? [])));
  }

  /**
   * Reads GitLab merge requests per host and per project into `result`. A project whose list
   * fails keeps the merge requests of the previous board (`keptLists`), and its note shows.
   */
  async readGitLab(glab, projects, result, notes) {
    const hosts = [...new Set(projects.map((project) => project.host))];
    const failed = [];
    await Promise.all([
      ...hosts.map(async (host) => {
        const user = await this.forge.attempt(`glab (${host})`, glab, glabArgs(host, GL_USER_QUERY), (text) => parseGlabUser(text, host), notes);
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
        const prs = await this.forge.attempt(
          `glab (${project.host})`,
          glab,
          glabArgs(project.host, GL_PROJECT_QUERY, { path: project.repo }),
          (text) => parseGlabProject(text, project.host),
          notes,
        );
        if (prs === null) {
          failed.push(project.key);
          return;
        }
        result.listedAt[project.key] = Date.now();
        const note = limitNote(`merge requests of ${project.repo}`, prs.length);
        if (note !== null) notes.push(note);
        result.projectPrs[project.key] = prs;
      }),
    ]);
    const kept = keptLists(readBoard(), failed, Date.now());
    Object.assign(result.projectPrs, kept.projectPrs);
    Object.assign(result.listedAt, kept.listedAt);
    this.boardSync.renew();
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
    this.boardSync.refresh(cx);
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
      case "cleanup":
        return this.renderCleanup(t);
      case "newWorktree":
        return this.renderNewWorktree(t);
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
    const shown = prsInScope(board, scope, followed).filter((pr) => matchesFilter(pr, text));
    const selected = readSelected()?.key ?? null;
    const now = Date.now();

    const icon = iconResolver(MOD, this.found);
    const scopeButton = dropdownButton(t, "scope", scopeTitle(scope, board, followed), icon("chevron-down"), () => openScopes()).max_w(150);
    const refresh = iconButton(
      t,
      "refresh",
      ICON("refresh-cw"),
      (_e, cx) => {
        // Looks for gh and glab again too, in case they were installed or updated.
        this.forge.clear();
        this.login = null;
        this.defaultBranches.clear();
        this.mergedHeads.clear();
        this.boardSync.refresh(cx);
      },
      { busy: this.boardSync.reading },
    );
    const settings = iconButton(t, "settings", icon("settings"), (_e, cx) => this.openSettings(cx));
    const head = header(t, "Pull requests", [scopeButton, refresh, settings], { badge: badge(t, String(unfollowed ? 0 : shown.length)) });

    const parts = board.notes.map((message, index) => errorLine(t, message).id(`note-${index}`));
    if (following === "pending") {
      parts.push(note(t, "Reading this space…"));
    } else if (unfollowed) {
      parts.push(note(t, "This space is not a GitHub or GitLab repo."));
    } else if (shown.length === 0) {
      const merged = this.mergedRow(t, board, scope, followed);
      if (merged !== null) parts.push(merged);
      parts.push(note(t, emptyMessage(board, scopeRepos(board, scope, followed))));
    } else {
      const merged = this.mergedRow(t, board, scope, followed);
      if (merged !== null) parts.push(merged);
      for (const group of buildGroups(shown)) {
        parts.push(sectionTitle(t, `${group.title} · ${group.prs.length}`));
        for (const pr of group.prs) parts.push(prRow(t, `pr-${prKey(pr)}`, pr, prKey(pr) === selected, now, (board.reviews[prKey(pr)] ?? []).length > 0));
      }
    }

    return frame(t, "argus-pull-requests")
      .child(head)
      .child(scrollArea("argus-pull-requests-board", parts, { padding: 6 }))
      .child(
        footer(t)
          .child(field(t, "filter", this.filterInput, this.focused === "filter"))
          .child(iconButton(t, "new-worktree", ICON("plus"), (_e, cx) => this.openNewWorktree(cx), { tooltip: "New worktree" })),
      );
  }

  /** The line that says how many merged worktrees the scope has, with a link to Merged worktrees; null at 0. */
  mergedRow(t, board, scope, followed) {
    const text = mergedText(mergedInScope(board, scope, followed));
    if (text === null) return null;
    return listRow(t, "merged-worktrees", { hover: false })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(text))
      .child(
        div()
          .id("merged-review")
          .flex_none()
          .text_size(12)
          .text_color(t.accent)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            // An old list may say none; the board counted some, so the view reads again.
            this.cleanup = freshForReview(this.cleanup);
            this.openCleanup(cx);
          })
          .child("Review"),
      );
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
      const usage = usageSettings(shared(USAGE_SETTINGS_KEY));
      let profiles = [];
      try {
        profiles = await discover(profileIO(), { extra: usage.extra });
      } catch {
        // Without the profiles, Claude Code shows once with its plain command.
      }
      // The per-account settings come from argus.json. A file that cannot be read or has an error pre-fills nothing; Start reports the error.
      let accounts = {};
      try {
        accounts = reviewInstructions(await readTextFile(`${appHome()}/argus.json`), home()).accounts;
      } catch {
        accounts = {};
      }
      this.review = { ...this.review, choices: agentChoices(known, profiles, usage, home()), accounts, error };
      this.prefillExtra();
      cx.notify();
    });
  }

  /** Sets Extra instructions to the picked account's text, unless the person typed in the field. */
  prefillExtra() {
    const review = this.review;
    const choice = review?.choices?.[review.picked] ?? null;
    const next = accountSettings(review?.accounts, choice?.folder ?? null)?.instructions ?? null;
    const step = prefillNext({ current: this.extraInput.value(), prefilled: review?.prefilled ?? null, next });
    let prefilled = step.prefilled;
    if (step.value !== null) {
      this.extraInput.set_value(step.value);
      // The field may change the text it takes; the read-back is what an untouched pre-fill holds.
      if (prefilled !== null) prefilled = this.extraInput.value();
    }
    this.review = { ...review, prefilled };
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
    const startedAt = Date.now();
    this.review = { ...review, starting: true, error: null, startId: id };
    setShared(REVIEW_START_KEY, { id, owner: review.owner, pr: review.pr, argv: agentArgv(choice, model), branch, extra: this.extraInput.value() });
    // A start the pane never takes, or never finishes, ends with a message, and its request is withdrawn
    // so the pane cannot run it later.
    const check = (cx) => {
      if (this.review?.startId !== id) return;
      const message = startMessage(startState(resultFor(shared(REVIEW_RESULT_KEY), id), startedAt, Date.now()));
      if (message === null) return;
      if (shared(REVIEW_START_KEY)?.id === id) setShared(REVIEW_START_KEY, null);
      this.review = { ...this.review, starting: false, error: message };
      cx.notify();
    };
    cx.timer.after(REVIEW_TAKE_MS, check);
    cx.timer.after(REVIEW_RUN_MS, check);
    cx.notify();
  }

  /** Runs a Start request in this pane copy, shares its state, and shows a toast when it fails. */
  runRequest(cx, request) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      setShared(REVIEW_RESULT_KEY, withResult(shared(REVIEW_RESULT_KEY), request.id, "running", null, Date.now()));
      // This copy holds the request now, so its agent command and text leave shared state.
      if (shared(REVIEW_START_KEY)?.id === request.id) setShared(REVIEW_START_KEY, null);
      let error;
      try {
        error = await this.runReview(request.pr, request.argv, request.branch, request.extra);
      } catch (caught) {
        error = caught?.message ?? String(caught);
      }
      setShared(REVIEW_RESULT_KEY, withResult(shared(REVIEW_RESULT_KEY), request.id, "done", error, Date.now()));
      cx.notify();
      if (error === null) return;
      // The dialog shows the error when it is open; the toast is for a dialog that closed.
      await cx.sleep(REVIEW_TOAST_MS);
      if (resultFor(shared(REVIEW_RESULT_KEY), request.id)?.seen !== true) notify({ title: "Review with agent did not start", body: error, level: "warning" });
    });
  }

  /** Runs a review: reads the settings and the pull request, adds the worktree, opens the space. Gives an error text, or null. */
  async runReview(pr, argv, branch, extra) {
    const resolved = worktreeRoot(await readTextFile(`${appHome()}/settings.json`), home());
    if ("error" in resolved) return resolved.error;
    const configured = reviewInstructions(await readTextFile(`${appHome()}/argus.json`), home());
    if (configured.error !== null) return configured.error;
    // A prompt file from argus.json replaces the built-in prompt. The account's file wins over the global one.
    const promptFile = promptFileFor(configured, accountFolderOf(argv, home()));
    let template = null;
    if (promptFile.path !== null) {
      const pathRefusal = promptFileRefusal(promptFile.path, promptFile.source);
      if (pathRefusal !== null) return pathRefusal;
      template = await readTextFile(expandHome(promptFile.path, home()));
      if (template === null) return promptFileReadError(promptFile.path, promptFile.source);
      const refusal = templateRefusal(template);
      if (refusal !== null) return refusal;
    }
    // The prompt names the head commit, so the pull request is read again now. A gh or glab error throws.
    const detail = await this.readDetail(pr);
    // Only a prompt that uses {{base}} puts the base branch in a command.
    const refusal = startRefusal(detail, { checksBase: template === null || templateUses(template, "base") });
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
      task: reviewPrompt({ detail, configured: configured.instructions, extra, template }),
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
      const id = this.review.startId;
      this.review = { ...this.review, handled: id, starting: outcome.error !== null ? false : this.review.starting, error: outcome.error };
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        // Marks the result seen, so the pane shows no toast for an error the dialog shows.
        setShared(REVIEW_RESULT_KEY, markSeen(shared(REVIEW_RESULT_KEY), id));
        if (outcome.error === null) closeOverlay(props()?.overlay);
      });
    }
    const review = this.review;
    const pr = review?.pr ?? null;
    const close = () => closeOverlay(props()?.overlay);
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
          this.prefillExtra();
          cx.notify();
        })
        .when(pic !== null, (el) => el.child(pic))
        .child(div().w_full().text_size(11).text_center().whitespace_normal().child(entry.label));
    });
    const canStart = pr !== null && !review.starting && choice !== null;
    const starting = Boolean(review?.starting);
    // A field grows along its row, so each one sits in its own row.
    const row = (child) => h_flex().w_full().child(child);
    // Each field is a tight group (label, control, help line); the groups sit further apart.
    const group = (id, children) => v_flex().id(id).gap(6).children(children);
    const body = [
      group("group-agent", [
        fieldLabel(t, "Agent"),
        choices === null
          ? note(t, "Looking for agents…")
          : choices.length === 0
            ? note(t, "No agent is installed.")
            : h_flex().flex_wrap().gap(8).children(tiles),
      ]),
    ];
    if (choice?.model) {
      body.push(group("group-model", [fieldLabel(t, "Model"), row(field(t, "model", this.modelInput, this.focused === "model")), hint(t, "Empty uses your default model. Or type an alias, such as sonnet or opus, or a full model ID.")]));
    }
    body.push(
      group("group-branch", [
        fieldLabel(t, "Branch"),
        row(field(t, "branch", this.branchInput, this.focused === "branch")),
        hint(t, `The review worktree's branch. Keep the ${review?.pr ? `argus/review-${review.pr.number}-` : "argus/review-<number>-"} start: the board finds review runs by it.`),
      ]),
      group("group-extra", [
        fieldLabel(t, "Extra instructions"),
        textBox(t, "extra", this.extraInput, this.focused === "extra"),
        hint(t, "Optional. Added to the end of the review prompt, for example: Use the <name> skill. Text for one account comes from argus.json (pullRequests.review.accounts). Text for every review, or a whole prompt of your own, goes in pullRequests.review."),
      ]),
    );
    return v_flex()
      .id("argus-pull-requests-review")
      .track_focus(this.handle)
      .size_full()
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_color(t.foreground)
      .text_size(13)
      .on_key_down((e, cx) => {
        // The pane runs a started review, so closing the dialog never stops it.
        if (e.key !== "escape") return;
        cx.stop_propagation();
        close();
      })
      .child(div().flex_none().text_size(15).font_semibold().child("Review with agent"))
      .when(pr !== null, (el) =>
        el.child(h_flex().flex_none().gap(8).px(10).py(8).rounded(8).bg(t.raised).child(div().flex_none().text_color(t.muted).child(`#${pr.number}`)).child(div().flex_1().min_w(0).truncate().child(pr.title))),
      )
      // The fields scroll, so Cancel and Start stay in view with many agents.
      // The body keeps clear of the scrollbar on its right.
      .child(scrollArea("argus-pull-requests-review-body", [v_flex().pr(14).gap(18).children(body)], { padding: 0 }))
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
    // A removed run stays on the board until the next read; its row goes at once and comes back
    // only if a later read still lists a worktree at that path.
    if (hidesRemoved(state, fetchedAtOf(readBoard()))) return null;
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
          next = { removed: true, at: Date.now() };
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

  /** Opens the Merged worktrees view. It reads only before the first list; finished results stay until Done. */
  openCleanup(cx) {
    this.view = "cleanup";
    this.handle.focus();
    if (readsOnOpen(this.cleanup)) this.readCleanup(cx);
    cx.notify();
  }

  /** Reads the merged worktrees of the projects in the board's scope. */
  readCleanup(cx) {
    const phase = this.cleanup?.phase;
    if (phase === "loading" || phase === "removing") return;
    const board = readBoard();
    const scope = readScope();
    const followed = followedOf(board);
    this.cleanup = { phase: "loading", scope: scopeWhereTitle(scope, board, followed), notes: [], groups: [], ticked: new Set(), results: {}, current: null };
    cx.notify();
    const projects = scopeProjects(board, scope, followed).filter((project) => project.localPath);
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        if (projects.length === 0) {
          this.cleanup = { ...this.cleanup, phase: "list", notes: ["No repo with a local checkout in this scope."] };
        } else {
          const github = projects.some((project) => project.provider === "github");
          const gitlab = projects.some((project) => project.provider === "gitlab");
          const [gh, glab] = await Promise.all([github ? this.forge.locate("gh") : null, gitlab ? this.forge.locate("glab") : null]);
          // One limiter for the whole read, so at most CLI_CONCURRENCY processes run at once.
          const limit = createLimiter(CLI_CONCURRENCY);
          const read = await mapPool(projects, CLI_CONCURRENCY, (project) => this.cleanupGroup(project, board, project.provider === "github" ? gh : glab, limit));
          const notes = [...new Set(read.flatMap((entry) => entry.notes))];
          const groups = read.map((entry) => entry.group).filter((group) => group !== null && group.rows.length > 0);
          const ticked = tickedByDefault(groups.flatMap((group) => group.rows));
          this.cleanup = { ...this.cleanup, phase: "list", notes, groups, ticked };
        }
      } catch (caught) {
        this.cleanup = { ...this.cleanup, phase: "list", notes: [...(this.cleanup?.notes ?? []), caught?.message ?? String(caught)] };
      }
      cx.notify();
    });
  }

  /**
   * One project's rows. A failed worktree list, a missing gh or glab, or a failed forge read
   * leaves the project out and gives notes that name the repo. Every command runs through `limit`.
   * The project's merged list answers the worktrees it can (`answerFromList`); the other
   * worktrees get their own forge read.
   * @returns {Promise<{group: {project: object, rows: object[]}|null, notes: string[]}>}
   */
  async cleanupGroup(project, board, command, limit) {
    const git = (args, cwd) => limit(() => exec("git", args, { cwd, timeout: GIT_TIMEOUT }));
    let listing = null;
    let remoteHead = null;
    let failure = "";
    try {
      [listing, remoteHead] = await Promise.all([git(["worktree", "list", "--porcelain"], project.localPath), git(defaultBranchArgs(), project.localPath)]);
    } catch (caught) {
      failure = caught?.message ?? String(caught);
      listing = null;
    }
    if (listing === null || listing.code !== 0) return { group: null, notes: [`${project.repo}: could not list worktrees (${listing === null ? failure : gitError(listing)})`] };
    let defaultBranch = remoteHead.code === 0 ? defaultBranchOf(remoteHead.stdout) : null;
    let worktrees = candidates(listing.stdout, defaultBranch);
    if (worktrees.length === 0) return { group: null, notes: [] };
    if (command === null) return { group: null, notes: [project.provider === "github" ? GH_MISSING : GLAB_MISSING] };

    const github = project.provider === "github";
    const label = github ? "gh" : `glab (${project.host})`;
    const ask = (args, parse, notes) => limit(() => this.forge.attempt(label, command, args, parse, notes));
    if (defaultBranch === null) {
      // A failed read leaves the default branch unknown: any base then counts.
      const args = github ? ghDefaultBranchArgs(project.repo) : glabArgs(project.host, GL_DEFAULT_BRANCH_QUERY, { path: project.repo });
      defaultBranch = await ask(args, github ? parseGhDefaultBranch : parseGlDefaultBranch, []);
      if (defaultBranch !== null) worktrees = candidates(listing.stdout, defaultBranch);
      if (worktrees.length === 0) return { group: null, notes: [] };
    }

    // The merged list reads beside the checks. A failed list read gives null, so every worktree gets its own read.
    const listRead = ask(github ? ghMergedListArgs(project.repo) : glabArgs(project.host, GL_MERGED_LIST_QUERY, { path: project.repo }), github ? parseGhMergedFull : parseGlMergedFull, []);
    // A worktree whose checks cannot be read counts as one with changes.
    const dirty = new Set();
    const ignored = {};
    const unsaved = new Set();
    const submodules = new Set();
    await mapPool(
      worktrees.filter((worktree) => !worktree.prunable),
      CLI_CONCURRENCY,
      async (worktree) => {
        try {
          const status = await git(statusArgs(), worktree.path);
          if (status.code !== 0 || hasOutput(status.stdout)) dirty.add(worktree.path);
          const listed = await git(ignoredArgs(), worktree.path);
          if (listed.code === 0) ignored[worktree.path] = ignoredOf(listed.stdout);
          else dirty.add(worktree.path);
          const subs = await git(submoduleArgs(), worktree.path);
          if (subs.code !== 0 || hasOutput(subs.stdout)) submodules.add(worktree.path);
          const reflog = await git(reflogArgs(), worktree.path);
          const check = reflog.code === 0 ? unsavedArgs(reflogShas(reflog.stdout)) : null;
          if (reflog.code !== 0) unsaved.add(worktree.path);
          else if (check !== null) {
            const found = await git(check, worktree.path);
            if (found.code !== 0 || hasOutput(found.stdout)) unsaved.add(worktree.path);
          }
        } catch {
          dirty.add(worktree.path);
        }
      },
    );
    const inSpace = worktreesInSpaces(worktrees, spaces(), panes());

    const notes = [];
    const answered = answerFromList(worktrees, await listRead);
    const merged = answered.merged;
    const reviewMerged = answered.reviewMerged;
    await mapPool(answered.rest, CLI_CONCURRENCY, async (worktree) => {
      // The project stops reading after its first failed forge read.
      if (notes.length > 0) return;
      if (worktree.review !== null) {
        const args = github ? ghPrStateArgs(project.repo, worktree.review) : glabArgs(project.host, GL_MR_STATE_QUERY, { path: project.repo, iid: String(worktree.review) });
        reviewMerged[worktree.review] = await ask(args, github ? parseGhPrState : parseGlMrState, notes);
      } else {
        const args = github ? ghMergedArgs(project.repo, worktree.branch) : glabArgs(project.host, GL_MERGED_QUERY, { path: project.repo, branch: worktree.branch });
        merged[worktree.branch] = (await ask(args, github ? parseGhMerged : parseGlMerged, notes)) ?? [];
      }
    });
    // A failed read could hide a merged pull request or mark one wrongly, so the project is left out.
    if (notes.length > 0) return { group: null, notes: notes.map((text) => `${project.repo}: ${text}`) };
    return { group: { project, rows: rowsFor({ worktrees, merged, reviewMerged, dirty, inSpace, openBranches: openBranches(board, project), ignored, submodules, unsaved, defaultBranch }) }, notes: [] };
  }

  /** Removes the ticked worktrees one by one, then prunes the worktree list of a project that held a gone worktree. */
  removeCleanup(cx) {
    const state = this.cleanup;
    if (state === null || state.phase !== "list" || state.ticked.size === 0) return;
    this.cleanup = { ...state, phase: "removing", results: {}, current: null };
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      const results = {};
      const notes = [...state.notes];
      try {
        for (const group of state.groups) {
          const cwd = group.project.localPath;
          const rows = group.rows.filter((row) => row.reason === null && state.ticked.has(row.path));
          if (rows.length === 0) continue;
          let anyGone = false;
          for (const row of rows) {
            this.cleanup = { ...this.cleanup, current: row.path };
            cx.notify();
            const outcome = await this.removeMerged(row, cwd);
            results[row.path] = outcome.text;
            if (outcome.gone) anyGone = true;
            this.cleanup = { ...this.cleanup, results: { ...results }, current: null };
            cx.notify();
          }
          if (!anyGone) continue;
          try {
            await exec("git", ["worktree", "prune"], { cwd, timeout: GIT_TIMEOUT });
          } catch {
            // A prune that fails leaves stale entries that the next `git worktree prune` clears.
          }
        }
        setShared(BOARD_KEY, markStale(readBoard(), Date.now()));
      } catch (caught) {
        notes.push(caught?.message ?? String(caught));
      }
      this.cleanup = { ...this.cleanup, phase: "done", results, notes, current: null };
      cx.notify();
    });
  }

  /**
   * Removes one worktree without `--force`, then its branch when `branchStep` allows it.
   * `gone` is true when the worktree was already gone, so the project needs a prune.
   * @returns {Promise<{text: string, gone: boolean}>} The result text of the row.
   */
  async removeMerged(row, cwd) {
    // A space may have opened the worktree after the list was read.
    if (worktreesInSpaces([row], spaces(), panes()).size > 0) return { text: "open in a space", gone: false };
    try {
      if (!row.prunable) {
        // The worktree may have changed after the list was read.
        let statusOut = null;
        let ignoredNow = null;
        const status = await exec("git", statusArgs(), { cwd: row.path, timeout: GIT_TIMEOUT });
        if (status.code === 0) statusOut = status.stdout;
        const listed = await exec("git", ignoredArgs(), { cwd: row.path, timeout: GIT_TIMEOUT });
        if (listed.code === 0) ignoredNow = ignoredOf(listed.stdout);
        const changed = recheck(row, statusOut, ignoredNow);
        if (changed !== null) return { text: changed, gone: false };
      }
      const removed = await exec("git", removePlan(row, false), { cwd, timeout: GIT_TIMEOUT });
      const gone = removed.code !== 0 && goneRefusal(removed.stderr);
      if (removed.code !== 0 && !gone) return { text: dirtyRefusal(removed.stderr) ? "has changes" : gitError(removed), gone: false };
      const tip = await exec("git", tipArgs(row.branch), { cwd, timeout: GIT_TIMEOUT });
      const step = branchStep(row, tip.code === 0 ? tip.stdout.trim() : null);
      if (step.kept !== null) return { text: `removed, branch kept: ${step.kept}`, gone };
      if (step.args === null) return { text: "removed", gone };
      const deleted = await exec("git", step.args, { cwd, timeout: GIT_TIMEOUT });
      return { text: deleted.code === 0 ? "removed" : `removed, branch kept: ${gitError(deleted)}`, gone };
    } catch (caught) {
      return { text: caught?.message ?? String(caught), gone: false };
    }
  }

  renderCleanup(t) {
    const state = this.cleanup;
    const icon = iconResolver(MOD, this.found);
    const now = Date.now();
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
    const phase = state?.phase ?? "loading";
    const refresh = iconButton(t, "cleanup-refresh", ICON("refresh-cw"), (_e, cx) => this.readCleanup(cx), { busy: phase === "loading", enabled: phase === "list", tooltip: "Read again" });
    const head = subHeader(t, back, "Merged worktrees", icon("chevron-left")).child(div().flex_1()).child(refresh);

    const parts = [];
    if (state !== null) parts.push(hint(t, `Scope: ${state.scope}. Only worktrees whose pull request is merged are listed.`).px(8).pb(4));
    for (const [index, text] of (state?.notes ?? []).entries()) parts.push(errorLine(t, text).id(`cleanup-note-${index}`));
    if (phase === "loading") {
      parts.push(note(t, "Loading…"));
    } else if (state.groups.length === 0) {
      parts.push(note(t, "No merged worktrees here"));
    } else {
      for (const group of state.groups) {
        parts.push(sectionTitle(t, `${group.project.repo} · ${group.rows.length}`));
        for (const row of group.rows) parts.push(this.cleanupRow(t, icon, row, state, now));
      }
    }

    const count = state === null ? 0 : state.groups.flatMap((group) => group.rows).filter((row) => row.reason === null && state.ticked.has(row.path)).length;
    // Done clears the results, so the next open reads again; Back keeps them.
    const done = (_e, cx) => {
      this.cleanup = null;
      this.view = "board";
      cx.notify();
    };
    let actions;
    if (phase === "done") {
      actions = [button(t, "cleanup-done", "Done", done, { primary: true })];
    } else if (phase === "removing") {
      actions = [div().text_size(12).text_color(t.muted).child("Removing…")];
    } else {
      actions = [button(t, "cleanup-cancel", "Cancel", back), button(t, "cleanup-remove", `Remove ${count}`, (_e, cx) => this.removeCleanup(cx), { primary: true, enabled: count > 0 && phase === "list" })];
    }

    return frame(t, "argus-pull-requests-cleanup")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        // Escape goes back and leaves a running removal alone; Enter removes the ticked rows.
        if (e.key === "escape") {
          cx.stop_propagation();
          back(e, cx);
        } else if (e.key === "enter" && phase === "list" && count > 0) {
          cx.stop_propagation();
          this.removeCleanup(cx);
        }
      })
      .child(head)
      .child(scrollArea("argus-pull-requests-cleanup-list", parts, { padding: 6 }))
      .child(footer(t).child(h_flex().w_full().gap(8).items_center().justify_end().children(actions)));
  }

  /** One worktree: a tick for a removable row, the branch, the pull request and its state or result. */
  cleanupRow(t, icon, row, state, now) {
    const removable = row.reason === null;
    const ticked = removable && state.ticked.has(row.path);
    const result = Object.hasOwn(state.results, row.path) ? state.results[row.path] : null;
    const removing = result === null && state.phase === "removing" && state.current === row.path;
    const box = div()
      .flex_none()
      .size(14)
      .rounded(4)
      .border_1()
      .border_color(ticked ? t.accent : t.border)
      .bg(ticked ? t.accent : t.chrome)
      .flex()
      .items_center()
      .justify_center();
    const tick = ticked ? box.child(svg(icon("check")).size(10).text_color(t.accent_foreground)) : box;
    let status = row.reason ?? (row.ignored.length > 0 ? "has ignored files" : row.mergedAt === null ? "merged" : `merged ${ageText(row.mergedAt, now)}`);
    let statusColor = row.reason !== null ? t.dim : row.ignored.length > 0 ? t.working : t.dim;
    if (removing) {
      status = "removing…";
      statusColor = t.muted;
    } else if (result !== null) {
      status = result;
      statusColor = result === "removed" ? t.done : result.startsWith("removed, branch kept") ? t.working : t.blocked;
    }
    const clickable = removable && state.phase === "list";
    let line = listRow(t, `cleanup-${row.path}`, { hover: clickable })
      // A row with a result or a reason has no tick box, only its space.
      .child(removable && result === null ? tick : div().flex_none().size(14))
      .child(div().flex_1().min_w(0).truncate().text_color(removable ? t.foreground : t.dim).child(row.branch))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(`#${row.number}`))
      .child(div().flex_none().max_w(170).truncate().text_size(11).text_color(statusColor).child(status));
    if (clickable) {
      line = line.cursor_pointer().on_click((_e, cx) => {
        if (state.ticked.has(row.path)) state.ticked.delete(row.path);
        else state.ticked.add(row.path);
        cx.notify();
      });
    }
    // One tooltip per row: the result, else the ignored files, else the full branch name.
    if (result !== null && result !== "removed") return line.tooltip(result);
    if (result === null && removable && row.ignored.length > 0) {
      // Remove deletes ignored files too, so the tooltip names them; such a row starts unticked.
      const shown = row.ignored.slice(0, 5).join(", ");
      const more = row.ignored.length > 5 ? ` and ${row.ignored.length - 5} more` : "";
      return line.tooltip(`Remove deletes these ignored files: ${shown}${more}`);
    }
    return line.tooltip(row.branch);
  }

  /** Opens the New worktree view and reads the tab it shows. */
  openNewWorktree(cx) {
    this.view = "newWorktree";
    this.handle.focus();
    this.newWorktree ??= { project: null, picking: false, tab: "branch", items: { branch: {}, issue: {} }, loading: {}, errors: {}, creating: null, createError: null, createNote: null, lastPr: null };
    const state = this.newWorktree;
    // The shown repo is set here, so render only reads it.
    state.project = defaultProjectKey(this.worktreeProjects(), followedOf(readBoard()));
    state.picking = false;
    state.createError = null;
    state.createNote = null;
    // The Branch list is read again, so the "worktree" marks are fresh.
    if (state.project !== null) delete state.items.branch[state.project];
    this.readWorktreeTab(cx, false);
    cx.notify();
  }

  /** The projects of the board's scope that have a local checkout. */
  worktreeProjects() {
    const board = readBoard();
    return scopeProjects(board, readScope(), followedOf(board)).filter((project) => project.localPath);
  }

  /** The shown project, or null when its key is not among `projects`. */
  worktreeProject(projects) {
    return projects.find((project) => project.key === this.newWorktree?.project) ?? null;
  }

  /** Whether a create or a pull request check out runs now. */
  worktreeBusy() {
    return this.newWorktree.creating !== null || [...this.checkouts.values()].some((checkout) => checkout.running);
  }

  /** Reads the shown tab of the shown repo unless it is read or loading; `force` reads it again. The pull request tab has no read. */
  readWorktreeTab(cx, force) {
    const project = this.worktreeProject(this.worktreeProjects());
    if (project === null) return;
    this.readWorktreeSlot(cx, project, this.newWorktree.tab, force);
  }

  /** Reads a tab of a repo unless it is read or loading. The old list stays until the new one is in. */
  readWorktreeSlot(cx, project, tab, force) {
    const state = this.newWorktree;
    if (tab === "pr") return;
    const slot = `${tab}|${project.key}`;
    if (state.loading[slot]) return;
    if (!force && Object.hasOwn(state.items[tab], project.key)) return;
    state.loading[slot] = true;
    delete state.errors[slot];
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        const read = tab === "branch" ? await this.readBranches(project) : await this.readIssues(project);
        if (read.error) state.errors[slot] = read.error;
        else state.items[tab][project.key] = read;
      } catch (caught) {
        state.errors[slot] = caught?.message ?? String(caught);
      }
      delete state.loading[slot];
      cx.notify();
    });
  }

  /** The remote branches of a project, with the worktree of each. Gives `{error}` when a git call fails. */
  async readBranches(project) {
    const [heads, list] = await Promise.all([
      exec("git", remoteHeadsArgs(), { cwd: project.localPath, timeout: CLI_TIMEOUT }),
      exec("git", ["worktree", "list", "--porcelain"], { cwd: project.localPath, timeout: GIT_TIMEOUT }),
    ]);
    if (heads.code !== 0) return { error: gitError(heads) };
    if (list.code !== 0) return { error: gitError(list) };
    const defaultBranch = await this.defaultBranchFor(project);
    return branchRead(parseRemoteHeads(heads.stdout), defaultBranch, list.stdout);
  }

  /** The open issues assigned to the signed-in user. Gives `{error}` when gh or glab fails. */
  async readIssues(project) {
    const github = project.provider === "github";
    const command = await this.forge.locate(github ? "gh" : "glab");
    if (command === null) return { error: github ? GH_MISSING : GLAB_MISSING };
    const label = github ? "gh" : `glab (${project.host})`;
    const notes = [];
    let issues = null;
    if (github) {
      issues = await this.forge.attempt(label, command, ghIssuesArgs(project.repo), parseGhIssues, notes);
    } else {
      const user = await this.forge.glUsername(command, project.host, notes);
      if (user !== null) issues = await this.forge.attempt(label, command, glabArgs(project.host, GL_ISSUES_QUERY, { path: project.repo, user }), parseGlIssues, notes);
    }
    return issues === null ? { error: notes[0] ?? `${label}: could not read the issues` } : issueRead(issues);
  }

  /** The default branch of a project: the remote's HEAD, else the forge's answer, else null. */
  async defaultBranchFor(project) {
    const head = await exec("git", defaultBranchArgs(), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    const local = head.code === 0 ? defaultBranchOf(head.stdout) : null;
    if (local !== null) return local;
    const github = project.provider === "github";
    const command = await this.forge.locate(github ? "gh" : "glab");
    if (command === null) return null;
    const args = github ? ghDefaultBranchArgs(project.repo) : glabArgs(project.host, GL_DEFAULT_BRANCH_QUERY, { path: project.repo });
    return this.forge.attempt(github ? "gh" : `glab (${project.host})`, command, args, github ? parseGhDefaultBranch : parseGlDefaultBranch, []);
  }

  /**
   * Runs a create flow for the row `slot` of `project` on `tab`. The flow gives {error, note}; both show under the
   * list while that repo and tab are shown.
   */
  createWorktree(cx, project, tab, slot, task) {
    const state = this.newWorktree;
    if (this.worktreeBusy()) return;
    const scope = { key: project.key, tab };
    state.creating = slot;
    state.createError = null;
    state.createNote = null;
    state.lastPr = null;
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let result;
      try {
        result = await task();
      } catch (caught) {
        result = { error: caught?.message ?? String(caught), note: null };
      }
      state.creating = null;
      state.createError = result.error === null ? null : { ...scope, text: result.error };
      state.createNote = result.note ? { ...scope, text: result.note } : null;
      if (result.error === null) {
        // The Branch list shows the new worktree after this read.
        const created = this.worktreeProjects().find((entry) => entry.key === scope.key);
        if (created !== undefined) this.readWorktreeSlot(cx, created, "branch", true);
      }
      cx.notify();
    });
  }

  /** Selects the space that shows a worktree folder, or opens one. */
  openWorktreeSpace(path) {
    const id = spaceFor(spaces(), panes(), path);
    if (id !== null) run("space.select", { id });
    else run("space.new", { folder: path });
  }

  /** The worktrees folder and the worktree list of a clone; gives an error text instead when either fails. */
  async worktreeContext(localPath) {
    const resolved = worktreeRoot(await readTextFile(`${appHome()}/settings.json`), home());
    if ("error" in resolved) return { error: resolved.error };
    const list = await exec("git", ["worktree", "list", "--porcelain"], { cwd: localPath, timeout: GIT_TIMEOUT });
    if (list.code !== 0) return { error: gitError(list) };
    return { root: resolved.root, porcelain: list.stdout };
  }

  /** Whether something is at `path`, a dangling link included. */
  async folderTaken(path) {
    const found = await exec("test", ["-e", path], { timeout: GIT_TIMEOUT });
    if (found.code === 0) return true;
    const link = await exec("test", ["-L", path], { timeout: GIT_TIMEOUT });
    return link.code === 0;
  }

  /** Runs `worktree add`. A failed add deletes the branch it made; gives an error text, or null on success. */
  async addWorktree(git, plan) {
    const added = await git(plan.add);
    if (added.code === 0) return null;
    if (plan.newBranch) await git(["branch", "-D", plan.branch]);
    return gitError(added);
  }

  /** Starts a worktree from a remote branch; gives {error, note}. */
  async runBranchWorktree(project, branch) {
    const fail = (error) => ({ error, note: null });
    const context = await this.worktreeContext(project.localPath);
    if ("error" in context) return fail(context.error);
    const exists = await exec("git", tipArgs(branch), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    const plan = remoteBranchPlan({ branch, localPath: project.localPath, root: context.root, porcelain: context.porcelain, localExists: exists.code === 0 });
    if (plan.kind === "open") {
      this.openWorktreeSpace(plan.path);
      return { error: null, note: null };
    }
    const git = (args) => exec("git", args, { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
    const invalid = branchNameError(branch, await git(plan.check));
    if (invalid !== null) return fail(invalid);
    if (await this.folderTaken(plan.path)) return fail(folderExistsMessage(plan.path));
    if (plan.prune !== null) {
      const pruned = await git(plan.prune);
      if (pruned.code !== 0) return fail(gitError(pruned));
    }
    const fetched = await git(plan.fetch);
    if (fetched.code !== 0) return fail(gitError(fetched));
    let note = null;
    if (plan.compare !== null) {
      const counted = await git(plan.compare);
      if (counted.code !== 0) return fail(gitError(counted));
      const counts = aheadBehind(counted.stdout);
      if (counts === null) return fail(`git: could not compare the local branch ${branch} with origin/${branch}`);
      const step = localBranchStep(counts);
      if (step === "note") note = branchNote(branch, counts);
      if (step === "fastForward") {
        const local = await git(tipArgs(branch));
        const origin = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
        if (local.code !== 0 || origin.code !== 0) return fail(`git: could not read the tips of ${branch}`);
        const moved = await git(fastForwardArgs(branch, origin.stdout.trim(), local.stdout.trim()));
        if (moved.code !== 0) return fail(gitError(moved));
      }
    }
    const failed = await this.addWorktree(git, plan);
    if (failed !== null) return fail(failed);
    if (plan.track !== null) {
      // The upstream is set by hand: `--track` fails in a single-branch or shallow clone.
      const specs = await git(plan.refspecs);
      const steps = [...plan.track];
      if (refspecMissing(specs.stdout, branch)) steps.push(["config", "--add", "remote.origin.fetch", plan.refspec]);
      for (const step of steps) {
        const set = await git(step);
        if (set.code === 0) continue;
        await git(["worktree", "remove", "--force", plan.path]);
        await git(["branch", "-D", branch]);
        return fail(gitError(set));
      }
    }
    run("space.new", { folder: plan.path });
    return { error: null, note };
  }

  /** Starts a worktree on a branch for an issue; gives {error, note}. */
  async runIssueWorktree(project, issue) {
    const fail = (error) => ({ error, note: null });
    const context = await this.worktreeContext(project.localPath);
    if ("error" in context) return fail(context.error);
    const branch = issueBranch(issue.number, issue.title);
    const exists = await exec("git", tipArgs(branch), { cwd: project.localPath, timeout: GIT_TIMEOUT });
    if (exists.code !== 0) {
      // A branch of that name on the remote is used as it is; no new branch is cut.
      const remote = await exec("git", remoteBranchArgs(branch), { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
      if (remote.code !== 0) return fail(gitError(remote));
      if (remoteHasBranch(remote.stdout, branch)) return this.runBranchWorktree(project, branch);
    }
    const defaultBranch = await this.defaultBranchFor(project);
    if (defaultBranch === null) return fail("Could not read the default branch of the repo.");
    const plan = issuePlan({ ...issue, defaultBranch, localPath: project.localPath, root: context.root, porcelain: context.porcelain, localExists: exists.code === 0 });
    if (plan.kind === "open") {
      this.openWorktreeSpace(plan.path);
      return { error: null, note: null };
    }
    const git = (args) => exec("git", args, { cwd: project.localPath, timeout: GIT_LONG_TIMEOUT });
    const invalid = branchNameError(branch, await git(plan.check));
    if (invalid !== null) return fail(invalid);
    if (await this.folderTaken(plan.path)) return fail(folderExistsMessage(plan.path));
    if (plan.prune !== null) {
      const pruned = await git(plan.prune);
      if (pruned.code !== 0) return fail(gitError(pruned));
    }
    if (plan.fetch !== null) {
      const fetched = await git(plan.fetch);
      if (fetched.code !== 0) return fail(gitError(fetched));
    }
    const failed = await this.addWorktree(git, plan);
    if (failed !== null) return fail(failed);
    run("space.new", { folder: plan.path });
    return { error: null, note: null };
  }

  renderNewWorktree(t) {
    const state = this.newWorktree;
    const icon = iconResolver(MOD, this.found);
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
    const projects = this.worktreeProjects();
    const project = this.worktreeProject(projects);
    const slot = project === null ? null : `${state.tab}|${project.key}`;
    const loading = slot !== null && state.loading[slot] === true;
    const refresh = iconButton(t, "worktree-refresh", ICON("refresh-cw"), (_e, cx) => this.readWorktreeTab(cx, true), { busy: loading, enabled: project !== null && !loading, tooltip: "Read again" });
    const head = subHeader(t, back, "New worktree", icon("chevron-left")).child(div().flex_1()).when(state.tab !== "pr", (el) => el.child(refresh));

    const top = [];
    if (projects.length === 0) {
      top.push(note(t, "No repo with a local checkout in this scope"));
    } else {
      top.push(sectionTitle(t, "Repo"));
      if (project === null && state.project !== null) top.push(note(t, "This repo is no longer in the scope."));
      if (project === null || (projects.length > 1 && state.picking)) {
        const choices = projects.map((entry) =>
          listRow(t, `worktree-repo-${entry.key}`)
            .cursor_pointer()
            .on_click((_e, cx) => {
              state.project = entry.key;
              state.picking = false;
              state.createError = null;
              state.createNote = null;
              this.readWorktreeTab(cx, false);
              cx.notify();
            })
            .child(div().flex_1().min_w(0).truncate().child(entry.repo))
            .child(div().size(12).flex_none().when(entry.key === state.project, (el) => el.child(svg(icon("check")).size(12).text_color(t.accent)))),
        );
        top.push(v_flex().id("worktree-repos").max_h(196).overflow_y_scroll().children(choices));
      } else {
        const change = div()
          .id("worktree-change")
          .flex_none()
          .text_size(12)
          .text_color(t.accent)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            state.picking = true;
            cx.notify();
          })
          .child("Change");
        top.push(
          listRow(t, "worktree-repo", { hover: false })
            .child(div().flex_1().min_w(0).truncate().child(project.repo))
            .when(projects.length > 1, (el) => el.child(change)),
        );
      }
    }
    if (project !== null) {
      top.push(
        h_flex()
          .px(8)
          .py(6)
          .child(
            segmented(
              t,
              "worktree-tab",
              [
                { value: "branch", label: "Branch" },
                { value: "pr", label: "Pull request" },
                { value: "issue", label: "Issue" },
              ],
              state.tab,
              (value, cx) => {
                state.tab = value;
                state.createError = null;
                state.createNote = null;
                this.readWorktreeTab(cx, false);
                cx.notify();
              },
            ),
          ),
      );
      top.push(h_flex().px(8).pb(6).child(field(t, "worktree-filter", this.worktreeFilter, this.focused === "worktree-filter")));
    }

    const parts = [];
    if (project !== null) {
      const text = this.worktreeFilter.value();
      const error = state.errors[slot];
      const read = state.tab === "pr" ? undefined : state.items[state.tab][project.key];
      if (loading && read === undefined) {
        parts.push(note(t, "Loading…"));
      } else if (error) {
        parts.push(errorLine(t, error));
      } else {
        parts.push(...this.worktreeRows(t, project, state, text));
        const readNote = read?.note;
        if (readNote) parts.push(note(t, readNote));
      }
    }

    const createError = project === null ? null : this.worktreeError(state, project.key);
    const createNote = project === null ? null : noticeFor(state.createNote, project.key, state.tab);
    return frame(t, "argus-pull-requests-new-worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        cx.stop_propagation();
        back(e, cx);
      })
      .child(head)
      .child(v_flex().flex_none().px(6).children(top))
      .child(scrollArea("argus-pull-requests-new-worktree-list", parts, { padding: 6 }))
      .when(createNote !== null, (el) => el.child(note(t, createNote)))
      .when(createError !== null, (el) => el.child(errorLine(t, createError).id("worktree-error")));
  }

  /** The create error to show: the one of a branch or issue create, else the one of the last pull request check out. */
  worktreeError(state, key) {
    const created = noticeFor(state.createError, key, state.tab);
    if (created) return created;
    const error = state.lastPr === null ? null : this.checkouts.get(state.lastPr)?.error;
    return error ? error : null;
  }

  /**
   * The rows of the shown tab: `total` before the filter text and the `entries` after it. An entry has the row
   * id, the number (or null), the label, the create slot (or null), whether a worktree exists, whether its
   * check out runs, and `pick`.
   */
  worktreeList(project, text) {
    const state = this.newWorktree;
    const held = state.items.branch[project.key];
    if (state.tab === "pr") {
      const prs = readBoard()
        .prs.filter((pr) => pr.state === "open" && pr.provider === project.provider && pr.host === project.host && pr.repo.toLowerCase() === project.repo.toLowerCase())
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      const entries = filterItems(prs, text, (item) => `#${item.number} ${item.title} ${item.headRef}`).map((pr) => ({
        id: `worktree-pr-${prKey(pr)}`,
        number: pr.number,
        label: pr.title,
        slot: null,
        marked: holdsWorktree(held, checkoutBranch(pr)),
        running: this.checkouts.get(prKey(pr))?.running === true,
        pick: (cx) => {
          state.lastPr = prKey(pr);
          state.createError = null;
          state.createNote = null;
          this.checkOut(cx, pr, project.localPath);
        },
      }));
      return { total: prs.length, entries };
    }
    const read = state.items[state.tab][project.key];
    const all = read?.entries ?? [];
    if (state.tab === "branch") {
      const entries = filterItems(all, text, (item) => item.branch).map((item) => {
        const slot = `branch:${project.key}:${item.branch}`;
        return {
          id: `worktree-branch-${item.branch}`,
          number: null,
          label: item.branch,
          slot,
          marked: item.path !== null,
          running: false,
          pick: (cx) => this.createWorktree(cx, project, "branch", slot, () => this.runBranchWorktree(project, item.branch)),
        };
      });
      return { total: all.length, entries };
    }
    const entries = filterItems(all, text, (item) => `#${item.number} ${item.title}`).map((item) => {
      const slot = `issue:${project.key}:${item.number}`;
      return {
        id: `worktree-issue-${item.number}`,
        number: item.number,
        label: item.title,
        slot,
        marked: holdsWorktree(held, issueBranch(item.number, item.title)),
        running: false,
        pick: (cx) => this.createWorktree(cx, project, "issue", slot, () => this.runIssueWorktree(project, item)),
      };
    });
    return { total: all.length, entries };
  }

  /** The rows of the shown tab, filtered by the filter text. */
  worktreeRows(t, project, state, text) {
    const { total, entries } = this.worktreeList(project, text);
    const busy = this.worktreeBusy();
    const status = (label, color) => div().flex_none().text_size(11).text_color(color).child(label);
    const rows = entries.map((entry) => {
      const creating = entry.running || (entry.slot !== null && state.creating === entry.slot);
      return this.worktreeRow(t, entry.id, busy, entry.pick)
        .when(entry.number !== null, (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child(`#${entry.number}`)))
        .child(div().flex_1().min_w(0).truncate().child(entry.label))
        .when(creating, (el) => el.child(status("creating…", t.muted)))
        .when(!creating && entry.marked, (el) => el.child(status("worktree", t.dim)))
        .tooltip(entry.label);
    });
    return rows.length > 0 ? rows : [note(t, emptyText(state.tab, total, rows.length))];
  }

  /** Enter in the filter picks the only row shown, when nothing is busy. */
  pickOnlyWorktreeRow(cx) {
    if (this.view !== "newWorktree") return;
    const state = this.newWorktree;
    const project = this.worktreeProject(this.worktreeProjects());
    if (project === null || this.worktreeBusy() || state.errors[`${state.tab}|${project.key}`]) return;
    const { entries } = this.worktreeList(project, this.worktreeFilter.value());
    if (entries.length === 1) entries[0].pick(cx);
  }

  /** A pickable 28 px row. A busy row takes no clicks. */
  worktreeRow(t, id, busy, onPick) {
    const line = listRow(t, id, { hover: !busy });
    return busy ? line : line.cursor_pointer().on_click((_e, cx) => onPick(cx));
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
      sectionTitle(t, "Worktrees"),
      h_flex().px(8).py(4).child(button(t, "cleanup-open", "Remove merged worktrees…", (_e, cx) => this.openCleanup(cx))),
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
    // The board row as it is when this read starts; a later change of the row asks for a new read.
    const seen = prSignature(readBoard().prs.find((pr) => prKey(pr) === selected.key));
    const switched = this.shown?.key !== selected.key;
    if (switched) {
      this.shown = { key: selected.key, kind: "loading", detail: null, error: null, readAt, seen };
    } else {
      this.shown = { ...this.shown, readAt, seen };
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
      this.shown = { key: selected.key, readAt, seen, ...next };
      cx.notify();
    });
  }

  /** Reads one pull request through gh or glab; throws a readable error. */
  async readDetail(selected) {
    const gitLab = selected.provider === "gitlab";
    const name = gitLab ? "glab" : "gh";
    const command = await this.forge.locate(name);
    if (command === null) throw new Error(gitLab ? GLAB_MISSING : GH_MISSING);
    const args = gitLab
      ? glabArgs(selected.host, GL_DETAIL_QUERY, { path: selected.repo, iid: String(selected.number) })
      : ghViewArgs(selected.repo, selected.number);
    // The pane needs the GitHub login to turn off the review buttons on your own pull request.
    if (!gitLab) await this.ghLogin(command, [], true);
    if (gitLab) {
      const reply = await exec(command, args, { timeout: CLI_TIMEOUT });
      if (reply.code !== 0) throw new Error(cliError(name, reply));
      return parseGlabDetail(reply.stdout, selected.host);
    }
    // The review threads come from a second read beside the detail. Its failure leaves the pane working without them.
    const [reply, threads] = await Promise.all([
      exec(command, args, { timeout: CLI_TIMEOUT }),
      exec(command, ghThreadsArgs(selected.repo, selected.number), { timeout: CLI_TIMEOUT }).catch((error) => ({ code: -1, stdout: "", stderr: error?.message ?? String(error) })),
    ]);
    if (reply.code !== 0) throw new Error(cliError(name, reply));
    const detail = parseGhDetail(reply.stdout, selected.repo);
    if (threads.code !== 0) return mergeThreads(detail, null, cliError(name, threads));
    try {
      return mergeThreads(detail, parseGhThreads(threads.stdout), null);
    } catch (error) {
      return mergeThreads(detail, null, error?.message ?? String(error));
    }
  }

  /** Opens the space of the pull request's worktree, creating the worktree first when needed. */
  checkOut(cx, pr, localPath) {
    const key = prKey(pr);
    if (this.checkouts.get(key)?.running) return;
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
      if (await this.folderTaken(plan.path)) return folderExistsMessage(plan.path);
      if (plan.prune !== null) {
        const pruned = await git(plan.prune);
        if (pruned.code !== 0) return gitError(pruned);
      }
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
    return this.actions.get(key) ?? { running: null, error: null, confirm: null, text: "", draftText: null, menu: null, methods: null, composing: null };
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

  /** Opens the comment field above the footer for Comment or Request changes. */
  compose(cx, key, kind) {
    this.setAction(key, { composing: kind, menu: null, confirm: null, error: null });
    cx.timer.after(0, () => this.bodyInput?.focus());
    cx.notify();
  }

  /** Runs the open comment field's action with its text. */
  submitComment(cx) {
    const shown = this.shown;
    if (shown?.kind !== "ok") return;
    const state = this.actionState(shown.key);
    // Until the box holds this pull request's comment, it holds the one left behind.
    if (state.composing === null || this.boxKey !== shown.key) return;
    this.runAction(cx, shown.key, state.composing, shown.detail, this.bodyInput?.value() ?? "", null);
  }

  /** Opens or closes a menu of the footer: "merge" (the merge methods) or "more" (⋯: comment, review, check out, browser). */
  toggleMenu(cx, key, detail, menu) {
    const open = this.actionState(key).menu === menu ? null : menu;
    this.setAction(key, { menu: open, error: null });
    if (open === "merge") this.loadMethods(cx, key, detail);
    cx.notify();
  }

  /** Fills the merge menu: GitLab's methods come with the detail; GitHub's are read once per repo. */
  loadMethods(cx, key, detail) {
    if (detail.pr.provider === "gitlab") {
      this.setAction(key, { methods: glMergeMethods(detail) });
      return;
    }
    const cached = this.methodCache.get(detail.pr.repo);
    if (cached) {
      this.setAction(key, { methods: cached });
      return;
    }
    this.setAction(key, { methods: { loading: true } });
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let methods;
      try {
        const gh = await this.forge.locate("gh");
        if (gh === null) {
          methods = { error: GH_MISSING };
        } else {
          const reply = await exec(gh, ghMethodArgs(detail.pr.repo), { timeout: CLI_TIMEOUT });
          methods = reply.code === 0 ? ghMergeMethods(reply.stdout) : { error: cliError("gh", reply) };
          if ("methods" in methods) this.methodCache.set(detail.pr.repo, methods);
        }
      } catch (error) {
        methods = { error: error?.message ?? String(error) };
      }
      this.setAction(key, { methods });
      cx.notify();
    });
  }

  /** Opens the merge confirm for a picked method. The confirm keeps the head it was shown for; a merge of a newer head fails. */
  pickMethod(cx, key, detail, method) {
    this.setAction(key, { menu: null, confirm: { method, headSha: detail.headSha }, error: null });
    cx.notify();
  }

  /**
   * Runs one review or merge action, then reads the pull request again and marks the board
   * stale so a board copy reads it. On success it closes the confirm, and clears the comment
   * bar after its own action while the bar still holds the sent text.
   */
  runAction(cx, key, kind, detail, body, method) {
    if (this.runningOn(key) !== null) return;
    // A confirm opened before a re-read may name a method the merge request no longer allows.
    if (kind === "merge" && method !== null && !mergeAllowed(detail, method)) {
      this.setAction(key, { confirm: null, error: "The merge options changed. Pick a merge method again." });
      cx.notify();
      return;
    }
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
        const cli = await this.forge.locate(command.name);
        if (cli === null) {
          error = command.name === "glab" ? GLAB_MISSING : GH_MISSING;
        } else {
          let run = command;
          // gh pr review has no head pin, so the head is read and compared first.
          if (command.check) {
            const head = await exec(cli, command.check, { timeout: CLI_TIMEOUT });
            error = head.code === 0 ? headRefusal(detail.headSha, head.stdout) : cliError(command.name, head);
          }
          if (error === null && draftStep) {
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
        this.finishRunning(key, { error: null, confirm: null, ...done, ...(clear ? { text: "", composing: null } : {}) });
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

  /** The conversation items of `detail`. The last result is kept while the detail and the order stay the same. */
  conversationFor(detail, order) {
    const memo = this.conversationMemo;
    if (memo && memo.detail === detail && memo.order === order) return memo.items;
    const items = conversationItems(detail, order);
    this.conversationMemo = { detail, order, items };
    return items;
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
    const board = readBoard();
    // A new selection arrives as a re-render; the read runs as a task.
    if (selected && this.shown?.key !== selected.key && !checking()) this.loadPr(cx, selected);
    if (!checking()) {
      // The board comes first, because every pane copy sees the same board; a pane's own read
      // can lag, and two copies with different titles would overwrite each other.
      const listed = selected ? (board.prs.find((pr) => prKey(pr) === selected.key) ?? null) : null;
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
        .child(errorLine(t, shown.error ?? ""));
    }

    const detail = shown.detail;
    const pr = detail.pr;
    const key = shown.key;
    const localPath = localPathFor(board.projects, pr.host, pr.repo);
    const checkout = this.checkouts.get(key) ?? { running: false, error: null };
    const runs = board.reviews[key] ?? [];
    const position = positionIn(shownOrder(board, readScope(), followedOf(board)), key);
    // The runs the section shows: a removed run stays out until the board reads again.
    const shownRuns = [];
    const agentRows = [];
    if (localPath !== null) {
      runs.forEach((reviewRun, index) => {
        const row = this.reviewRunRow(t, index, reviewRun, localPath);
        if (row === null) return;
        shownRuns.push(reviewRun);
        agentRows.push(row);
      });
    }
    // A section the person folded or opened keeps that choice while its default stays the same; the others follow what needs them.
    const defaults = openByDefault(detail, shownRuns);
    const folds = this.folds.get(key) ?? {};
    const open = new Set(["checks", "reviews", "agent", "description", "conversation"].filter((id) => sectionOpen(folds[id], defaults.has(id))));
    // Moves to a neighbour in the board's order, as a row click does.
    const go = (target) => {
      const next = target === null ? null : board.prs.find((candidate) => prKey(candidate) === target);
      if (next) selectPr(next);
    };
    const view = {
      detail,
      verdict: verdictOf(detail),
      summaries: sectionSummaries(detail, shownRuns, localPath !== null),
      open,
      checks: checkLayout(detail.checks, this.passedOpen.has(key)),
      // The display name the forge gives a login, a known bot's name, else the login.
      nameOf: (login) => displayName(login, detail.names),
      items: this.conversationFor(detail, readSettings().conversation),
      position,
      hasCheckout: localPath !== null,
      checkingOut: checkout.running,
      error: checkout.error,
      now: Date.now(),
      age: ageText,
      icon: ICON,
      agentRows,
      bottom: this.bottomBar(t, key, detail, localPath, checkout.running),
    };
    const on = {
      toggle: (id, cx) => {
        this.folds.set(key, { ...folds, [id]: { open: !open.has(id), defaultWas: defaults.has(id) } });
        cx.notify();
      },
      togglePassed: (cx) => {
        if (this.passedOpen.has(key)) this.passedOpen.delete(key);
        else this.passedOpen.add(key);
        cx.notify();
      },
      prev: () => go(position?.prev ?? null),
      next: () => go(position?.next ?? null),
      openBrowser: (cx) => openInBrowser(cx, pr.url),
      // A check's run or job page.
      openCheck: (url, cx) => openInBrowser(cx, url),
      // A link in a comment or the description; only http and https open.
      openLink: (url, cx) => openInBrowser(cx, url),
      checkOut: (cx) => this.checkOut(cx, pr, localPath ?? ""),
    };
    return prPane(t, view, on);
  }

  /**
   * The area under the pane's scroll: the kept GitLab draft, the merge confirm, the running and
   * error lines, the own-PR note, the comment field when open, the open menu, then the footer with
   * Review with agent, Merge ▾ and ⋯. A pull request that is no longer open keeps only ⋯.
   */
  bottomBar(t, key, detail, localPath, checkingOut) {
    const pr = detail.pr;
    const act = this.actionState(key);
    const busy = this.runningOn(key) !== null;
    const enabled = !busy;
    const live = canAct(pr);
    // A null login leaves the buttons on; GitHub's own message then explains a refusal.
    const own = ownPr(pr, this.login?.value ?? null);
    const tick = iconResolver(MOD, this.found)("check");
    const line = (text, color) => div().text_size(11).text_color(color).whitespace_normal().child(text);
    const menuBox = (id, rows) => v_flex().id(id).p(MENU_PAD).rounded(8).border_1().border_color(t.border).bg(t.popover).children(rows);
    // What shows above the footer row. It scrolls past a maximum height, so the footer stays in view.
    const above = [];

    if (live && act.draftText !== null) above.push(line("Your comment is a pending review comment on the merge request. Request changes with the same text publishes it.", t.muted));
    if (live && act.confirm !== null) {
      const method = act.confirm.method;
      above.push(
        h_flex()
          .flex_wrap()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).whitespace_normal().child(mergePrompt(detail, method)))
          .child(button(t, "confirm-merge", "Merge", (_e, cx) => this.runAction(cx, key, "merge", confirmedDetail(detail, act.confirm), "", method), { primary: true, enabled }))
          .child(
            button(t, "cancel-merge", "Cancel", (_e, cx) => {
              this.setAction(key, { confirm: null, error: null });
              cx.notify();
            }),
          ),
      );
    }
    if (busy) above.push(line("Working…", t.muted));
    if (act.error !== null) above.push(errorLine(t, act.error));
    if (live && own) above.push(line(OWN_PR, t.muted));

    if (live && act.composing !== null && this.bodyInput) {
      above.push(
        v_flex()
          .gap(6)
          .child(div().text_size(12).font_semibold().child(act.composing === "request_changes" ? "Request changes" : "Comment"))
          .child(textBox(t, "body", this.bodyInput, this.focused === "body"))
          .child(
            h_flex()
              .flex_wrap()
              .gap(8)
              .child(button(t, "submit-body", act.composing === "request_changes" ? "Request changes" : "Comment", (_e, cx) => this.submitComment(cx), { primary: true, enabled }))
              .child(
                button(t, "cancel-body", "Cancel", (_e, cx) => {
                  this.setAction(key, { composing: null, error: null });
                  cx.notify();
                }),
              ),
          ),
      );
    }

    if (live && act.menu === "merge") {
      // GitLab's methods follow the merge request as read now; GitHub's come from the repo read.
      const methods = pr.provider === "gitlab" ? glMergeMethods(detail) : act.methods;
      let rows;
      if (!methods || methods.loading) rows = [note(t, "Loading…")];
      else if ("error" in methods) rows = [errorLine(t, methods.error)];
      else {
        rows = methods.methods.map((entry, index) =>
          menuRow(t, `merge-method-${index}`, {
            label: entry.label,
            count: entry.isDefault ? "default" : null,
            current: entry.isDefault,
            enabled,
            tick,
            onClick: (_e, cx) => this.pickMethod(cx, key, detail, entry.method),
          }),
        );
      }
      const menuNote = mergeMenuNote(detail);
      if (menuNote !== null) rows.push(div().px(8).py(4).text_size(11).text_color(t.muted).whitespace_normal().child(menuNote));
      above.push(menuBox("merge-menu", rows));
    }
    if (act.menu === "more") {
      const pick = (run) => (_e, cx) => {
        this.setAction(key, { menu: null });
        run(cx);
        // Draw again, so the menu closes.
        cx.notify();
      };
      const rows = [];
      if (live) {
        rows.push(
          menuRow(t, "more-comment", { label: "Comment…", enabled, tick, onClick: pick((cx) => this.compose(cx, key, "comment")) }),
          menuRow(t, "more-approve", { label: "Approve", enabled: enabled && !own, tick, onClick: pick((cx) => this.runAction(cx, key, "approve", detail, "", null)) }),
          menuRow(t, "more-request", { label: "Request changes…", enabled: enabled && !own, tick, onClick: pick((cx) => this.compose(cx, key, "request_changes")) }),
          div().my(4).h(1).bg(t.border),
        );
      }
      rows.push(
        menuRow(t, "more-checkout", { label: "Check out in a worktree", enabled: localPath !== null && !checkingOut, tick, onClick: pick((cx) => this.checkOut(cx, pr, localPath ?? "")) }),
        menuRow(t, "more-browser", { label: "Open in browser", tick, onClick: pick((cx) => openInBrowser(cx, pr.url)) }),
      );
      above.push(menuBox("more-menu", rows));
    }

    return v_flex()
      .flex_none()
      .px(12)
      .py(10)
      .gap(8)
      .border_t(1)
      .border_color(t.border)
      .bg(t.background)
      .when(above.length > 0, (el) => el.child(v_flex().id("bottom-above").max_h(BOTTOM_MAX_HEIGHT).overflow_y_scroll().gap(8).children(above)))
      .child(
        h_flex()
          .flex_wrap()
          .gap(6)
          .items_center()
          .when(live, (el) =>
            el
              .child(button(t, "review-agent", "Review with agent", () => openReview(pr, localPath ?? "", this.owner), { primary: true, enabled: localPath !== null }))
              .child(button(t, "merge", "Merge ▾", (_e, cx) => this.toggleMenu(cx, key, detail, "merge"), { enabled })),
          )
          .child(div().flex_1())
          .child(button(t, "more", "⋯", (_e, cx) => this.toggleMenu(cx, key, detail, "more"))),
      );
  }

}

/** A 44 px board row, two lines. Click opens the pull request pane. `reviewed` adds a dot when a review agent worktree exists. */
function prRow(t, id, pr, selected, now, reviewed) {
  const checks = checksText(pr.checks);
  let checksColor = t.muted;
  if (checks.startsWith("✗")) checksColor = t.blocked;
  else if (checks.startsWith("●")) checksColor = t.working;
  const changes = changesRequested(pr);
  const review = changes ? reviewLabel("changes_requested") : reviewLabel(pr.reviewDecision);
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
        .when(review !== null, (el) => el.child(div().flex_none().text_color(changes ? t.blocked : t.dim).child(review ?? "")))
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

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

/** Sets the scope; the list stays open so the other choice can be picked too. Escape or a click outside closes it. */
function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
}

/** Makes `pr` the selected pull request, which every pull request pane shows. */
function selectPr(pr) {
  setShared(SELECTED_KEY, { key: prKey(pr), provider: pr.provider, host: pr.host, repo: pr.repo, number: pr.number });
}

/**
 * Selects a pull request and shows it: focuses this mod's pane in the shown tab,
 * or splits the tab's focused pane to the right to open one.
 */
export function openPr(pr) {
  selectPr(pr);
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
