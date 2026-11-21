# Issues

GitHub and GitLab issues in Herdr. Board in a panel on the right, one issue in a pane beside the terminals. The mod only reads: it writes nothing to GitHub or GitLab.

- Groups: one per repo, with a count, repos A to Z. Newest update first inside a group.
- Row: number, title, age of the last update; then the author and the labels, and the assignees on the right (the first login and how many more).
- Scope button in the header, with two separate choices and counts.
  - Show: Assigned to me, Created by me, Mentions me or All open. All open lists every issue the board holds: the ones of the other choices and the open issues of the projects in your spaces.
  - In: Follow space, All repos or one project (each project is indented under All repos).
  - The list stays open after a pick, so you can set both; Escape or a click outside closes it.
  - Assigned to me, Created by me and Mentions me search every repo you can see on GitHub, and on each GitLab host of your projects, not only the projects in your spaces. Issues from other repos show in All repos.
  - Follow space uses the project that holds the focused space's folder. A new space shows "Reading this space…" until the board knows its folder.
  - The default is Assigned to me in All repos. A project is a GitHub or GitLab repo found in an open space.
- Mentions me is GitHub only: GitLab has no search for mentions. When the scope holds a GitLab project, a line says so.
- Filter field at the bottom: matches the title, the number (`#12` or `12`), the author, a label and an assignee.
- Click a row: the issue opens in a pane on the right of the current tab, or the tab's open issue pane shows it.
- Issue pane:
  - Header: repo and number, its place in the board's list (`3 of 9`) with ↑ and ↓ to show the previous or next issue, and Open in browser. Then the title, the state (Open, or Closed with GitHub's reason: completed, not planned or duplicate), "confidential" on a confidential GitLab issue, and who opened it and when it changed last.
  - Assignees, labels and the milestone.
  - Folding sections: Description and Comments. Both start open; your choice stays per issue while the pane is open.
  - Comments: name, age and the text rendered as Markdown. Names are display names when the forge gives one, with the login as a tooltip. A link opens in the browser; only http and https links open.
  - A comment that GitHub hid (for example as spam) shows "Hidden by GitHub as spam." and no text. A GitLab internal note has an "internal" chip. GitLab system notes (label and state changes) are left out.
  - When GitLab has more comments than one read returns, a line says so and points to Open in browser.
  - The pane reads the issue again after each board read.
- Live: the board reads when it opens, every 3 minutes by default, and within about 5 seconds after a space with a new project opens. One open copy reads at a time.
- Notes in the panel: `gh` or `glab` missing, a failed read with the CLI's message (for example signed out or rate limited), and lists cut at 100 issues. The refresh icon reads again and looks for `gh` and `glab` again.

## Reads

- GitHub: `gh search issues` with `--assignee=@me`, `--author=@me` and `--mentions=@me`, open issues in repos that are not archived, newest update first, 100 each. `gh issue list` for the open issues of each GitHub project, 100 each. `gh issue view` for the pane.
- GitLab: `glab api graphql` on each host of your GitLab projects. Your username, then the open issues assigned to you and opened by you (GitLab's `issues` query, which GitLab marks as an experiment), then the open issues of each GitLab project, 100 each. One more query for the pane.
- No tokens: `gh` and `glab` carry your sign-in.

## Settings

Gear icon in the header:

- gh command: empty uses `gh` from PATH, else the usual install folders. A set command that fails also falls back to the bare name on PATH and the usual install folders.
- glab command: empty uses `glab` from PATH, else the usual install folders. A set command that fails falls back the same way.
- Refresh every: 1, 3, 5, 10 or 15 minutes.
- Comments: Oldest first (the default) or Newest first.

The reads were checked with `gh` 2.105.0 and `glab` 1.131.0, signed in. You need `gh`, `glab` or both.

## Open it

In the `Argus` layout: the Issues button beside the tab bar.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-issues
node scripts/build-layout.mjs
```
