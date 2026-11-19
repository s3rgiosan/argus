# Changelog

All notable changes to Argus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The keep-awake button shows a full coffee cup while it keeps the display awake, and an empty cup while it is off.

## [1.6.0] - 2026-11-19

### Added

- The Argus layout uses `argus-spaces`, a copy of Herdr's sidebar that `scripts/build-layout.mjs` writes again on every run. A space row shows no repo or branch text after its name, and the ahead and behind counts stay. When the copy cannot be made, the script says why and the layout keeps Herdr's sidebar.

### Changed

- `scripts/build-layout.mjs` writes the pane header copy and the sidebar copy through one writer, with the same checks for both.

### Fixed

- In the `argus-pane` header, a long title shrinks and truncates, so the split, zoom and close buttons show on hover in a narrow pane.

## [1.5.0] - 2026-11-19

### Added

- The Argus layout uses `argus-pane`, a copy of Herdr's pane header that `scripts/build-layout.mjs` writes again on every run. A pull request pane shows "#12 · <title>" and a task pane shows "T12 · <title>" in place of the mod name. When the copy cannot be made, the script says why and the layout keeps Herdr's header.

## [1.4.1] - 2026-11-19

### Fixed

- On GitLab, Request changes lists your pending review comments first, because a publish sends all of them. It refuses when other comments are pending, so a comment is never posted twice and a comment you left on GitLab is not sent with it.
- After a failed publish on GitLab, a Submit publishes the kept comment only when the comment box still has the same text, and refuses a changed text.
- Merge sends the head commit that the confirm showed, so commits pushed after the confirm opened make the merge fail.
- A review action runs once per pull request across all panes, and its buttons are off in every pane while it runs.
- After any review action, failed or not, the board reads again.
- After a successful comment, the comment box keeps text you typed while the action ran.
- A comment that was sent no longer comes back when you switch pull requests while it runs.
- The pane reads your GitHub login again after 5 minutes, so `gh auth switch` reaches the own pull request check, and a failed read is not repeated before every detail read.
- In the scope popups, a click moves the keyboard highlight to the clicked row, and a picked project without pull requests or tasks keeps its row and tick.
- In the Tasks scope popup, the keys work again when the project being renamed leaves the list.

## [1.4.0] - 2026-11-19

### Added

- The `argus-pull-requests` pane has Approve, Request changes, Comment and Merge buttons for an open pull request, run through `gh` or `glab`. The pane reads the pull request again after each action and shows the CLI's message when one fails.
- Request changes and Comment open a comment box, and an empty comment is not sent.
- Approve and Request changes are off on a GitHub pull request you opened, with a note that says why.
- Merge asks first, naming the pull request, the base branch and the merge method. On GitHub it uses your default method when the repo allows it, else the first allowed of merge commit, squash and rebase. On GitLab it sends no method flag, only `--squash` when the merge request is set to squash.
- Merge, and Approve on GitLab, go through only when the pull request head is still the commit the pane shows.
- The `argus-pull-requests` scope has two separate choices: Show (Needs my review, Mine or All open) and In (Follow space, All repos or one project). For example, you can list the pull requests that need your review in the focused space's repo. A saved scope carries over.
- The `argus-tsk` scope has three separate choices: In (Follow space, Desk, All Projects or one project), Thread and Assignee. For example, you can list one assignee's tasks in the focused space's project. A new task gets the scope's thread and assignee. A saved scope carries over.
- The scope popups of `argus-tsk` and `argus-pull-requests` stay open after a pick, so you can set each choice. Follow space is the first In row, and the projects are indented under All Projects or All repos.
- `lib/ui.js` has a shared multi-line text box, used by `argus-tsk` and `argus-pull-requests`.

## [1.3.1] - 2026-11-19

### Changed

- The `argus-panel` column copies its width and its drag limits from the `panel` block in Herdr's `main.json` layout, and falls back to 368, 280 and 900 px when that block is missing. The expand button of `argus-tsk` still goes to the column's maximum and returns to the saved width, else to 368 px.
- The toolbar measures its rendered buttons and resizes its block to that width, so the block fits any font size or label. Its buttons stop the left mouse-down like Herdr's own buttons.
- The keep-awake button is Herdr's square 26 px icon button and toggles on click. When on, it uses the highlight of Herdr's open Files and Changes buttons.
- Section titles use Herdr's group heading style (11.5 px, medium, `dim`) and sentence case in every mod, for example "Needs you", "In motion", "On deck" and "Ready to merge".
- Count badges in the Pull requests and Tasks headers use the pill from Herdr's Changes header.
- Settings pages share one sub-header with Herdr's 14 px side padding, Herdr's Settings switch for toggles, and Herdr's Settings segmented control for "Refresh every".
- Secondary buttons use Herdr's raised style with a border and a hover, and text fields use 12 px text.
- The scope and status popups use Herdr's menu metrics and an accent check tick for the chosen row. Up and Down move the highlight, Enter picks the row and Escape closes the popup.
- A refresh in progress turns the refresh icon, as Herdr turns its own spinner, in place of the "updating" text.
- The chevron, settings, panel, check, x and square-pen icons load from Herdr's `workspace-chrome` mod when the app folder has them, and from each mod's bundled copy otherwise. The project rename button in `argus-tsk` uses `square-pen`.
- The `argus-tsk` header uses 14 px side padding like Herdr's headers.

## [1.3.0] - 2026-11-19

### Added

- The `argus-pull-requests` mod shows GitHub and GitLab pull requests in a Pull requests panel, grouped into Ready to merge, Needs work, Waiting on review and Draft, with a scope picker for Needs my review, Mine, Follow space and each project.
- A filter at the bottom of the `argus-pull-requests` panel matches the title, number, author and branch.
- Clicking a pull request in `argus-pull-requests` opens a pane with its checks, reviews, merge state, description and conversation, with buttons to open it in the browser or check it out in a worktree.
- `argus-pull-requests` reads through `gh` and `glab`, refreshes every 3 minutes by default, reads a project as soon as its space opens, and shows a note when a CLI is missing, signed out or rate limited.
- `lib/follow.js` holds the focused-space helpers that `argus-tsk` and `argus-pull-requests` share.
- The toolbar shows its buttons as icons, labels or both, set with `toolbar.display` in `argus.json` in Herdr's app folder. The default is both. The toolbar block resizes to fit when the value changes.

## [1.2.0] - 2026-11-19

### Added

- The Argus layout has a preview picture in Herdr's Settings under Look, drawn in `layouts/Argus.svg` and copied next to the layout by `scripts/build-layout.mjs`.
- The toolbar reads its button order from `argus.json` in Herdr's app folder, as `{ "toolbar": { "order": ["argus-tsk", "argus-claude-usage"] } }`, and follows the file as it changes. Buttons not in the list follow from A to Z by label.
- The `argus-stay-awake` mod adds a coffee-cup button at the right end of the tab row that keeps the display awake: a click turns it on or off, and a right click keeps it awake until no agent is working.
- `scripts/build-layout.mjs` places the `argus-stay-awake` button in the tab row, right of the toolbar.

### Changed

- The generated layout is named Argus, so Herdr shows it as "Argus" in Settings under Look. `scripts/build-layout.mjs` renames a layout it wrote earlier as `argus.json` and switches to the new name when the old one was shown.

## [1.1.0] - 2026-11-18

### Added

- The `argus-tsk` mod shows the [tsk](https://gettsk.sh) task board in a Tasks panel, with NEEDS YOU, IN MOTION and ON DECK sections and a scope picker for the desk, all projects, projects, threads and assignees.
- `argus-tsk` uses the shared `lib/ui.js` building blocks and Lucide icons.
- `argus-tsk` captures a task from the bottom bar of the panel into the current scope.
- Clicking a task in `argus-tsk` opens it in a pane beside the terminals, where you edit the title, notes, assignee and runs after, set the status, manage steps, block a task or request a review, answer a block, approve or send back a review, mark it done and archive it.
- The `argus-tsk` board and task pane follow the tsk store as it changes, with no manual refresh.
- `argus-tsk` settings set the tsk command and the store folder, and the panel shows a note when tsk is missing or older than 0.13.0.
- `lib/gate.js` and `lib/sync.js` hold the one-run gate and the shared-read lock that `argus-claude-usage` and `argus-tsk` use, and `scripts/sync-lib.mjs` copies the `lib/` files into the mods that import them.
- `argus-tsk` shows each project under its tsk title when it has one, else under its folder name.
- A pencil on each project row of the `argus-tsk` scope list sets or clears the project's title, with tsk 0.14.0 or later.
- While a project is renamed, `argus-tsk` shows its full path under the field, with a hint that an empty field goes back to the folder name.
- In the `argus-tsk` task pane, you pick a status from a dropdown that lists Open, Ready, Started and Done.
- An expand button in the `argus-tsk` board header widens the Tasks panel to 900 px, and a second click puts it back to its earlier width.
- The `argus-tsk` board follows the focused space by default: it shows the tsk project that holds the space's folder, or the desk when no project does or the space is on another machine.

### Changed

- The Argus panel opens 440 px wide, and you can drag it between 280 and 900 px.

## [1.0.0] - 2026-11-18

### Added

- The `argus-claude-usage` mod shows Claude plan usage for every Claude Code account on the computer, found by itself from `~/.claude` and every `~/.claude-*` profile folder.
- Each account shows session, weekly and per-model limits with time to reset and pace, this week's usage by surface, and extra usage.
- `argus-claude-usage` asks Claude Code for usage through its `get_usage` control request, so the mod never reads a sign-in token.
- A toast appears when an account's session or weekly use reaches 80%, once per window.
- `argus-claude-usage` settings hide accounts, set a display name per account, add profile folders, set the refresh interval and point to another `claude` command.
- All open copies of `argus-claude-usage` share one refresh, so at most one `claude` process runs at a time.
- The `argus-toolbar` mod adds buttons beside Herdr's tab bar that open this repo's panel mods in a panel on the right.
- `scripts/build-layout.mjs` writes the `argus` layout from Herdr's current `main` layout, with the toolbar and the panel column added.
- `scripts/install.sh` copies the mods into Herdr's mods folder.
- `lib/ui.js` holds shared building blocks in the sizes of Herdr's own panels, and `argus-claude-usage` uses Lucide icons.

[Unreleased]: https://github.com/s3rgiosan/argus/compare/1.6.0...HEAD
[1.6.0]: https://github.com/s3rgiosan/argus/compare/1.5.0...1.6.0
[1.5.0]: https://github.com/s3rgiosan/argus/compare/1.4.1...1.5.0
[1.4.1]: https://github.com/s3rgiosan/argus/compare/1.4.0...1.4.1
[1.4.0]: https://github.com/s3rgiosan/argus/compare/1.3.1...1.4.0
[1.3.1]: https://github.com/s3rgiosan/argus/compare/1.3.0...1.3.1
[1.3.0]: https://github.com/s3rgiosan/argus/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/s3rgiosan/argus/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/s3rgiosan/argus/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/s3rgiosan/argus/releases/tag/1.0.0
