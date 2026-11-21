# Tasks

The [tsk](https://gettsk.sh) board in Herdr. Board in a panel on the right, task in a pane beside the terminals.

- Three sections with counts: Needs you (blocked or in review, waiting on you or on a task that is no longer live), In motion (started, or waiting on a live task or an agent), On deck (ready, then open).
- Scope button in the header, with three separate choices and counts: In (Follow space, Desk, All Projects or one project, with the projects indented under All Projects), Threads (Any thread or one thread) and Assignees (Anyone or one assignee). For example, Follow space with one assignee lists that assignee's tasks in the focused space's project. A pick keeps the list open, so you can set the other choices too; Esc or a click outside closes it. Each count shows what that pick lists with the other choices kept. A scope saved by an older version carries over. Follow space (the default) shows the tsk project that holds the focused space's folder, or the desk when no project does. It knows only projects that already have tasks on the board, so a folder whose project has no tasks shows the desk, and so does a space on another machine; the button reads "Follow space · <project>", then the thread and the assignee when set. A project shows under its tsk title, else its folder name. Names sort A-Z, ignoring case.
- Rename a project: the square-pen icon on its row in the scope list turns the row into a field, with the project's full path under it. Enter or Save sets the title, Clear or an empty field removes it, Esc cancels. A title that starts with a dash is refused with "A title cannot start with a dash.". Needs tsk 0.14.0 or newer.
- Capture: type a title in the bottom bar, press Enter or Add. A project scope captures into that project (Follow space into the project it shows, else onto the desk), Desk and All Projects onto the desk. The task gets the scope's thread and assignee when they are set.
- Expand icon in the header: widens the Tasks panel to the panel's maximum width (900 px today); again: back to the width it had. Shown only in the `Argus` layout's panel.
- Click a task: it opens in a pane on the right of the current tab, or the tab's open task pane shows it.
- Task pane: edit the title, notes, assignee and runs after; pick a status (Open, Ready, Started, Done) from a dropdown; Start Without Agent on an assigned task; Block… and Request Review…; tick, add and remove steps; answer a block, or approve or send back a review; Done, Reply (on a blocked or in review task) and Archive. A task that tsk does not know, or that is archived, shows "Task not found".
- Live: the board and the task pane watch the store folder and read again when `tsk.json` changes in modification time or size. The check tries GNU `stat` first and BSD `stat` second, so it works on Linux and macOS. When the watch is refused, they read every 10 seconds. One open copy reads at a time.

## Settings

Gear icon in the header:

- tsk command: empty uses `tsk` from PATH, else `~/.local/bin/tsk`, `/opt/homebrew/bin/tsk`, `/usr/local/bin/tsk`, `/home/linuxbrew/.linuxbrew/bin/tsk`.
- Store folder: empty uses `TSK_STATE_DIR`, else `~/.tsk`.

Needs tsk 0.13.0 or newer; project titles need 0.14.0. A missing or older tsk shows one note in the panel; the refresh icon looks again. With several tsk installs, the first one that is new enough is used, and the note says "too old" only when none is. When tsk exits with 0 but prints something that is not a JSON task list, the board keeps its last rows and shows the error "tsk printed output that is not a JSON task list.". With tsk 0.13, projects show their folder names and the square-pen icon is hidden.

## Open it

In the `Argus` layout: the Tasks button beside the tab bar.

## Credits

- The functionality follows [tskdeck](https://github.com/s3rgiosan/tskdeck), by the same author. Not affiliated with tsk (gettsk.sh).
- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-tsk
node scripts/build-layout.mjs
```
