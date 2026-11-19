# Pull requests

GitHub pull requests and GitLab merge requests as a Herdr panel, with one pull request in a pane beside the terminals. Every read goes through `gh`, `glab` and `git`. The mod writes to GitHub or GitLab only through the four review actions of the pane.

## What you see

- `mod.json`: `{ "place": "none", "title": "Pull requests", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Pull requests", "icon": "icons/git-pull-request.svg" } }`. The `argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel.
- One mod, views picked by `props().view`: none or `"board"` (the panel, with a settings page), `"scopes"` (popup), `"pr"` (pane).
- Board, drawn with `ui.js` (a copy of `lib/ui.js`): header with "Pull requests", the count badge (Herdr's Changes pill: 10 px `muted`, 1 px `border`, radius 4), the scope button, refresh (it turns while this copy reads) and settings icon buttons; scroll area; bottom bar with the filter field. Notes show at the top of the scroll area.
- Group titles: "Ready to merge · n", "Needs work · n", "Waiting on review · n", "Draft · n", titled like Herdr's group headings (11.5 px, medium, `dim`). Empty groups are left out.
- Row: number, title, checks, age, then repo and branch and the review state. The selected row is on `selected`.
- Scopes popup: Needs my review, Mine, Follow space, then a Projects section. Rows use Herdr's menu metrics (31 px, 8 px side padding, radius 7, 12.8 px text, 5 px around the list); the count shows dim on the right and the chosen scope has an `accent` tick. Up and Down move the highlight, Enter picks, Escape closes, a click picks. A pick sets the scope and closes the popup.
- Pull request pane: header with repo, number and state, branch line, title, the "No local checkout" note when the repo has no local clone, the Open in browser and Check out in a worktree buttons, on an open pull request the Approve, Request changes, Comment and Merge buttons (with the comment box or the merge confirm under them), then Checks, Reviews, Merge state, Description and Conversation.
- Settings view: gh command and glab command fields, and the refresh interval as Herdr's Settings segmented control (`INTERVALS` in `locate.js`: 1, 3, 5, 10 or 15 min; 3 by default). Icons Herdr ships with the same drawing (chevron-left, chevron-down, settings, check) load from Herdr's `mods/workspace-chrome/` folder when it exists, probed once in `init`; the Lucide copies in `icons/` show otherwise.

## How it behaves

- `shared` keys (prefix `argus-pull-requests.`): `board`, `scope`, `selected`, `settings` `{ gh, glab, interval }`, `lock`. Nothing else. The board is written once per read, and once after a successful review action to add a stale mark (`staleAt`, `markStale`). A board copy treats a board with a newer stale mark as unread (`fetchedAtOf`), and a read keeps a mark made while it ran (`keepStale`).
- Read sequence (`readBoard`): list the local folders of the spaces; probe each folder with `git rev-parse` and `git remote get-url origin`; merge them into projects (`remote.js`); find `gh`, and `glab` only when a GitLab project exists (the setting, the bare name, then the install folders; the first whose `--version` runs; the result, found or missing, is kept until the setting changes or the refresh button is pressed); read GitHub; read GitLab.
- GitHub calls: `gh api user --jq .login`; `gh search prs --review-requested=@me` and `--author=<login>` (`--state=open --archived=false --limit 100 --json number,url`); `gh pr list --repo <repo>` per project and per searched repo; `gh pr view <n> --repo <repo>` for a searched pull request the list did not return, except for a repo whose list failed (`withoutFailedRepos`). The list and view calls run through `mapPool` (`lib/pool.js`) with 4 at a time. A search, list or query that returns the limit (`LIST_LIMIT`, 100) adds the note "Showing the first 100 …".
- GitLab calls (`glab api graphql --hostname <host>`): one query for the user's review-requested and authored merge requests per host, one per project (4 at a time), one detail query for the pane. A merge request without a usable `iid` is left out of a list.
- A failed call adds one note and leaves the rest of the board. `gh` or `glab` missing, signed out or rate limited each give a note.
- Lock: the copy that takes `argus-pull-requests.lock` (`lib/sync.js`, `lib/gate.js`) reads. The board is read again when it is older than the interval, on refresh, and when a space shows a folder the last read did not know and that folder gives a project key the board does not have yet (`watchFolders`, checked every 5 seconds; any other unknown folder waits for the next scheduled read).
- Groups (`groupOf`): draft first; then "Needs work" when a check failed, changes are requested or the merge conflicts; then "Ready to merge" when the review is approved or absent, no check runs and the merge state is mergeable; else "Waiting on review".
- Follow space: the folder of the focused space (`follow.js`, a copy of `lib/follow.js`) picks the project that holds it. No match shows "This space is not a GitHub or GitLab repo."
- Filter: case-insensitive match on title, author and branch, and on the number with or without `#` (`matchesFilter`).
- Row click: sets `argus-pull-requests.selected`. If the shown tab has a pane of this mod, `pane.focus` it; else `pane.split { direction: "right", mod: "argus-pull-requests", props: { view: "pr" } }`.
- Pane read: `gh pr view` or the GitLab detail query when the selection changes, and again when the board is newer.
- Open in browser: `open <url>` (`xdg-open` elsewhere) for an http or https URL.
- Check out in a worktree (`runCheckout`, `worktree.js`):
  1. Read the worktrees folder from `settings.json` (`worktrees.directory`, default `~/.herdr/worktrees`).
  2. `git worktree list --porcelain` in the local clone. A worktree already on branch `pr/<n>` (`mr/<n>` on GitLab) is opened: `space.select` when a space shows it, else `space.new`.
  3. When the local branch `pr/<n>` (`mr/<n>`) exists without a worktree, `git fetch --no-tags origin refs/pull/<n>/head` (`refs/merge-requests/<n>/head` on GitLab) reads the head into `FETCH_HEAD`, and `git rev-list --count FETCH_HEAD..refs/heads/pr/<n>` counts the branch commits that are not on it. A count above 0 refuses with a message and changes nothing (`aheadCount`, `aheadRefusal`).
  4. `git fetch --no-tags origin +refs/pull/<n>/head:refs/heads/pr/<n>` creates the branch or force-updates a branch that holds nothing extra.
  5. `git worktree add <root>/<repo folder>/pr-<n> pr/<n>` (`mr-<n>` on GitLab), then `space.new { folder }`.
  The fetches and the add may take up to 10 minutes. The button of that pull request is disabled while it runs; other pull requests keep theirs. An error from Open in browser or Check out shows on its own pull request only.
- Review actions (`actions.js`, `runAction`): `actionCommand` builds the command; bodies go in as one `--body=<text>` (gh) or `--message=<text>` (glab) argument.
  - GitHub: `gh pr review <n> --repo <repo>` with `--approve`, `--request-changes --body=…` or `--comment --body=…`; `gh pr merge <n> --repo <repo> --<method> --match-head-commit <sha>`. The method comes from `gh repo view <repo> --json viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed` (`pickMergeMethod`).
  - GitLab (`-R https://<host>/<repo>`): `glab mr approve <n> --sha <sha>`; `glab mr note draft create <n> --message=…`, then `glab mr note draft publish <n> --reviewer-state=requested_changes --yes` (publish exits with an error when nothing is pending; a failed publish leaves the draft and says so); `glab mr note create <n> --message=… --resolvable=false`; `glab mr merge <n> --yes --auto-merge=false --sha <sha>`, plus `--squash` when `squashOnMerge` is true.
  - The head SHA comes from the detail read (`headRefOid`, `diffHeadSha`). Without it, Merge and GitLab Approve refuse before running.
  - One action runs at a time per pull request. Every action ends with a read of the pull request (`afterAction`), so a refused head pin shows the new head. Success closes the confirm, closes and clears the comment box only after Request changes or Comment, and adds a stale mark to the board so a board copy reads it on its next 5 s tick. When the publish step of a GitLab Request changes fails, the action state keeps `drafted`, and the next Submit runs only the publish. When the pane opens another pull request, `leavePr` keeps the typed text, the open comment box, a kept draft and a running action of the one it leaves, and drops its merge confirm and an error already shown.
- Timeouts: `gh` and `glab` 30 s; `git` reads 15 s; `git fetch` and `git worktree add` 10 min.

## Built from

- `main.js`: the `View`; `exec`, `home`, `appHome`, `readTextFile`, `checking`, `theme`, `shared`, `setShared`, `props`, `run`, `openOverlay`, `closeOverlay`, `panes`, `spaces`, `focused`, `window` from `herdr`; `randomUUID` from `crypto`; `InputState` and `TextareaState` from `gpui-base`.
- `remote.js` (repo probing and projects), `locate.js` (settings, command lookup, notes), `forge.js` (argument lists and GraphQL text), `model.js` (CLI output to the pull request model), `board.js` (board, scopes, groups, filter, row text), `worktree.js` (check out plan), `actions.js` (review and merge commands), `follow.js` (focused-space helpers). All pure, tested with `node --test`.
- `ui.js`, `icons.js`, `menu.js`, `pool.js`, `gate.js`, `sync.js` and `follow.js` are copies of the files in `lib/`.

## Watch out

- Herdr's `exec` has no stdin or env options.
- Herdr app 0.1.16 does not load a symlinked mod folder: copy it with `scripts/install.sh`.
- A `gh` or `glab` command setting that does not run falls back to PATH and the install folders, so a wrong setting shows no note while one of those runs.
- A GitHub Enterprise host is read as GitLab, because every host other than github.com and a few known other forges is treated as GitLab.
