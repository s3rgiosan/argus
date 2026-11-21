# Issues

GitHub issues and GitLab issues as a Herdr panel, with one issue in a pane beside the terminals. Every read goes through `git`, `gh` and `glab`; the mod writes nothing to a forge.

## What you see

- `mod.json`: `{ "place": "none", "title": "Issues", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Issues", "icon": "icons/circle-dot.svg" } }`. The `Argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel.
- One mod, four views picked by `props().view`: none or `"board"` (the panel), `"settings"` (inside the panel), `"scopes"` (popup), `"issue"` (pane).
- Board, drawn with `ui.js` (a copy of `lib/ui.js`): frame; 42 px header with "Issues" (semibold), the count badge, then the scope button (at most 150 px), refresh (spins while this copy reads) and settings icon buttons; scroll area; bottom bar with a 32 px filter field.
- Board body, top to bottom: the read notes as error lines (12 px `blocked`); the Mentions me note for GitLab (12 px `dim`); then one section title per repo, "<repo> · n" (11.5 px, medium, `dim`), each with its rows. Empty states: "Loading…", "No open issues here", "No issues could be read. See the messages above.", "Nothing matches the filter", "Reading this space…", "This space is not a GitHub or GitLab repo.".
- Row, 44 px, radius 7, two lines: `#n` (12 px `muted`), the title (truncated), the update age (11 px `dim`); then "by <author> · <labels>" (11 px `dim`, truncated) and the assignees on the right (`login` or `login +n`, at most 120 px). The selected issue's row is on `selected`; hover is `hover`.
- Scopes popup: `openOverlay({ mod: "argus-issues", props: { view: "scopes" }, kind: "popup", width: 280, height: 420 })`. Sections Show (Assigned to me, Created by me, Mentions me, All open) and In (Follow space, All repos, then each project indented under All repos), in Herdr's menu metrics (`menuRow`: 31 px rows, count on the right, `accent` tick on the current choice). Height: rows × 31 + 2 × 30 for the titles + 10, at most 420.
- Settings view: back header "Settings"; gh command and glab command fields with hints; Refresh every (segmented: 1, 3, 5, 10, 15 min); Comments (segmented: Oldest first, Newest first).
- Issue pane: no frame border. Head (14 px sides, 12 px top, 6 px gap): provider icon (`github` or `gitlab`, 14 px `muted`), "<repo> · #n" (12 px `muted`), "i of n" (12 px `dim`) with arrow-up and arrow-down icon buttons, the external-link icon button; the title (16 px semibold, wrapping); a line with the state chip (`done` for Open, `muted` for Closed), a `working` "confidential" chip when set, and "<name> opened 3d ago · updated 2h ago" (12 px `dim`); then fact rows (12 px, a 72 px `dim` label): Assignees, Labels (`muted` chips), Milestone when set; an error line for a failed Open in browser or a failed read again.
- Then two folding sections, Description and Comments: a 11.5 px `dim` heading row with a chevron and a summary on the right ("None" for an empty description, "n comments"). Description is Markdown (`TextView.markdown`) or "No description". Each comment: name (semibold, login as tooltip), an "internal" chip for a GitLab internal note, the age on the right; then a balloon (radius 8, 1 px `border`) with the Markdown, or "Hidden by GitHub as <reason>." in 12 px `dim`.

## How it behaves

- `shared` keys: `argus-issues.board` `{ issues, scopes: { assigned, created, mentions, projects }, projects, folders, readAt, notes }`; `argus-issues.scope` `{ show: "assigned"|"created"|"mentions"|"all", where: "follow"|"all"|"project", key? }`; `argus-issues.selected` `{ key, provider, host, repo, number }`; `argus-issues.settings` `{ gh, glab, interval, comments }`; `argus-issues.lock` (the reader lock, `lib/sync.js`); `argus-issues.paneTitle` (what the `argus-pane` header shows: `#n · <title>`, else "Issues").
- Projects: the folders of local spaces and their terminals (`localFolders`), probed with `git rev-parse` and `git remote get-url origin`, grouped by forge repo (`mergeProjects`). github.com is GitHub; any other host that is not a known third forge is GitLab.
- A read (one copy at a time: `lib/gate.js` plus the lock) runs each entry of `PROVIDERS` in `main.js`. GitHub: the three `gh search issues` calls (`ghSearchArgs`), then `gh issue list` per GitHub project. GitLab, per host: the username (`GL_USERNAME_QUERY`, kept per glab setting), the assigned and created lists (`GL_USER_QUERY`), and `GL_PROJECT_QUERY` per project. `gh` is looked up always; `glab` only when a GitLab project exists. Each failure becomes one note; a list of 100 adds a "Showing the first 100 …" note.
- `assembleBoard` keeps one copy of each issue (the first one read: the Show lists come before the project lists) and the key lists of each Show choice and project. All open in All repos is every issue; All open in a project is that project's list.
- Timers: the board reads on open, then every `interval` minutes; every 5 s it probes new folders and forces a read when one holds a project the board does not have. Folders without a new project are added to `folders` at once, so Follow space stops waiting.
- Row click: sets `argus-issues.selected`; if the shown tab has a pane of this mod, `pane.focus` it, else `pane.split { direction: "right", mod: "argus-issues", props: { view: "issue" } }` beside the tab's focused pane.
- The pane sees a new selection in render and reads it in a task (`gh issue view` or `GL_DETAIL_QUERY`). A newer read wins. Every 5 s it reads again when the board's `readAt` is newer than its own read; a failed read again keeps the issue and shows the error under the head.
- ↑ and ↓ select the neighbour in the board's order for the current scope (`shownOrder`, `positionIn`). Open in browser and Markdown links run `open` (macOS) or `xdg-open` with the URL, for http and https only.

## Built from

- `main.js`: the `View`; `exec`, `home`, `appHome`, `readTextFile`, `window`, `checking`, `theme`, `shared`, `setShared`, `props`, `run`, `openOverlay`, `closeOverlay`, `panes`, `spaces`, `focused` from `herdr`; `InputState` from `gpui-base`; `randomUUID` from `crypto`.
- `forge.js` (argv and GraphQL text), `model.js` (CLI output to the `Issue` and `Detail` shapes), `board.js` (scopes, groups, filter, row text, empty text), `detail.js` (state text, names, comment order, position), `locate.js` (settings, CLI candidates, error text), `remote.js` (git remotes to projects; the same file as in `argus-pull-requests`). All pure, tested with `node --test` (`tests/issues-*.test.js`).
- `detail-view.js` draws the pane, with `TextView.markdown` from `gpui-base` for the description and the comments.
- `ui.js`, `icons.js`, `menu.js`, `follow.js`, `gate.js`, `sync.js` and `pool.js` are copies of the files in `lib/`.
- Icons: Lucide `circle-dot`, `chevron-down`, `chevron-left`, `chevron-right`, `check`, `refresh-cw`, `settings`, `external-link`, `arrow-up`, `arrow-down`, `github`, `gitlab`, with `LICENSE-Lucide.txt`. On the board, `chevron-down`, `chevron-left`, `check` and `settings` load from Herdr's `workspace-chrome` when it has them (`lib/icons.js`); the pane uses the mod's own copies.

## Watch out

- GitLab's root `issues` query is marked as an experiment in GitLab's schema (since 15.6) and needs at least one filter; the assigned and created lists use it.
- GitLab can return fewer discussions than `first` asks for; `pageInfo.hasNextPage` is what tells that the comments were cut.
- `gh issue list` has no `commentsCount`; `gh search issues` has. `gh search issues` gives the state in lower case, `gh issue list` and `gh issue view` in upper case.
- `gh search issues` uses GitHub's search rate limit; a read makes three searches.
- Issue titles, bodies and comments are written by anyone who can open an issue. They are shown only as text or Markdown; nothing from an issue goes into a shell command.
- `InputState.new` is refused during render: the fields are made in `init`.
- A popup is as tall as its content, up to the height asked for: the scopes list sets its height from its rows.
- Herdr app 0.1.16 does not load a symlinked mod folder: copy it with `scripts/install.sh`.
