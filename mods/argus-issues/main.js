// The issues board in Herdr. One mod with views picked by `props().view`: the board (the
// layout's panel, with a settings page), the scope and group list (a popup) and an issue (a pane
// beside the terminals). Reads go through `git`, `gh` and `glab`. The mod writes nothing to a
// forge; New worktree in the pane starts a git worktree for the issue and opens its space.

import { div, View } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, home, appHome, readTextFile, checking, theme, shared, setShared, props, run, openOverlay, closeOverlay, panes, spaces, focused } from "herdr";
import { randomUUID } from "crypto";
import { localFolders, followProjectKey } from "./remote.js";
import { GH_MISSING, GLAB_MISSING, cliError, ghIssuesOff, glabArgs, limitNote, missingNotes } from "./forge-cli.js";
import { INTERVALS, ageText, followStatus, normalizeSettings, positionIn, rereadDue, scopeReads, scopeRepos, searchRead } from "./forge-board.js";
import { createForgeRunner, CLI_CONCURRENCY, CLI_TIMEOUT } from "./forge-runner.js";
import { createBoardSync } from "./board-sync.js";
import { createWorktreeRunner } from "./worktree-runner.js";
import { readForge, saveForge } from "./forge-settings.js";
import { mapPool } from "./pool.js";
import { ghSearchArgs, ghListArgs, ghViewArgs, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY } from "./forge.js";
import { issueKey, parseGhSearch, parseGhList, parseGhView, parseGlUser, parseGlProject, parseGlDetail } from "./model.js";
import { GROUPINGS, assembleBoard, normalizeBoard, normalizeScope, normalizeGrouping, issuesInScope, scopeItems, scopeTitle, mentionsNote, buildGroups, shownOrder, matchesFilter, rowDetail, assigneesText, emptyMessage, issuePaneTitle, issueSignature, keptLists, worktreeTarget, worktreeState } from "./board.js";
import { SECTIONS, namesOf, commentItems, sectionSummaries } from "./detail.js";
import { issuePane } from "./detail-view.js";
import { followFolder } from "./follow.js";
import { openInBrowser, openModPane, setTitle, shareTitle, createInputs } from "./pane.js";
import { frame, header, subHeader, badge, iconButton, dropdownButton, errorLine, scrollArea, field, footer, sectionTitle, note, segmented, menuRow, forgeCommandFields, intervalPicker, menuPopup, twoLineRow } from "./ui.js";
import { probeIcons, iconResolver } from "./icons.js";
import { menuKey, menuHeight, startAt } from "./menu.js";

const MOD = "argus-issues";
const BOARD_KEY = "argus-issues.board";
const SCOPE_KEY = "argus-issues.scope";
const GROUP_KEY = "argus-issues.groupBy";
const SELECTED_KEY = "argus-issues.selected";
const SETTINGS_KEY = "argus-issues.settings";
const LOCK_KEY = "argus-issues.lock";
const TITLE_KEY = "argus-issues.paneTitle";
const POLL = 5_000;
const AGE_TICK = 60_000;
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
 * The board lives in `shared` (`argus-issues.board`), so every open copy draws one read.
 * The copy that wins the lock in `shared` runs the commands.
 */
export default class Issues extends View {
  init(_props, cx) {
    this.owner = randomUUID();
    this.view = props()?.view ?? "board";
    this.focused = null;
    // Makes the text inputs; each one tracks focus in `this.focused`.
    this.input = createInputs(this);
    // The gh, glab and folder reads, with what they found. Kept until the refresh button.
    this.forge = createForgeRunner({ exec, home, settings: readForge });
    // Starts worktrees and opens their spaces.
    this.worktrees = createWorktreeRunner({ exec, readTextFile, appHome, home, run, spaces, panes, forge: this.forge });
    // Issue key -> {running, error, note} for the last New worktree of each issue in this pane copy.
    this.worktreeRuns = new Map();
    // The board read: the lock, forced reads and the folder watch.
    this.boardSync = createBoardSync({
      boardKey: BOARD_KEY,
      lockKey: LOCK_KEY,
      owner: this.owner,
      mod: MOD,
      failure: "Could not read the issues",
      shared,
      setShared,
      checking,
      readBoard,
      read: (startedAt) => this.readBoard(startedAt),
      intervalMs: () => readSettings().interval * 60_000,
      folders: () => localFolders(spaces(), panes()),
      forge: this.forge,
    });
    // The pane's read: {key, kind: "loading"|"ok"|"error", detail, error, readAt, seen}. `seen` is the board row's signature at the read.
    this.shown = null;
    this.seq = 0;
    // The failed read again of the shown issue: {key, text}, shown under its header.
    this.readError = null;
    // Issue key -> {section: open} for the sections the person folded or opened.
    this.folds = new Map();
    // The icons Herdr ships that this mod can load; its own copies show until the probe ends.
    this.found = new Set();
    // The scope list's highlighted row; null until a key moves it.
    this.at = null;
    this.handle = cx.focus_handle();

    const forge = readForge();
    this.filterInput = this.input("filter", { placeholder: "Filter by title, number, author, label or assignee" }, () => {});
    this.filterInput.on("change", (_e, cx) => cx.notify());
    this.ghInput = this.input("gh", { placeholder: "gh (from PATH)", value: forge.gh }, (cx) => this.saveSettings(cx), { saveOnBlur: true });
    this.glabInput = this.input("glab", { placeholder: "glab (from PATH)", value: forge.glab }, (cx) => this.saveSettings(cx), { saveOnBlur: true });

    if (checking()) return;
    if (this.view === "scopes") this.handle.focus();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.found = await probeIcons(readTextFile, appHome());
      cx.notify();
    });
    if (this.view === "issue") {
      // The pane reads its issue again when its board row changes, or once an interval when no board copy reads.
      cx.timer.every(POLL, (cx) => {
        const selected = readSelected();
        if (!selected || this.shown?.key !== selected.key) return;
        const board = readBoard();
        const row = board.issues.find((issue) => issueKey(issue) === selected.key);
        const due = rereadDue({ signature: issueSignature(row), seen: this.shown.seen, boardReadAt: board.readAt, shownReadAt: this.shown.readAt, now: Date.now(), intervalMs: readSettings().interval * 60_000 });
        if (due) this.loadIssue(cx, selected);
      });
      cx.timer.every(AGE_TICK, (cx) => cx.notify());
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

  /** Gives the lock back when this copy goes. */
  async close() {
    this.boardSync.release();
  }

  /** One read of every project and search, as the value kept under BOARD_KEY. Failures become notes on the board; nothing throws. */
  async readBoard(startedAt) {
    const notes = [];
    const folders = localFolders(spaces(), panes());
    const found = await this.forge.readProjects(folders);
    this.boardSync.renew();

    const gitHub = found.filter((project) => project.provider === "github");
    const gitLabFound = found.filter((project) => project.provider === "gitlab");
    // gh is looked up always, because its searches cover every repo; glab only when a project needs it.
    const [gh, glab] = await Promise.all([this.forge.locate("gh"), gitLabFound.length > 0 ? this.forge.locate("glab") : null]);
    // A host other than gitlab.com stays only when glab is signed in to it. Without glab, the note says glab is missing.
    const gitLab = glab === null ? gitLabFound : await this.forge.signedInGitLab(glab, gitLabFound, notes);
    const projects = found.filter((project) => project.provider === "github" || gitLab.includes(project));
    this.boardSync.renew();
    notes.push(...missingNotes({ gh: gh !== null, glab: glab !== null, githubProjects: gitHub.length, gitlabProjects: gitLab.length }));

    const result = { assigned: [], created: [], mentions: [], projectIssues: {}, listedAt: {}, worked: [] };
    if (gh !== null) {
      await this.readGitHub(gh, gitHub, result, notes);
      this.boardSync.renew();
    }
    if (glab !== null && gitLab.length > 0) {
      await this.readGitLab(glab, gitLab, result, notes);
      this.boardSync.renew();
    }
    return assembleBoard({ projects, folders, ...result, notes: [...new Set(notes)], worked: [...new Set(result.worked)], readAt: startedAt });
  }

  /** The three GitHub searches, then the open issues of each GitHub project. */
  async readGitHub(gh, projects, result, notes) {
    const searched = await Promise.all(GH_SEARCHES.map(([kind]) => this.forge.attempt("gh", gh, ghSearchArgs(kind), parseGhSearch, notes)));
    this.boardSync.renew();
    GH_SEARCHES.forEach(([kind, what], index) => {
      if (searched[index] !== null) result.worked.push(searchRead({ provider: "github", host: "github.com" }));
      const issues = searched[index] ?? [];
      const cut = limitNote(what, issues.length);
      if (cut !== null) notes.push(cut);
      result[kind].push(...issues);
    });
    const failed = [];
    await mapPool(projects, CLI_CONCURRENCY, async (project) => {
      // A repo with issues turned off lists no issues and gets no note.
      const recover = (reply) => (ghIssuesOff(reply) ? [] : null);
      const issues = await this.forge.attempt("gh", gh, ghListArgs(project.repo), (raw) => parseGhList(raw, project.repo), notes, { recover });
      this.boardSync.renew();
      if (issues === null) {
        failed.push(project.key);
        return;
      }
      this.listed(result, project, issues, notes);
    });
    keepFailed(result, failed);
  }

  /** The assigned and created lists of each GitLab host, then the open issues of each GitLab project. */
  async readGitLab(glab, projects, result, notes) {
    const hosts = [...new Set(projects.map((project) => project.host))];
    const failed = [];
    await Promise.all([
      ...hosts.map(async (host) => {
        const user = await this.forge.glUsername(glab, host, notes);
        if (user === null) return;
        const lists = await this.forge.attempt(`glab (${host})`, glab, glabArgs(host, GL_USER_QUERY, { user }), (raw) => parseGlUser(raw, host), notes);
        if (lists === null) return;
        result.worked.push(searchRead({ provider: "gitlab", host }));
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
        const issues = await this.forge.attempt(label, glab, glabArgs(project.host, GL_PROJECT_QUERY, { path: project.repo }), (raw) => parseGlProject(raw, project.host, project.repo), notes);
        this.boardSync.renew();
        if (issues === null) {
          failed.push(project.key);
          return;
        }
        this.listed(result, project, issues, notes);
      }),
    ]);
    keepFailed(result, failed);
  }

  /** Puts the open issues of one project into `result`, with the time of the list and a note when the list was cut. */
  listed(result, project, issues, notes) {
    result.listedAt[project.key] = Date.now();
    result.worked.push(project.key);
    const cut = limitNote(`issues of ${project.repo}`, issues.length);
    if (cut !== null) notes.push(cut);
    result.projectIssues[project.key] = issues;
  }

  openSettings(cx) {
    // Another copy or another forge mod may have changed these since this copy last drew them.
    const forge = readForge();
    this.ghInput.set_value(forge.gh);
    this.glabInput.set_value(forge.glab);
    this.view = "settings";
    cx.notify();
  }

  /** Saves both command fields for every forge mod; a changed command forces a read. */
  saveSettings(cx) {
    if (saveForge(this.ghInput.value(), this.glabInput.value())) this.boardSync.refresh(cx);
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
        this.forge.clear();
        this.boardSync.refresh(cx);
      },
      { busy: this.boardSync.reading, tooltip: "Refresh" },
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
      parts.push(note(t, text.trim() === "" ? emptyMessage(board, scopeRepos(board, scope, followed), scopeReads(board, scope, followed)) : "Nothing matches the filter"));
    } else {
      // An issue with several assignees or labels has a row in each of their groups.
      for (const group of buildGroups(shown, readGrouping())) {
        parts.push(sectionTitle(t, `${group.title} · ${group.issues.length}`));
        for (const issue of group.issues) parts.push(issueRow(t, `issue-${group.key}-${issueKey(issue)}`, issue, issueKey(issue) === selected, now));
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
    const grouping = readGrouping();
    const icon = iconResolver(MOD, this.found);
    const scopeRow = (entry, indent = false) => ({ key: entry.key, label: entry.label, count: String(entry.count), current: entry.current, indent, pick: () => pickScope(entry.scope) });
    // Show, In and Group by are separate choices; picking a row keeps the list open for the others.
    const sections = [
      ["Show", items.show.map((entry) => scopeRow(entry))],
      // Each project is one more In choice, indented under All repos.
      ["In", [...items.where.map((entry) => scopeRow(entry)), ...items.projects.map((entry) => scopeRow(entry, true))]],
      ["Group by", GROUPINGS.map(([id, label]) => ({ key: id, label, count: null, current: grouping === id, indent: false, pick: () => pickGrouping(id) }))],
    ];
    const entries = sections.flatMap(([, rows]) => rows);
    const active = this.at ?? startAt(entries);
    const parts = [];
    let index = 0;
    for (const [title, rows] of sections) {
      parts.push(sectionTitle(t, title));
      for (const entry of rows) {
        const at = index++;
        parts.push(
          menuRow(t, `scope-${at}-${entry.key}`, {
            label: entry.label,
            indent: entry.indent,
            count: entry.count,
            active: at === active,
            current: entry.current,
            tick: icon("check"),
            // The keyboard highlight follows a click, so Up and Down start from the picked row.
            onClick: () => {
              this.at = at;
              entry.pick();
            },
          }),
        );
      }
    }
    return menuPopup(t, {
      id: "argus-issues-scopes",
      listId: "argus-issues-scope-list",
      handle: this.handle,
      height: menuHeight(entries.length, sections.length, { max: SCOPES_HEIGHT }),
      parts,
      onKey: (e, cx) => {
        const next = menuKey(active, e.key, entries.length);
        if (!next.handled) return;
        this.at = next.at;
        if (next.action === "pick") entries[next.at].pick();
        else if (next.action === "close") closeOverlay(props()?.overlay);
        cx.notify();
      },
    });
  }

  renderSettings(t) {
    const settings = readSettings();
    const icon = iconResolver(MOD, this.found);
    const back = (_e, cx) => {
      this.view = "board";
      cx.notify();
    };
    const parts = [
      ...forgeCommandFields(t, { gh: this.ghInput, glab: this.glabInput }, this.focused),
      ...intervalPicker(t, INTERVALS, settings.interval, (minutes) => writeSettings({ interval: minutes })),
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
            (order) => writeSettings({ conversation: order }),
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
    // The board row as it is when this read starts; a later change of the row asks for a new read.
    const seen = issueSignature(readBoard().issues.find((issue) => issueKey(issue) === selected.key));
    const switched = this.shown?.key !== selected.key;
    if (switched) {
      this.shown = { key: selected.key, kind: "loading", detail: null, error: null, readAt, seen };
      this.readError = null;
    } else {
      this.shown = { ...this.shown, readAt, seen };
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
        this.shown = { ...this.shown, readAt, seen };
        this.readError = { key: selected.key, text: next.error };
      } else {
        this.shown = { key: selected.key, readAt, seen, ...next };
        // A good read clears the error line of an earlier failed one.
        if (next.kind === "ok" && this.readError?.key === selected.key) this.readError = null;
      }
      cx.notify();
    });
  }

  /** Reads one issue through gh or glab; throws a readable error. */
  async readDetail(selected) {
    const gitLab = selected.provider === "gitlab";
    const name = gitLab ? "glab" : "gh";
    const command = await this.forge.locate(name);
    if (command === null) throw new Error(gitLab ? GLAB_MISSING : GH_MISSING);
    const args = gitLab ? glabArgs(selected.host, GL_DETAIL_QUERY, { path: selected.repo, iid: String(selected.number) }) : ghViewArgs(selected.repo, selected.number);
    const reply = await exec(command, args, { timeout: CLI_TIMEOUT });
    if (reply.code !== 0) throw new Error(cliError(name, reply));
    return gitLab ? parseGlDetail(reply.stdout, selected.host, selected.repo) : parseGhView(reply.stdout, selected.repo);
  }

  /**
   * Starts a worktree for `issue` in `project` and opens its space (`createIssueWorktree`). One
   * start runs at a time in this pane copy. The error and the note show in the pane footer.
   */
  startWorktree(cx, key, issue, project) {
    if ([...this.worktreeRuns.values()].some((entry) => entry.running)) return;
    this.worktreeRuns.set(key, { running: true, error: null, note: null });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      let result;
      try {
        result = await this.worktrees.createIssueWorktree(project, { number: issue.number, title: issue.title });
      } catch (caught) {
        result = { error: caught?.message ?? String(caught), note: null };
      }
      this.worktreeRuns.set(key, { running: false, error: result.error, note: result.note });
      cx.notify();
    });
  }

  renderIssue(t, cx) {
    const selected = readSelected();
    // A new selection arrives as a re-render; the read runs as a task.
    if (selected && this.shown?.key !== selected.key && !checking()) this.loadIssue(cx, selected);
    const board = readBoard();
    if (!checking()) {
      // The board comes first, because every pane copy sees the same board.
      const listed = selected ? (board.issues.find((issue) => issueKey(issue) === selected.key) ?? null) : null;
      const read = this.shown?.key === selected?.key ? (this.shown?.detail?.issue ?? null) : null;
      shareTitle(cx, TITLE_KEY, issuePaneTitle(listed ?? read));
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
    const position = positionIn(shownOrder(board, readScope(), followedOf(board), readGrouping()), key);
    const folds = this.folds.get(key) ?? {};
    const open = new Set(SECTIONS.map(([id]) => id).filter((id) => folds[id] !== false));
    // Moves to a neighbour in the board's order, as a row click does.
    const go = (target) => {
      const next = target === null ? null : board.issues.find((issue) => issueKey(issue) === target);
      if (next) selectIssue(next);
    };
    const target = worktreeTarget(board.projects, detail.issue);
    const busy = [...this.worktreeRuns.values()].some((entry) => entry.running);
    const view = {
      detail,
      names: namesOf(detail),
      comments: commentItems(detail, readSettings().conversation),
      summaries: sectionSummaries(detail),
      open,
      position,
      error: this.readError?.key === key ? this.readError.text : null,
      now: Date.now(),
      age: ageText,
      icon: ICON,
      worktree: worktreeState(target, this.worktreeRuns.get(key), busy),
    };
    const on = {
      toggle: (id, cx) => {
        this.folds.set(key, { ...folds, [id]: !open.has(id) });
        cx.notify();
      },
      prev: () => go(position?.prev ?? null),
      next: () => go(position?.next ?? null),
      openBrowser: (cx) => openInBrowser(cx, detail.issue.url),
      // A link in the description or a comment; only http and https open.
      openLink: (url, cx) => openInBrowser(cx, url),
      newWorktree: (cx) => {
        if (target.project !== null) this.startWorktree(cx, key, detail.issue, target.project);
      },
    };
    return issuePane(t, view, on);
  }
}

/** A board row of two lines. Click opens the issue pane. */
function issueRow(t, id, issue, selected, now) {
  const people = assigneesText(issue);
  return twoLineRow(t, id, {
    number: issue.number,
    title: issue.title,
    age: ageText(issue.updatedAt, now),
    detail: rowDetail(issue),
    selected,
    tail: people === "" ? [] : [div().flex_none().max_w(120).truncate().child(people)],
    onClick: () => openIssue(issue),
  });
}

/** Adds the kept lists of the projects whose list failed to `result` (`keptLists`), so one failed read does not hide them. */
function keepFailed(result, failed) {
  const kept = keptLists(readBoard(), failed, Date.now());
  Object.assign(result.projectIssues, kept.projectIssues);
  Object.assign(result.listedAt, kept.listedAt);
}

function openScopes() {
  openOverlay({ mod: MOD, props: { view: "scopes" }, kind: "popup", width: SCOPES_WIDTH, height: SCOPES_HEIGHT });
}

/** Sets the scope; the list stays open so the other choices can be picked too. Escape or a click outside closes it. */
function pickScope(scope) {
  setShared(SCOPE_KEY, scope);
}

/** Sets how the board groups its issues; the list stays open, as for the scope. */
function pickGrouping(id) {
  setShared(GROUP_KEY, id);
}

/** Makes `issue` the selected issue, which every issue pane shows, and puts its number and title in the pane header. */
function selectIssue(issue) {
  setShared(SELECTED_KEY, { key: issueKey(issue), provider: issue.provider, host: issue.host, repo: issue.repo, number: issue.number });
  setTitle(TITLE_KEY, issuePaneTitle(issue));
}

/** Selects an issue and shows it in this mod's pane of the shown tab (`openModPane`). */
function openIssue(issue) {
  selectIssue(issue);
  openModPane(MOD, { view: "issue" });
}

function readSettings() {
  return normalizeSettings(shared(SETTINGS_KEY));
}

/** Changes the board's own settings. */
function writeSettings(patch) {
  setShared(SETTINGS_KEY, { ...readSettings(), ...patch });
}

function readScope() {
  return normalizeScope(shared(SCOPE_KEY));
}

function readGrouping() {
  return normalizeGrouping(shared(GROUP_KEY));
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
