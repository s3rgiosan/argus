# Tasks

The tsk board as a Herdr panel, with the task in a pane beside the terminals. Every read and change goes through the `tsk` CLI; the mod never writes the store.

## What you see

- `mod.json`: `{ "place": "none", "title": "Tasks", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Tasks", "icon": "icons/list-checks.svg" } }`. The `argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel. `mod.open` opens it as a 360 × 640 popup.
- One mod, three views picked by `props().view`: none or `"board"` (the panel), `"scopes"` (popup), `"task"` (pane).
- Board, drawn with `ui.js` (a copy of `lib/ui.js`): frame; 42 px header with "Tasks" (semibold), the scope button (scope name at 12 px `muted` with a chevron, hover `hover`), the count badge (11 px `muted` on `raised`), then refresh and settings icon buttons (14 px Lucide icons in `icons/`); scroll area; bottom bar with a 32 px "New task…" field and an Add button (`solid` while there is a title).
- Sections, titled at 11 px semibold `muted`: "NEEDS YOU · n", "IN MOTION · n", "ON DECK · n" (ready rows, then open rows). Empty sections are left out; no rows at all shows "No tasks here" ("Loading…" before the first read).
- Row, 28 px: an 8 px dot (filled `blocked` for NEEDS YOU, filled `working` for IN MOTION, a `muted` ring for ON DECK), `T<number>` at 12 px `muted`, the title (truncated), the status name at 11 px `dim` (Open, Ready, Started, Blocked, In Review). The selected task's row is on `selected`.
- Scopes popup: `openOverlay({ mod: "argus-tsk", props: { view: "scopes" }, kind: "popup", width: 280, height: 420 })`. Rows: Desk, All Projects, then Projects, Threads and Assignees (section titles left out when empty), each with its count at 11 px `dim`; the current scope on `selected`. A pick sets the scope and closes the popup.
- Settings view: back icon and "Settings"; "tsk command" and "Store folder" fields with a hint under each; both save on Enter or when focus leaves.
- Task pane (first cut): header with `T<number>  <title>` and the status name.

## How it behaves

- `shared` keys: `argus-tsk.board` `{ rows, readAt, error }` (rows from `tsk list --all --json`); `argus-tsk.scope` (a scope, default the desk); `argus-tsk.selected` `{ number }`; `argus-tsk.settings` `{ tsk, stateDir }`; `argus-tsk.lock` (the reader lock).
- Board and task copies watch the store folder (`watchFolder`, looped in `cx.spawn`). A change re-reads 300 ms after the last one in a burst. The copy that takes the lock (`lib/sync.js`, `lib/gate.js`) reads; a copy whose shared board is already newer than the change skips its read. If the watch is refused, the board is read every 10 s.
- Finding tsk: the tsk command setting, `tsk` on the PATH that Herdr's `exec` sees, then the install locations; the first whose `--version` runs is used, once per setting. Older than 0.13.0 or not found: one note in the panel, no rows. The refresh icon looks again.
- Store folder: the setting (passed to tsk as `--state-dir`), else `TSK_STATE_DIR` read once with `/bin/sh -c 'printf %s "$TSK_STATE_DIR"'`, else `~/.tsk`.
- Capture runs `tsk add` with the scope's target (`captureTarget` in `board.js`), then re-reads. A refusal shows tsk's message over the bottom bar and keeps the text.
- Row click: sets `argus-tsk.selected`. If the shown tab has a pane of this mod, `pane.focus` it; else `pane.split { pane: <tab's focused pane>, direction: "right", mod: "argus-tsk", props: { view: "task" } }`.

## Built from

- `main.js`: the `View`; `exec`, `home`, `checking`, `theme`, `shared`, `setShared`, `props`, `run`, `openOverlay`, `closeOverlay`, `panes`, `spaces`, `watchFolder` from `herdr`; `randomUUID` from `crypto`; `InputState` from `gpui-base`.
- `tsk.js` (argv for every command), `locate.js` (tsk lookup, store folder, version check, settings), `model.js` (JSON to camelCase rows), `board.js` (sections, scopes, capture target), `flows.js` (block and review flows), `timing.js` (debounce with an injectable clock). All pure, tested with `node --test`.

## Watch out

- Herdr's `exec` has no stdin or env options: the store folder goes to tsk as `--state-dir`, placed before a `--` that starts free text.
- `InputState.new` is refused during render: the fields are made in `init`.
- A popup is as tall as its content (up to the height asked for): the scopes list sets its height from its rows.
- Herdr app 0.1.16 does not load a symlinked mod folder: copy it with `scripts/install.sh`.
