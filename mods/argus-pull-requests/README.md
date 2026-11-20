# Pull requests

GitHub pull requests and GitLab merge requests in Herdr. Board in a panel on the right, one pull request in a pane beside the terminals. The mod writes to GitHub or GitLab only when you click one of the review actions.

- Four groups with counts: Ready to merge (checks pass, nothing running, mergeable, approved or no review needed), Needs work (a failed check, changes requested or a merge conflict), Waiting on review (everything else), Draft. Newest first inside a group.
- Row: number, title, checks (`✓ 3/3`, `✗ 1/3` or `● running`), age, repo, branch and review state. An accent dot means a review agent worktree exists for it.
- Scope button in the header, with two separate choices and counts. Show: Needs my review, Mine or All open. All open lists every pull request the board holds: the ones that need your review, your own, and the open ones of the projects in your spaces. In: Follow space, All repos or one project (each project is indented under All repos). For example, Needs my review in Follow space lists the pull requests that need your review in the focused space's repo. The list stays open after a pick, so you can set both; Escape or a click outside closes it. Follow space uses the project that holds the focused space's folder. The default is Needs my review in All repos. A project is a GitHub or GitLab repo found in an open space.
- Filter field at the bottom: matches the title, number (`#12` or `12`), author and branch.
- Click a row: it opens in a pane on the right of the current tab, or the tab's open pull request pane shows it.
- Pull request pane:
  - Header: repo and number, its place in the board's list (`3 of 9`) with ↑ and ↓ to show the previous or next pull request, and Open in browser and Check out in a worktree icons; then the title and `head → base`.
  - Verdict: the board's word for the pull request (Ready to merge, Needs work, Waiting on review, Draft), or Merged or Closed, in its color, with the reasons in one line (checks, review, conflicts or the merge block).
  - Folding sections: Checks (failed and running ones listed; passed ones in one line with Show, or listed when there are five or fewer and nothing failed), Reviews, Review agent, Description and Conversation. Each heading shows a summary when folded. Checks opens by itself when a check failed or runs, Conversation when a file thread is open, Review agent when a run exists; your own open or closed choice stays per pull request.
  - Conversation: each comment and review as a name, a chip (commented, reviewed, approved, changes requested, dismissed) and its age, then a balloon with its text rendered as Markdown and, for a review, its file comments, each under a bar with the file, line and open or resolved. Names are display names (the login when the forge has no name); inside a balloon only replies from someone else show a name. A file comment whose review is not listed shows on its own. The pane reads file comments with a second `gh` call on GitHub; when that call fails, the pane shows the rest and a line with the reason.
  - Footer: Review with agent, Merge ▾ and ⋯. The ⋯ menu holds Comment…, Approve, Request changes…, Check out in a worktree and Open in browser. Comment… and Request changes… open a text field above the footer. A pull request that is no longer open keeps only ⋯ with Check out and Open in browser.
- After an action, failed or not, the pane reads the pull request again while it is still the selected one. After any action the board reads again within about 5 seconds, while a Pull requests panel is open. A failure shows the `gh` or `glab` message above the footer, and the text field keeps your text. After a success the field clears and closes, unless you changed its text while the action ran. While an action runs on a pull request, its buttons are off in every pane. Text you type stays with its pull request when you open another one. ⌘Return in the text field runs its action.
- On a GitHub pull request you opened, Approve and Request changes are off, with a line that says why: GitHub does not let the author approve or request changes. The pane reads your login with `gh api user` and keeps it for 5 minutes; when that read fails, the buttons stay on and GitHub's message explains a refusal.
- Merge ▾ lists the merge methods the repo allows, with your default marked; picking one asks first and names the pull request, the base branch and the method. GitHub: merge commit, squash and rebase as the repo allows them. GitLab: Merge and Squash and merge; only Squash and merge when the merge request is set to squash (glab can turn squash on, not off; the menu says so), and only Merge when the project does not allow squash. If the merge request changes while the confirm is open, Merge asks you to pick a method again. Squash and merge sends `--squash`. On GitLab, Merge never turns on auto-merge. On a GitHub branch that requires a merge queue, `gh` adds the pull request to the queue, or turns on auto-merge when required checks have not passed yet.
- Merge, and Approve on GitLab, only go through when the head commit is still the one the pane showed: for Merge, the one shown when the confirm opened. After a new push the CLI refuses, and the pane reads the pull request again.
- On GitLab, Request changes first lists your pending review comments on the merge request, because a publish sends all of them. With none, it adds your comment as a pending review comment and publishes it as a review. With others pending, it refuses and asks you to publish or delete them on GitLab. If the publish step fails, the comment stays pending: a Submit with the same text only publishes it, and a changed text is refused. It uses `glab mr note draft`, which glab marks as experimental.
- Check out in a worktree: fetches the pull request head into a local branch `pr/<number>` (`mr/<number>` on GitLab) and adds a worktree for it under the worktrees folder from Herdr's `settings.json`, then opens a space there. A second click opens the same space. Needs a local clone of the repo, found from the open spaces.
- Review with agent: a dialog with Agent, Model, Branch and Extra instructions. Start adds a worktree on a new branch from the main checkout's `HEAD` (under the worktrees folder from Herdr's `settings.json`) and opens a space there, with the agent and a read-only review prompt as its first message. Needs a local clone of the repo, found from the open spaces.
  - Agents: every installed agent that Herdr knows. Claude Code shows once per account (`~/.claude` and each `~/.claude-*`, named as in the Usage panel); an extra account starts with `env CLAUDE_CONFIG_DIR=<folder> claude`. Model shows only for Claude Code (`--model`).
  - Branch: `argus/review-<number>-<title>-<8 hex>` by default. Edit it freely, but keep the `argus/review-<number>-` start: the board finds review runs by it.
  - Agents start with your own permission settings: no flag restricts them. The prompt tells the agent to stay read-only (no edits, commits, pushes, comments, approvals or merges), to check the pull request number, branches and head commit with `gh` or `glab`, to read the changes at that commit, and to report findings by severity.
  - Claude Code asks once per new worktree whether you trust the folder; the review prompt arrives after you answer.
  - The pull request title, author and branches go into the prompt as quoted data, before the rules.
  - Start hands the run to the pull request pane, so closing the dialog does not stop it. The dialog closes when the agent's space opens, or shows the error; when you closed the dialog first, a failed start shows a toast. If the pane is not open, the dialog says so after 5 seconds; if the start has not finished after 2 minutes (for example, the pane closed), the dialog says so and points to the Agent tab, where a worktree it left can be opened or removed. Start refuses a pull request that is no longer open and a base branch whose name has characters other than letters, digits, `.`, `_`, `/` and `-`, and names that branch.
  - Extra instructions for every review: `pullRequests.review.instructions` in `~/.config/herdr-app/argus.json` (text). They come before the dialog's extra instructions, under a line that says the read-only rules still apply.
  - Agent section in the pane: each review run with Open space and Remove worktree. Remove asks first; a worktree with changes asks again before it removes it with `--force`. Then it deletes the branch, unless the branch has commits: a toast says so. A locked run cannot be removed here, and a run whose folder is gone can only be removed. With two separate clones of one repo, only the runs of one clone show.
- Live: the board reads when it opens, every 3 minutes by default, and within about 5 seconds after a space with a new project opens. One open copy reads at a time.
- Notes in the panel: `gh` or `glab` missing, signed out or rate limited. The refresh icon reads again.

## Settings

Gear icon in the header:

- gh command: empty uses `gh` from PATH, else the usual install folders. A set command that fails also falls back to the bare name on PATH and the usual install folders.
- glab command: empty uses `glab` from PATH, else the usual install folders. A set command that fails falls back the same way.
- Refresh every: 1, 3, 5, 10 or 15 minutes.
- Conversation: Oldest first (the default) or Newest first, for the comments in the pull request pane.

Tested on `gh` 2.104.0 and `glab` 1.131.0, signed in. You need `gh`, `glab` or both.

## Open it

In the `Argus` layout: the Pull requests button beside the tab bar.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-pull-requests
node scripts/build-layout.mjs
```
