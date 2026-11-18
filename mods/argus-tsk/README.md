# Tasks

The [tsk](https://gettsk.sh) board in Herdr. Board in a panel on the right, task in a pane beside the terminals.

- Three sections with counts: NEEDS YOU (blocked or in review, waiting on you or on a task that is no longer live), IN MOTION (started, or waiting on a live task or an agent), ON DECK (ready, then open).
- Scope button in the header: Desk, All Projects, each project, thread and assignee, with counts. A project shows under its tsk title, else its folder name.
- Rename a project: the pencil on its row in the scope list turns the row into a field. Enter or Save sets the title, Clear removes it, Esc cancels. Needs tsk 0.14.0 or newer.
- Capture: type a title in the bottom bar, press Enter or Add. A project scope captures into that project, a thread or assignee scope onto the desk with that thread or assignee, Desk and All Projects onto the desk.
- Click a task: it opens in a pane on the right of the current tab, or the tab's open task pane shows it.
- Task pane: edit the title, notes, assignee and runs after; pick a status; tick, add and remove steps; block a task or request a review; answer a block or approve or send back a review; Done and Archive.
- Live: the board follows the store as agents and the terminal change it.

## Settings

Gear icon in the header:

- tsk command: empty uses `tsk` from PATH, else `~/.local/bin/tsk`, `/opt/homebrew/bin/tsk`, `/usr/local/bin/tsk`, `/home/linuxbrew/.linuxbrew/bin/tsk`.
- Store folder: empty uses `TSK_STATE_DIR`, else `~/.tsk`.

Needs tsk 0.13.0 or newer; project titles need 0.14.0. A missing or older tsk shows one note in the panel; the refresh icon looks again. With tsk 0.13, projects show their folder names and the pencil is hidden.

## Open it

In the `argus` layout: the Tasks button beside the tab bar.

## Credits

- The functionality follows [tskdeck](https://github.com/s3rgiosan/tskdeck), by the same author. Not affiliated with tsk (gettsk.sh).
- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-tsk
node scripts/build-layout.mjs
```
