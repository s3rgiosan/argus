# Pull requests

GitHub pull requests and GitLab merge requests as a Herdr panel, with one pull request in a pane beside the terminals. Every read goes through `gh`, `glab` and `git`. The mod writes nothing to GitHub or GitLab.

## What you see

- `mod.json`: `{ "place": "none", "title": "Pull requests", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Pull requests", "icon": "icons/git-pull-request.svg" } }`. The `argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel.
- One mod, views picked by `props().view`: none or `"board"` (the panel, with a settings page), `"scopes"` (popup), `"pr"` (pane).
- Board, drawn with `ui.js` (a copy of `lib/ui.js`): header with "Pull requests", the count badge (Herdr's Changes pill: 10 px `muted`, 1 px `border`, radius 4), the scope button, refresh (it turns while this copy reads) and settings icon buttons; scroll area; bottom bar with the filter field. Notes show at the top of the scroll area.
- Group titles: "Ready to merge · n", "Needs work · n", "Waiting on review · n", "Draft · n", titled like Herdr's group headings (11.5 px, medium, `dim`). Empty groups are left out.
- Row: number, title, checks, age, then repo and branch and the review state. The selected row is on `selected`.
- Scopes popup: Needs my review, Mine, Follow space, then a Projects section. Rows use Herdr's menu metrics (31 px, 8 px side padding, radius 7, 12.8 px text, 5 px around the list); the count shows dim on the right and the chosen scope has an `accent` tick. Up and Down move the highlight, Enter picks, Escape closes, a click picks. A pick sets the scope and closes the popup.
- Pull request pane: header with repo, number and state, branch line, title, the "No local checkout" note when the repo has no local clone, the Open in browser and Check out in a worktree buttons, then Checks, Reviews, Merge state, Description and Conversation.
- Settings view: gh command and glab command fields, and the refresh interval as Herdr's Settings segmented control (1 / 5 / 15 min). Icons Herdr ships with the same drawing (chevron-left, chevron-down, settings, check) load from Herdr's `mods/workspace-chrome/` folder when it exists, probed once in `init`; the Lucide copies in `icons/` show otherwise.

## How it behaves

- `shared` keys (prefix `argus-pull-requests.`): `board`, `scope`, `selected`, `settings` `{ gh, glab, interval }`, `lock`. Nothing else. The board is written once per read.
- Read sequence (`readBoard`): list the local folders of the spaces; probe each folder with `git rev-parse` and `git remote get-url origin`; merge them into projects (`remote.js`); find `gh` and `glab` (the setting, the bare name, then the install folders; the first whose `--version` runs); read GitHub; read GitLab.
- GitHub calls: `gh api user --jq .login`; `gh search prs --review-requested=@me` and `--author=<login>` (`--state=open --archived=false --limit 100 --json number,url`); `gh pr list --repo <repo>` per project and per searched repo; `gh pr view <n> --repo <repo>` for a searched pull request the list did not return.
- GitLab calls (`glab api graphql --hostname <host>`): one query for the user's review-requested and authored merge requests per host, one per project, one detail query for the pane.
- A failed call adds one note and leaves the rest of the board. `gh` or `glab` missing, signed out or rate limited each give a note.
- Lock: the copy that takes `argus-pull-requests.lock` (`lib/sync.js`, `lib/gate.js`) reads. The board is read again when it is older than the interval, on refresh, and when a space shows a folder the last read did not know (checked every 5 seconds).
- Groups (`groupOf`): draft first; then "Needs work" when a check failed, changes are requested or the merge conflicts; then "Ready to merge" when the review is approved or absent, no check runs and the merge state is mergeable; else "Waiting on review".
- Follow space: the folder of the focused space (`follow.js`, a copy of `lib/follow.js`) picks the project that holds it. No match shows "This space is not a GitHub or GitLab repo."
- Filter: case-insensitive match on title, author and branch, and on the number with or without `#` (`matchesFilter`).
- Row click: sets `argus-pull-requests.selected`. If the shown tab has a pane of this mod, `pane.focus` it; else `pane.split { direction: "right", mod: "argus-pull-requests", props: { view: "pr" } }`.
- Pane read: `gh pr view` or the GitLab detail query when the selection changes, and again when the board is newer.
- Open in browser: `open <url>` (`xdg-open` elsewhere) for an http or https URL.
- Check out in a worktree (`runCheckout`, `worktree.js`):
  1. Read the worktrees folder from `settings.json` (`worktrees.directory`, default `~/.herdr/worktrees`).
  2. `git worktree list --porcelain` in the local clone. A worktree already on branch `pr/<n>` (`mr/<n>` on GitLab) is opened: `space.select` when a space shows it, else `space.new`.
  3. Else `git fetch --no-tags origin refs/pull/<n>/head:refs/heads/pr/<n>` (`refs/merge-requests/<n>/head` on GitLab).
  4. `git worktree add <root>/<repo folder>/pr-<n> pr/<n>`, then `space.new { folder }`.
  The fetch and the add may take up to 10 minutes; the button is disabled while it runs.
- Timeouts: `gh` and `glab` 30 s; `git` reads 15 s; `git fetch` and `git worktree add` 10 min.

## Built from

- `main.js`: the `View`; `exec`, `home`, `appHome`, `readTextFile`, `checking`, `theme`, `shared`, `setShared`, `props`, `run`, `openOverlay`, `closeOverlay`, `panes`, `spaces`, `focused`, `window` from `herdr`; `randomUUID` from `crypto`; `InputState` from `gpui-base`.
- `remote.js` (repo probing and projects), `locate.js` (settings, command lookup, notes), `forge.js` (argument lists and GraphQL text), `model.js` (CLI output to the pull request model), `board.js` (board, scopes, groups, filter, row text), `worktree.js` (check out plan), `follow.js` (focused-space helpers). All pure, tested with `node --test`.
- `ui.js`, `gate.js`, `sync.js` and `follow.js` are copies of the files in `lib/`.

## Watch out

- Herdr's `exec` has no stdin or env options.
- Herdr app 0.1.16 does not load a symlinked mod folder: copy it with `scripts/install.sh`.
- A `gh` or `glab` command setting that does not run falls back to PATH and the install folders, so a wrong setting shows no note while one of those runs.
- A GitHub Enterprise host is read as GitLab, because every host other than github.com and a few known other forges is treated as GitLab.
