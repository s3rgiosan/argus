# Changelog

All notable changes to Argus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The tab bar of the Argus layout uses `argus-tabs`, a copy of Herdr's `tabs` row. A tab led by a Claude Code agent on an account that `agents.accounts` maps shows that account's icon, as the agents lists do.

## [1.16.0] - 2026-11-24

### Added

- `scripts/update.sh` pulls the clone and runs `install.sh`. It stops when the clone has local changes.
- `scripts/uninstall.sh` removes the Argus mods, the copies of Herdr's mods and the Argus layouts, and keeps `argus.json`.
- `install.sh --prune` removes installed Argus mods that the repo no longer has.

### Changed

- `install.sh` checks the Herdr version against `herdr` in `package.json` and stops when Herdr is older. With no mod names, it also builds the Argus layout, and shows it on the first install; `--no-layout` copies the mods only.

## [1.15.0] - 2026-11-24

### Added

- A new mod, `argus-settings`, adds a Settings window that shows `argus.json` in Herdr's code editor. Open it with `mod.open:argus-settings`, for example from a key in `keys.json`. Save checks the text with the rules the mods use and shows what is wrong. It does not overwrite a change made to the file by another program, and Revert reads the file again.
- The command palette has an **Argus settings** entry that opens the Settings window.
- The new `agents.accounts` setting in `argus.json` maps a Claude Code account folder to a `programs.json` entry. The Argus agents list in the sidebar (`argus-agent-list`, a copy of Herdr's `agents` list) and the Overview board show that entry's icon for the account's agents.

### Changed

- Argus needs Herdr 0.1.18 or later.
- The `argus.json` checks of `argus-toolbar` and `argus-pull-requests` moved to `lib/argus-file.js`, with no change in behavior.
- The review agent of `argus-pull-requests` may now post a comment, an approval or a change request, after the person approves the exact text, where it goes and the review event in the agent's conversation. Commit, push and merge stay banned.
- The review agent may write report files in the dot folders that the new `pullRequests.review.reportFolders` setting in `argus.json` names, for example `.drafts`. The setting refuses `.git`, `.github`, `.gitlab`, `.claude`, `.githooks`, `.husky` and `.vscode`.

### Fixed

- A scroll up in the Spaces list of the Argus sidebar no longer runs away past the top. The list still brings the active space into view when you switch spaces, and when the list gets shorter.
- In `argus-tsk`, Follow space no longer shows the desk tasks when the focused space is in no tsk project. The board shows "No tasks for this space", and a captured task starts a project at the space's git repo root.

## [1.14.0] - 2026-11-23

### Added

- The Argus sidebar has space groups, such as "Personal" and "Work". A New group button in its title row makes one, and each group gets a header that folds. Spaces without a group show under "No group".
- A new mod, `argus-space-groups`, holds the group popups. The options button on a group header (or a right-click) opens Add spaces…, Rename, Move up, Move down and Delete group.
- A drag of a space onto a group header, or onto a space in another group, puts it in that group.
- A group belongs to the repo of a space, so worktree spaces stay with their repo and a repo that opens again comes back in its group. A space outside any repo is grouped on its own until it closes.
- Herdr's space order follows the groups, so the rail numbers match the sidebar. When two Herdr apps with different groups move the same spaces back and forth, the sidebar stops sorting that machine until the groups or its spaces change.
- `scripts/build-layout.mjs` prints "the sidebar has no groups" and writes the sidebar copy without groups when the group hooks no longer fit Herdr's sidebar.
- `scripts/herdr-diff.mjs` shows what changed in Herdr between two versions: the release notes, the changed shipped files, the diff of each file Argus follows, and whether the `argus-pane` and `argus-spaces` patches still apply.

### Changed

- Argus needs Herdr 0.1.17 or later.
- The Overview board of `argus-agents` keeps a leading emoji in an agent's title, and drops the status marks ✋ and ⏳, as the agents list of Herdr 0.1.17 does.

### Fixed

- The pane header of a pull request, issue or task pane shows a name given with Rename in Herdr's pane menu, in place of the item title.

## [1.13.0] - 2026-11-22

### Added

- A new mod, `argus-issues`, shows GitHub and GitLab issues in an Issues panel. It reads through `gh` and `glab` and writes nothing to GitHub or GitLab.
- The scope list of `argus-issues` has three choices. Show picks Assigned to me, Created by me, Mentions me or All open. In picks Follow space, All repos or one project of your open spaces. Group by picks Repo, Assignee or Label.
- The `argus-issues` board groups issues by repo by default. Grouped by assignee or label, an issue shows under each of its assignees or labels, and issues without one show under "No assignee" or "No label". Each group heading has a count, issues show newest update first, and the filter field matches the title, number, author, labels and assignees.
- Mentions me in `argus-issues` is GitHub only, because GitLab has no search for mentions. A line says so when the scope holds a GitLab project.
- A click on a row of `argus-issues` opens the issue in a pane beside the terminals. The pane shows the state, who opened it and when, the assignees, labels and milestone, and folding Description and Comments sections rendered as Markdown.
- Comments that GitHub hid show without their text in the `argus-issues` pane, and GitLab internal notes get an "internal" chip. Links open with Herdr's `cx.open_url`, only for http and https.
- The `argus-issues` pane header shows the issue's place in the list, with arrows for the previous and next issue, and Open in browser.
- New worktree in the `argus-issues` pane footer starts a worktree on the issue's branch (its number and a title slug) in the local checkout of its repo, and opens its space, as the Issue tab of the `argus-pull-requests` New worktree view does. Without a local checkout of the repo, the footer says so and the button is off.
- `argus-issues` takes its `gh` and `glab` commands from the shared `argus.forge` key, and keeps its refresh interval and Conversation order in `argus-issues.settings`.

- New mod `argus-agents`, labeled Overview: a board of the agents that need you, in sections for Needs you, Failed and Finished, with counts and the time each agent has been in its state. A click on a row shows the agent.
- A finished agent stays on the board after you look at it, until it works again or you snooze it. An agent that finishes while its pane is the focused pane and Herdr is in front goes to Idle instead. Failed lists agents whose program reports an error status.
- The Overview board has folded lists after the open sections, each with a count: Working, Idle, Older and Snoozed. A finished row older than 1 hour moves from Finished to Older.
- Snooze a row for 1 hour, 3 hours, until tomorrow morning (09:00, or 09:00 the same day when you pick it before 09:00) or until the agent changes. A snooze also ends when the agent's state changes. Snoozed rows wait in the Snoozed list with their end time, and Reopen puts a row back.

### Changed

- The built-in review prompt of `argus-pull-requests` puts the title, author and branches between `<<<pull-request>>>` and `<<</pull-request>>>` lines. The quoted values also write `<`, `>` and some invisible and control Unicode characters as `\uXXXX`.
- The built-in review prompt checks the head commit before and after the review, reads the pull request only at that commit, forbids git commands that change the worktree except `git fetch`, and stops without a review when a check or a command fails.
- On GitHub, `{{viewCommand}}` of `argus-pull-requests` also asks for `baseRefOid`.
- The `argus-pull-requests` board shows "1 merged worktree" or "N merged worktrees", without "can be removed".
- The `argus-pull-requests` board puts a GitHub pull request in Needs work when a reviewer's latest review requests changes, and its row shows "changes requested". GitLab board lists carry no reviewer data.
- The pull request pane of `argus-pull-requests` reads again when its board row changes. When no board copy reads, it reads on its own once each refresh interval.
- The merged worktree count of `argus-pull-requests` reuses its merged pull request list for up to 15 minutes while the set of worktrees stays the same. The refresh button reads it again.
- The Merged worktrees view of `argus-pull-requests` runs at most 4 commands at once and makes fewer forge calls, because the merged list of the project answers where it can.
- A folder that was not a repo, or had no remote, is probed again on each scheduled read of `argus-pull-requests`. A repo is probed again after 10 minutes. A probe that timed out is tried again once each refresh interval.
- A GitLab host other than `gitlab.com` needs a glab login in `argus-pull-requests`. Without it, the note "<host>: no glab login for this host" shows, the repos of that host leave the board until a read finds a login.
- A GitHub remote needs exactly `owner/repo` in `argus-pull-requests` and `argus-issues`, made of the clean path parts. A host or a path part that starts with `-`, or a path part `.` or `..`, is not a project. `github.com` with a port other than the default of its protocol is not a project (`ssh.github.com` allows 22 and 443).
- The GitLab discussion limit note in `argus-pull-requests` reads "Showing the first 100 discussions.".
- An account in `argus-claude-usage` keeps its last good usage after a failed refresh and adds the line "Last refresh failed · <reason> · <ago>". A good reply removes the line. A good reply older than twice the interval plus one minute is not kept.
- `argus-claude-usage` keeps the accounts it found for 1 hour, but looks for accounts again on the next refresh when the last search found none. The refresh button, a change of the extra folders and a forced refresh find them again.
- `argus-toolbar` reads `argus.json` each time it starts a new watch, so a save between two watches is not missed.
- `scripts/install.sh` copies a mod into a temporary folder beside `mods/` and then swaps it in, so a failed copy, or a failed move into place, keeps the earlier install. It fails on a partial file list and gives the installed folders the normal mode, not 0700.
- `scripts/sync-lib.mjs --check` fails on a lib copy that no module of the mod imports. The copy mode prints a warning.
- The `gh` and `glab` commands of `argus-pull-requests` live in the shared-state key `argus.forge`, so other forge mods use the same commands. While that key is missing, the commands come from `argus-pull-requests.settings`, and the next save of the fields writes `argus.forge`.
- Links in `argus-pull-requests` and `argus-claude-usage` open with Herdr's `cx.open_url`. The `open` and `xdg-open` commands are gone, and a link that does not open shows no error line.
- The GitLab username for the New worktree Issue tab of `argus-pull-requests` is read once and kept until the refresh button.
- `argus-claude-usage` writes its read lock again only when less than half of its time is left.
- Shared code moves to `lib/`: the git remote and project helpers (`remote.js`), the `gh` and `glab` helpers (`forge-cli.js`, `forge-settings.js`, `forge-runner.js`), the forge board helpers and board sync (`forge-board.js`, `board-sync.js`), worktree planning and creation (`worktree.js`, `worktree-runner.js`), home path helpers (`paths.js`), the profile file access (`profile-io.js`), the process limiter (`pool.js`), the lock renewal and release (`sync.js`), and the popup menu, settings field, pane and row blocks (`menu.js`, `ui.js`, `pane.js`). `argus-pull-requests`, `argus-tsk` and `argus-claude-usage` use them in place of their own copies.
- `scripts/sync-lib.mjs` also copies the lib files that a used lib file imports.
- `argus-pull-requests` loads Herdr's own chevron-right and plus icons when Herdr ships them, and `lib/icons.js` lists clock for the mods that use it.
- `lib/forge-board.js` also holds the board settings (refresh interval and Conversation order), the 15-minute keep time of failed lists, the item groups by several values, and the item pane title. `lib/forge-cli.js` also holds the string list check. `argus-pull-requests` uses them in place of its `locate.js` and its own copies. The pane order of `shownOrder` counts an item that shows in several groups once.

### Fixed

- Approve and Request changes on GitHub in `argus-pull-requests` read the head commit of the pull request first, then post the review through the REST API on the commit you saw (`commit_id`). GitLab Request changes reads the head commit too. When it moved, they stop with "The pull request has new commits. Review them, then try again.". When the read fails, they stop with "Could not read the head commit of the pull request.". Comment is not checked.
- A repo of `argus-pull-requests` whose list fails keeps its pull requests from the last good read for up to 15 minutes, and the failure note still shows.
- An unexpected read error in `argus-pull-requests` shows as the note "Could not read the pull requests: …".
- The pane of `argus-pull-requests` clears the Start request from shared state when it takes it.
- `argus-tsk` keeps its last rows and shows the error "tsk printed output that is not a JSON task list." when `tsk` exits with 0 and prints something else.
- `argus-tsk` uses the first tsk install that is new enough, and reports "too old" only when none is.
- `argus-tsk` refuses a project title that starts with a dash with "A title cannot start with a dash.".
- The store change check of `argus-tsk` tries GNU `stat` first, so it works on Linux.
- `usage.sh` in `argus-claude-usage` removes only the stale temp folders of the current user, and checks twice a second with the same timeout.
- The old-key move of `argus-claude-usage` does not run during `herdr-app check`.
- `scripts/build-layout.mjs` writes its files, and the preview image, atomically and refuses an `argus-pane` or `argus-spaces` folder that is a symbolic link.
- The `argus-stay-awake` README gives the right time the display stays awake after the last agent finishes: up to about 2 minutes.
- The refresh and settings buttons of `argus-pull-requests` and the icon buttons of `argus-claude-usage` have tooltips.
- Every task that `argus-tsk`, `argus-claude-usage` and `argus-toolbar` start with `cx.spawn` waits one tick first, as Herdr app 0.1.16 needs.
- `tildePath` keeps a path as it is when there is no home folder, and ignores a trailing slash on the home folder, in every mod.
- A GitHub repo that has issues turned off shows no issues in `argus-issues` and adds no failure note.
- An empty list in `argus-issues` and `argus-pull-requests` says that the issues or pull requests could not be read only when no read that fills the scope worked. When one repo fails and the other reads work, the list shows "No open issues here" or "No pull requests here" under the failure note.
- The pane header of `argus-issues`, `argus-pull-requests` and `argus-tsk` shows the number and title of the picked item as soon as the pane switches to it. The title comes from the board row, so it shows while the item loads.
- The snooze menu of `argus-agents` is 250 px wide, as Herdr's new-tab menu, so "Tomorrow morning" shows in full next to its wake time.
- Group by in the `argus-issues` scope list stays at the bottom of the list, and Show and In scroll above it, so Group by shows with many projects in the open spaces. `menuPopup` in `lib/ui.js` takes `head` and `foot` parts that stay in view around the scrolling list.
- The Issue tab of the `argus-pull-requests` New worktree view shows an empty list for a GitHub repo that has issues turned off, with no error.
- Threads and Assignees in the `argus-tsk` scope list stay at the bottom of the list, and In scrolls above them, so they show with many projects. Long Threads and Assignees lists scroll on their own and leave In room for three rows.
- A glab login check that fails for a reason other than a missing login, such as a network error, keeps the GitLab repos of that host on the boards of `argus-issues` and `argus-pull-requests`. A signed-out host or a failed check is checked again on the next read.
- Merged worktrees in `argus-pull-requests` offers nothing for a repo whose default branch cannot be read, and shows a note that names the repo.
- The merged worktree count of `argus-pull-requests` falls back to GitHub or GitLab when git cannot name the default branch, and keeps no failed read until Refresh. Refresh also clears the cached merge methods.
- A Read again in New worktree of `argus-pull-requests` that you press during a running read runs once more, so the list shows the newest result.
- Each GitHub search in `argus-issues` (Assigned, Created, Mentions) has its own read. A failed search shows the failure text for its own Show even when another search worked, and keeps its last issues for 15 minutes.
- `argus-agents` drops an entry 7 days after the agent was last seen, not after its last change. A second finish within one refresh counts as a new finish, and shows in Idle when the agent is watched.
- A missing `gh` or `glab` is looked up again after 60 seconds in `argus-pull-requests` and `argus-issues`. The first save of the fields writes `argus.forge`, even when the values equal the fallback.
- New worktree in `argus-pull-requests` and `argus-issues` checks the default branch name (`git check-ref-format --branch`, no leading `-`) and counts an invalid one as unknown. Its fetch uses `--`. It reads the default branch only when it cuts a new branch, so opening an issue worktree or reusing a local branch needs no default branch. A branch name of only dots gets a hash folder name, and `worktrees.directory` is used without its surrounding spaces.
- The commit check (`scripts/check-commits.mjs`) ignores the diff below the `git commit -v` scissors line, treats only real trailers as trailers (a body line `Note: text` passes and a wrapped trailer is refused), and accepts `Revert "…"` subjects.

### Security

- Review prompt values of `argus-pull-requests` cannot close the pull request data block, because `<` and `>` are escaped in them.

## [1.12.0] - 2026-11-20

### Added

- Review with agent in `argus-pull-requests` takes settings for each Claude Code account under `pullRequests.review.accounts` in `argus.json`, keyed by the account folder, such as `~/.claude-work`.
- The `instructions` of an account pre-fill the Extra instructions field when the dialog opens and when you pick another agent. The field changes only while it is empty or still holds the last pre-filled text, so text you typed stays.
- The `promptFile` of an account replaces the global `promptFile` for reviews started with that account. An error about a prompt file names the setting that holds it.
- An account key that is empty, not an absolute or `~/` folder, `__proto__`, or the same folder as another key stops the pre-fill, and Start fails with an error that names the key.

## [1.11.0] - 2026-11-20

### Added

- The `argus-pull-requests` board notices merged worktrees on its own. When the scope has some, the top of the list says how many can be removed, with a Review link that opens Merged worktrees. Each board read checks one list of merged pull requests per repo that has worktrees, and nothing is removed without the view's confirm list.

## [1.10.0] - 2026-11-20

### Added

- The `argus-pull-requests` board has a `+` button ("New worktree") right of the filter field. It opens a view that starts a git worktree, and its Herdr space, from a remote branch, a pull request or an issue, for GitHub and GitLab.
- The view shows one repo, the followed space's repo or else the first, until you pick another. A scrolling list shows the repos, and a repo that leaves the scope gets a note.
- The Branch tab lists the remote branches without the default branch. A branch that has a worktree shows "worktree" and a pick opens its space. Any other pick checks the name, fetches the branch and adds a worktree. A local branch of the same name moves up to the remote when it is only behind, and a note tells how far it is ahead or behind otherwise.
- A new branch from a remote branch gets its upstream set after the worktree exists, and a single-branch clone gets a fetch refspec. A failed create deletes the branch it made.
- The Pull request tab lists the open pull requests of the repo on the board and a pick runs Check out in a worktree.
- The Issue tab lists the open issues assigned to you, up to 50. A pick adds a worktree on a new branch named after the issue number and title, cut from the fetched default branch, or uses the branch when it exists locally or on the remote.
- Pull request and Issue rows show "worktree" when a worktree for their branch exists in the Branch list of the repo.
- The filter field narrows the list, shows "Nothing matches the filter" when it hides every row, and Enter picks the only row left.
- One create runs at a time across the tabs. Read again keeps the old rows while it reads, and it is hidden on the Pull request tab.
- The view reads only from GitHub and GitLab, and writes nothing to them.

## [1.9.0] - 2026-11-20

### Added

- The `argus-pull-requests` panel has Merged worktrees, opened from Settings under Worktrees. It lists the worktrees of the repos in scope whose pull request is merged and ticks those that may go. It greys the rest with a reason: locked, changes, submodules, unsaved commits, open in a space, an open pull request, a merge into another branch, or newer commits. A worktree with ignored files starts unticked, with the files in its tooltip.
- Remove checks each worktree again just before it goes, removes it without force, and deletes the local branch only when its last commit is the one the pull request merged. The row being removed shows "removing…", and each row ends with its result in a colour. The results stay until Done.
- Merged worktrees takes keyboard focus when it opens. Escape goes back to the board, and Enter removes the ticked worktrees.

### Changed

- The shared `row` block in `lib/ui.js` takes a `hover` option, which is on by default.

## [1.8.0] - 2026-11-20

### Added

- The `argus-pull-requests` pane shows file comments under their review, with the file, the line and whether the thread is open or resolved, for GitHub and GitLab.
- The pane header shows the pull request's place in the board's list, with arrows to move to the previous or next one.
- Merge ▾ lists the merge methods the repo allows, with your default marked.
- Comments, file comments and the description render as Markdown, and people show by their display name.
- `pullRequests.review.promptFile` in `argus.json` replaces the built-in review prompt with your own file, with placeholders for the pull request.
- The review dialog shows a help line under each field.
- A check in the pull request pane opens its run or job page in the browser.

### Changed

- The built-in review prompt lets the agent create new files for its report, but not in folders whose names start with a dot, and the agent must not run the files it creates. It still forbids editing or deleting the repository's files, commits, pushes, comments, approvals, requests for changes and merges.
- The pane leads with a verdict in the board's words (Ready to merge, Needs work, Waiting on review, Draft, or Merged and Closed) and the reasons in one line.
- The pane's checks, reviews, review agent, description and conversation are folding sections. Sections that need you open by themselves, and your choice stays per pull request.
- A footer holds Review with agent, Merge ▾ and a ⋯ menu with Comment, Approve, Request changes, Check out in a worktree and Open in browser.
- Every review shows in the conversation with its state, also an approval without text. A comment review with no text and no file comments of its own is left out, because its replies show in their threads.
- GitLab merge requests read their discussions in place of their notes.
- The verdict names a draft and a merge state that is not known yet, uses display names, counts one check in the singular, and gives a line of its own when a group other than Ready to merge has no reason. A reviewer's open request for changes moves a pull request that is not a draft to Needs work.
- The Reviews summary counts reviewers who only commented.
- A section you folded opens again when its default changes, for example when a check fails after you closed Checks while all checks passed.
- The area above the pane footer is at most 260 px tall and scrolls, and the footer stays in view.
- A name in the pane is cut short when it is long, and its tooltip shows the login. Markdown ids follow the content, not the list position.
- A link in a comment or the description opens in the browser.
- The panel's empty-list message points to the notes only when a failed read belongs to the scope you look at.
- Start refuses a repo or host with characters that the review prompt cannot put in a shell command. A prompt file without `{{base}}` skips the base branch check, and `promptFile` must be an absolute or `~/` path, without a NUL character and at most 100000 characters.
- Placeholder names in a prompt file are case-sensitive, and `{{head_sha}}` or `{{base-branch}}` are refused as unknown.
- A check link with whitespace is dropped, and a GitLab check link keeps the origin of the merge request's own web URL.
- Secondary buttons have the size of primary buttons (32 px high, `input` border), and icon buttons in the pull request pane use the shared 26 px button.
- Field labels are 12 px semibold and help lines are 11 px dim in the review dialog, the Block and Request Review forms, and the settings views. Text boxes use 12 px text.
- The scope and status dropdowns, the review check chips and the error lines look the same in every Argus panel, and the Tasks header follows the Pull requests header.
- The review dialog uses the padding and the title and text sizes of Herdr's dialogs, and notes in the pull request pane use 11 px text.

### Fixed

- A login such as `constructor` or `__proto__` keeps its display name and no longer returns an Object property.
- The ⋯ menu closes after Open in browser, and an earlier error clears at once.
- The Review agent summary and its default state ignore a run that you removed.
- The folder watch runs its git probes four at a time, and the board read keeps folders that the watch added while it ran.
- The review dialog message for a stuck start points to the Review agent section.
- An empty pull request list after a failed read says "No pull requests could be read. See the messages above." in place of "No pull requests here".
- With Follow space, a new space shows "Reading this space…" until the board knows its folder, in place of "This space is not a GitHub or GitLab repo." while its pull requests load.

## [1.7.0] - 2026-11-20

### Added

- The `argus-pull-requests` pane has Review with agent. Its dialog starts an installed coding agent in a new worktree from the main checkout, with a read-only review prompt that checks the pull request with `gh` or `glab` before it reads the changes.
- Claude Code shows once per account in the dialog, with the names from the Usage panel, and takes a model.
- `pullRequests.review.instructions` in `argus.json` adds instructions to every review prompt.
- A board row shows a dot when a review agent worktree exists for it, and the pane lists those worktrees with Open space and Remove worktree.
- The `argus-pull-requests` settings have a Conversation choice, Oldest first or Newest first, for the comments in the pull request pane.

### Changed

- The keep-awake button shows a full coffee cup while it keeps the display awake, and an empty cup while it is off.
- Claude Code account discovery moved to `lib/accounts.js`, shared by `argus-claude-usage` and `argus-pull-requests`.

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

[Unreleased]: https://github.com/s3rgiosan/argus/compare/1.16.0...HEAD
[1.16.0]: https://github.com/s3rgiosan/argus/compare/1.15.0...1.16.0
[1.15.0]: https://github.com/s3rgiosan/argus/compare/1.14.0...1.15.0
[1.14.0]: https://github.com/s3rgiosan/argus/compare/1.13.0...1.14.0
[1.13.0]: https://github.com/s3rgiosan/argus/compare/1.12.0...1.13.0
[1.12.0]: https://github.com/s3rgiosan/argus/compare/1.11.0...1.12.0
[1.11.0]: https://github.com/s3rgiosan/argus/compare/1.10.0...1.11.0
[1.10.0]: https://github.com/s3rgiosan/argus/compare/1.9.0...1.10.0
[1.9.0]: https://github.com/s3rgiosan/argus/compare/1.8.0...1.9.0
[1.8.0]: https://github.com/s3rgiosan/argus/compare/1.7.0...1.8.0
[1.7.0]: https://github.com/s3rgiosan/argus/compare/1.6.0...1.7.0
[1.6.0]: https://github.com/s3rgiosan/argus/compare/1.5.0...1.6.0
[1.5.0]: https://github.com/s3rgiosan/argus/compare/1.4.1...1.5.0
[1.4.1]: https://github.com/s3rgiosan/argus/compare/1.4.0...1.4.1
[1.4.0]: https://github.com/s3rgiosan/argus/compare/1.3.1...1.4.0
[1.3.1]: https://github.com/s3rgiosan/argus/compare/1.3.0...1.3.1
[1.3.0]: https://github.com/s3rgiosan/argus/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/s3rgiosan/argus/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/s3rgiosan/argus/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/s3rgiosan/argus/releases/tag/1.0.0
