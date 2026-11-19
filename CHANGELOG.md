# Changelog

All notable changes to Argus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/s3rgiosan/argus/compare/1.3.1...HEAD
[1.3.1]: https://github.com/s3rgiosan/argus/compare/1.3.0...1.3.1
[1.3.0]: https://github.com/s3rgiosan/argus/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/s3rgiosan/argus/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/s3rgiosan/argus/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/s3rgiosan/argus/releases/tag/1.0.0
