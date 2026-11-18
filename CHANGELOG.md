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
- `lib/ui.js` holds shared building blocks in the sizes of Herdr's own panels, and `argus-claude-usage` uses Lucide icons.

[Unreleased]: https://github.com/s3rgiosan/argus/commits/main
