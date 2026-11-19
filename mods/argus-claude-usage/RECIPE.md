# Claude usage

A panel with Claude plan usage for every Claude Code account on this computer, one section per account: session, weekly and per-model limits with reset times and pace, this week's usage by surface, and extra usage. It finds the accounts by itself, so a work account in its own `CLAUDE_CONFIG_DIR` shows next to the personal one.

## What you see

- Opens from the Usage button of `argus-toolbar` in the `Argus` layout (`mod.json` declares `"panel": { "label": "Usage", "icon": "icons/chart-line.svg" }`) as a panel in the `argus-panel` column (size, min and max copied from Herdr's `panel` block: 368 px, 280 to 900 px today), as a popup (`mod.open`, 360 × 640 from `mod.json` `overlay`), or as a pane (`pane.split { direction: "right", mod: "argus-claude-usage" }`); the popup's pane button opens the pane and closes the popup.
- `mod.json` `"place": "none"`: Herdr docks it nowhere by itself.
- Drawn with `ui.js` (a copy of the repo's `lib/ui.js`), in the sizes of Herdr's own panels: a frame with 10 px corners on `background` with a 1 px `border`, 13 px text; a 42 px header (14 px side padding, semibold title, bottom border) with 26 px icon buttons (14 px Lucide icons in `icons/`: refresh, open as pane in the popup only, settings); a scroll area with 6 px padding and Herdr's scrollbar; a bottom bar (top border) with Status page (status.anthropic.com) as a 28 px row.
- One section per account, in discovery order, separated by a 1 px `border`:
  - A 7 px-radius row (hover `hover`, click folds): the account title, semibold; the email under it at 11 px `dim`, unless the email is the title; plan on the right, 12 px `muted`.
  - "Updated N ago" (or "Updating…"), 11 px `dim`.
  - One block per limit, 12 px: "Session 84% left" (semibold) / "Resets in 2h 26m" (`muted`), a 6 px meter (track `border`, fill `accent`, width = % left) with a 1 px `foreground` tick at the share of time left, then the pace line at 11 px `muted`: "33% in reserve · Lasts until reset", "12% in deficit · Runs out in 1h 5m", "On pace · …" or "Ran out". Limits: Session (5 h), Weekly (7 d), then per-model weeklies by name (e.g. "Fable").
  - "This week by surface" (11 px semibold `muted`), then 22 px rows: label, meter, percent (rows at 0 % left out). Only when the account sends a breakdown.
  - "Extra usage" "Off", or "Extra usage this month" "0.00 USD of 20.00 USD".
- Toast (`notify`, level warning): `Claude <account title>: session at 85%` / `Resets in 1h 5m`, once per window when session or weekly use reaches 80%. Sent windows are kept in `shared` (`argus-claude-usage.alerts`) until they reset.
- Account title: the Display name set in settings, else the organization name, else the email, else the folder.
- Settings view: same frame; header with a back icon and "Settings". Sections titled at 11 px semibold `muted`: Accounts (28 px rows: a 14 px check box, the organization name from Claude (else the email or folder), the folder on the right (`~/.claude-work`); a Display name field under each, its placeholder that name); Added folders (rows with Remove, then a 32 px field with an `accent` border while focused and an Add button, 32 px, `raised`); Refresh every (1 / 5 / 15 min as 28 px rows, the active one `selected`); Claude command (field; empty = `claude` on PATH, saved on Enter or when focus leaves).

## How it behaves

- Every open copy draws the usage kept in `shared` (`argus-claude-usage.data`). Every 30 s each copy checks whether the data is older than the interval (default 5 min) or a refresh was asked for; the copy that takes the lock (`argus-claude-usage.lock`, 2 min, renewed per account) finds the accounts and asks Claude Code for each one's usage, one at a time. At most one `claude` process runs. A copy that closes gives the lock back.
- Data older than twice the interval plus a minute is not shown (after a restart, say).
- Account states: usage; "Open Claude with this account to sign in" (Claude Code has no usable sign-in there); "No plan limits for this account"; "Usage unavailable · <reason>", where the reason is "No usage reply" (no reply in 15 s), "Claude Code not found", "Could not run Claude Code", "usage.sh exited with N", "Unreadable usage reply", or "Claude Code: <its error text>".
- Clicking an account's header row folds it; folds and settings persist in `shared` (`argus-claude-usage.folded`, `argus-claude-usage.settings`).
- Hiding a folder removes it and stops its requests; when another folder is signed in to the same Claude account, that folder shows instead (one section per account, the first visible folder). Added folders must be absolute (`~` allowed); adding one checks it for a profile at once.
- A limit toast is keyed by account, window and reset minute: Claude reports the same reset with a different fraction of a second on each fetch.
- A copy re-checks the lock after each `claude` run and writes only while it holds it; `finally` and `close()` clear `fetching` and free the lock when this copy holds it.

## Built from

- `mod.json`: `{ "place": "none", "title": "Claude usage", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Usage", "icon": "icons/chart-line.svg" } }`.
- `gate.js` and `sync.js` are copies of `lib/gate.js` and `lib/sync.js` (one run at a time; which copy holds the lock).
- `main.js`: the `View`; `exec`, `home`, `appHome`, `readTextFile`, `checking`, `theme`, `shared`, `setShared`, `props`, `run`, `closeOverlay`, `notify` from `herdr`; `readdir`, `readFile` from `fs/promises`; `randomUUID` from `crypto`; `InputState` from `gpui-base`; the rest of the UI from `ui.js`.
- `accounts.js`: `discover` lists `~/.claude` (label file `~/.claude.json`) and each `~/.claude-*` folder or added folder with a `.claude.json`, label from its `oauthAccount`; `visibleProfiles` drops hidden folders, then keeps the first folder per `accountUuid`.
- `usage.sh`: runs `claude -p --safe-mode --no-session-persistence --input-format stream-json --output-format stream-json --verbose`, writes `{"type":"control_request","request_id":"argus-claude-usage","request":{"subtype":"get_usage","skip_behaviors":true}}` to its stdin through a FIFO, prints the first `control_response` line. Exit 0 / 1 (no reply) / 127 (no `claude`). Run through `/usr/bin/env -u CLAUDE_CONFIG_DIR` for the default profile and `/usr/bin/env CLAUDE_CONFIG_DIR=<folder>` for the others, because `exec` sets neither stdin nor environment.
- `usage.js`: reads `rate_limits.limits[]` (`session`, `weekly_all`, `weekly_scoped` + `scope.model.display_name`), falls back to `five_hour` / `seven_day`, `seven_day_breakdown.rows[]`, `spend`. Pace: margin = % left − % of time left; run-out from the current rate.

## Watch out

- `get_usage` is not a documented Claude Code API; an update can change it.
- Run the default profile with `CLAUDE_CONFIG_DIR` unset. Set to `~/.claude`, Claude Code uses another Keychain entry.
- Asking a profile whose sign-in is dead can leave its stored tokens empty; Claude Code does that, not the mod. Only real profile folders are asked.
- Herdr app 0.1.16 does not load a symlinked mod folder: copy it.
- Herdr 0.1.16 does not dock a new mod into its shipped `main` layout (tested with `"place": "right"`), its footer and tab bar have no extension points, and mods cannot add palette entries. The `Argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel.
- Toasts appear only while a copy runs (the panel, a pane, even in a hidden tab, or the popup).
- Props reach the mod through `props()` from `herdr`, not through `init`'s first argument.
- macOS and Linux only.

Credit: the `get_usage` approach and the helper's steps follow [VladTemp27/herdr-mods](https://github.com/VladTemp27/herdr-mods) `usage-limits`, which credits [jmalicki/herdr-mod-ai-usage](https://github.com/jmalicki/herdr-mod-ai-usage). No code is copied.
