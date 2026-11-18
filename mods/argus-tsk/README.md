# Tasks

The [tsk](https://gettsk.sh) board in Herdr. Board in a panel on the right, task in a pane beside the terminals.

- Three sections with counts: NEEDS YOU (blocked or in review, waiting on you or on a task that is no longer live), IN MOTION (started, or waiting on a live task or an agent), ON DECK (ready, then open).
- Scope button in the header: Desk, All Projects, each project, thread and assignee, with counts.
- Capture: type a title in the bottom bar, press Enter or Add. A project scope captures into that project, a thread or assignee scope onto the desk with that thread or assignee, Desk and All Projects onto the desk.
- Click a task: it opens in a pane on the right of the current tab, or the tab's open task pane shows it.
- Live: the board follows the store as agents and the terminal change it.

## Settings

Gear icon in the header:

- tsk command: empty uses `tsk` from PATH, else `~/.local/bin/tsk`, `/opt/homebrew/bin/tsk`, `/usr/local/bin/tsk`, `/home/linuxbrew/.linuxbrew/bin/tsk`.
- Store folder: empty uses `TSK_STATE_DIR`, else `~/.tsk`.

Needs tsk 0.13.0 or newer. A missing or older tsk shows one note in the panel; the refresh icon looks again.

## Open it

In the `argus` layout: the Tasks button beside the tab bar.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-tsk
node scripts/build-layout.mjs
```
