# Tasks

The [tsk](https://gettsk.sh) board in Herdr. Board in a panel on the right, task in a pane beside the terminals.

- Three sections with counts: NEEDS YOU (blocked or in review, waiting on you or on a task that is no longer live), IN MOTION (started, or waiting on a live task or an agent), ON DECK (ready, then open).
- Scope button in the header: Follow space, Desk, All Projects, each project, thread and assignee, with counts. Follow space (the default) shows the tsk project that holds the focused space's folder, or the desk when no project does. It knows only projects that already have tasks on the board, so a folder whose project has no tasks shows the desk, and so does a space on another machine; the button reads "Follow space · <project>". A project shows under its tsk title, else its folder name. Names sort A-Z, ignoring case.
- Rename a project: the pencil on its row in the scope list turns the row into a field, with the project's full path under it. Enter or Save sets the title, Clear or an empty field removes it, Esc cancels. Needs tsk 0.14.0 or newer.
- Capture: type a title in the bottom bar, press Enter or Add. A project scope captures into that project (Follow space into the project it shows, else onto the desk), a thread or assignee scope onto the desk with that thread or assignee, Desk and All Projects onto the desk.
- Expand icon in the header: widens the Tasks panel to 900 px; again: back to the width it had. Shown only in the `argus` layout's panel.
- Click a task: it opens in a pane on the right of the current tab, or the tab's open task pane shows it.
- Task pane: edit the title, notes, assignee and runs after; pick a status (Open, Ready, Started, Done) from a dropdown; Start Without Agent on an assigned task; Block… and Request Review…; tick, add and remove steps; answer a block, or approve or send back a review; Done, Reply (on a blocked or in review task) and Archive. A task that tsk does not know, or that is archived, shows "Task not found".
- Live: the board and the task pane watch the store folder and read again when `tsk.json` changes in modification time or size. When the watch is refused, they read every 10 seconds. One open copy reads at a time.

## Settings

Gear icon in the header:

- tsk command: empty uses `tsk` from PATH, else `~/.local/bin/tsk`, `/opt/homebrew/bin/tsk`, `/usr/local/bin/tsk`, `/home/linuxbrew/.linuxbrew/bin/tsk`.
- Store folder: empty uses `TSK_STATE_DIR`, else `~/.tsk`.

Needs tsk 0.13.0 or newer; project titles need 0.14.0. A missing or older tsk shows one note in the panel; the refresh icon looks again. With tsk 0.13, projects show their folder names and the pencil is hidden.

## Open it

In the `argus` layout: the Tasks button beside the tab bar.

## Credits

- Not affiliated with tsk (gettsk.sh).
- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-tsk
node scripts/build-layout.mjs
```
