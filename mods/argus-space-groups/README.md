# Space groups

The popups behind the space groups in the Argus sidebar (`argus-spaces`). Groups such as "Personal" or "Work" sort the spaces into folding sections, so spaces of different work are easy to tell apart.

- New group: the folder-plus button in the sidebar's title row opens a name field. Enter saves. A name is 1 to 40 characters, and no two groups share a name (case does not count). "No group" is kept for the spaces without a group.
- A group header shows the name, a fold chevron and, on hover, an options button. A right-click on the header opens the same menu: Add spaces…, Rename, Move up, Move down and Delete group.
- Add spaces… lists the open spaces of that machine, one row per repo. A tick marks the ones in this group; a row in another group shows that group's name. A click puts a row in this group or takes it out.
- A drag of a space onto a group header, or onto a space in another group, puts it in that group. The No group header takes a space out of its group.
- A group belongs to the repo, not to the space: every worktree space of a repo is in its group, and a repo that you open again comes back in its group. A space outside any repo is grouped on its own, until it closes.
- Herdr's space order follows the groups, so the numbers on the narrow rail match the sidebar.
- Delete group asks nothing first. Its spaces go to No group.
- With no groups, the sidebar is Herdr's, plus the New group button.

The groups are kept in Herdr's shared state, so they survive a restart. Each Herdr app keeps its own groups.

## Open it

In the `Argus` layout: the sidebar's New group button and its group headers.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-space-groups
node scripts/build-layout.mjs
```
