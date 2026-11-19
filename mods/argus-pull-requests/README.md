# Pull requests

GitHub pull requests and GitLab merge requests in Herdr. Board in a panel on the right, one pull request in a pane beside the terminals. The mod writes to GitHub or GitLab only when you click one of the review actions.

- Four groups with counts: Ready to merge (checks pass, nothing running, mergeable, approved or no review needed), Needs work (a failed check, changes requested or a merge conflict), Waiting on review (everything else), Draft. Newest first inside a group.
- Row: number, title, checks (`✓ 3/3`, `✗ 1/3` or `● running`), age, repo, branch and review state.
- Scope button in the header: Needs my review, Mine, Follow space and each project, with counts. Follow space shows the project that holds the focused space's folder. The default scope is Needs my review. A project is a GitHub or GitLab repo found in an open space.
- Filter field at the bottom: matches the title, number (`#12` or `12`), author and branch.
- Click a row: it opens in a pane on the right of the current tab, or the tab's open pull request pane shows it.
- Pull request pane: Open in browser, Check out in a worktree, then Checks, Reviews, Merge state, Description and Conversation.
- Review actions on an open pull request: Approve, Request changes, Comment and Merge. Request changes and Comment open a comment box; ⌘Return or Submit sends it, and an empty comment is not sent. After an action the pane reads the pull request again and the board refreshes within about 5 seconds. A failure shows the `gh` or `glab` message in the pane.
- Merge asks first and names the pull request, the base branch and the method. GitHub uses your default merge method for the repo when the repo allows it, else the first allowed of merge commit, squash and rebase. GitLab uses the project's merge method and squashes when the merge request is set to squash. Merge never turns on auto-merge.
- Merge, and Approve on GitLab, only go through when the head commit is still the one the pane shows. After a new push the CLI refuses; the pane then shows the new head.
- On GitLab, Request changes publishes your comment as a review, with any review comments you left pending on that merge request.
- Check out in a worktree: fetches the pull request head into a local branch `pr/<number>` (`mr/<number>` on GitLab) and adds a worktree for it under the worktrees folder from Herdr's `settings.json`, then opens a space there. A second click opens the same space. Needs a local clone of the repo, found from the open spaces.
- Live: the board reads when it opens, every 3 minutes by default, and within about 5 seconds after a space with a new project opens. One open copy reads at a time.
- Notes in the panel: `gh` or `glab` missing, signed out or rate limited. The refresh icon reads again.

## Settings

Gear icon in the header:

- gh command: empty uses `gh` from PATH, else the usual install folders. A set command that fails also falls back to the bare name on PATH and the usual install folders.
- glab command: empty uses `glab` from PATH, else the usual install folders. A set command that fails falls back the same way.
- Refresh every: 1, 3, 5, 10 or 15 minutes.

Needs `gh` 2.x (tested on 2.104.0) and/or `glab` 1.x (tested on 1.131.0), signed in.

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
