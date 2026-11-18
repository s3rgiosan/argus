# Changelog

All notable changes to Argus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `lib/ui.js` holds building blocks in the sizes of Herdr's own panels, which `argus-claude-usage` and `argus-tsk` share, and both mods use Lucide icons.
- The `argus-tsk` mod shows the [tsk](https://gettsk.sh) task board in a Tasks panel, with NEEDS YOU, IN MOTION and ON DECK sections and a scope picker for the desk, all projects, projects, threads and assignees.
- `argus-tsk` captures a task from the bottom bar of the panel into the current scope.
- Clicking a task in `argus-tsk` opens it in a pane beside the terminals, where you edit the title, notes, assignee and runs after, set the status, manage steps, block a task or request a review, answer a block, approve or send back a review, mark it done and archive it.
- The `argus-tsk` board and task pane follow the tsk store as it changes, with no manual refresh.
- `argus-tsk` settings set the tsk command and the store folder, and the panel shows a note when tsk is missing or older than 0.13.0.
- `lib/gate.js` and `lib/sync.js` hold the one-run gate and the shared-read lock that `argus-claude-usage` and `argus-tsk` use, and `scripts/sync-lib.mjs` copies the `lib/` files into the mods that import them.
- `argus-tsk` shows each project under its tsk title when it has one, else under its folder name.
- A pencil on each project row of the `argus-tsk` scope list sets or clears the project's title, with tsk 0.14.0 or later.
- While a project is renamed, `argus-tsk` shows its full path under the field, with a hint that an empty field goes back to the folder name.
- The Argus panel opens 440 px wide, and you can drag it between 280 and 900 px.
- In the `argus-tsk` task pane, you pick a status from a dropdown that lists Open, Ready, Started and Done.
- An expand button in the `argus-tsk` board header widens the Tasks panel to 900 px, and a second click puts it back to its earlier width.
- The `argus-tsk` board follows the focused space by default: it shows the tsk project that holds the space's folder, or the desk when no project does or the space is on another machine.

[Unreleased]: https://github.com/s3rgiosan/argus/commits/main
