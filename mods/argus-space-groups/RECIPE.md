# Space groups

The popups of the space groups in Argus's sidebar copy (`argus-spaces`): the group menu, the Add spaces checklist and the group name field. The sidebar side lives in `lib/space-groups-view.js`, which `scripts/build-layout.mjs` writes into the copy with `lib/space-groups.js`, `lib/menu.js`, `lib/ui.js`, `lib/icons.js` and the copy's `icons/`.

## What you see

- `mod.json`: `{ "place": "none", "title": "Space groups" }`. No panel; only the sidebar copy opens it.
- One mod, three views picked by `props().view`: two pointer popups and one dialog.
  - `"group"` (200 px wide): `menuRow`s from `groupMenu(store, group)`: "Add spaces…", "Rename", "Move up" (not on the first group), "Move down" (not on the last), "Delete group". A deleted group shows one disabled row, "This group was deleted.".
  - `"add"` (260 px): one `menuRow` per `props().rows` entry (`{ key, name }`). `current` (the accent tick) when the row is in this group; `count` is the name of the other group it is in. No rows: a disabled "No open spaces". Up to 420 px tall, then it scrolls.
  - `"name"` (a 260 × 84 px dialog): one `field` with "Group name" as the placeholder, and an `errorLine` under it when the name is refused.
- Sidebar copy: group headers copy Herdr's machine header (26 px, 11 px `dim`, chevron 11 px) without the machine icon. On hover, an `iconButton` with the Lucide ellipsis ("Group options"). An open empty group shows a dim 28 px "No spaces" line. The title row gets an `iconButton` with `folder-plus` ("New group"), absolute at `top(2)` and `right(38)`, left of Herdr's `+`. The folder-plus and chevron icons are Herdr's files when it has them (`probeIcons` in `argusInit`), else the copy's `icons/` (`iconResolver`). On the narrow rail: no headers, and a 20 × 1 px `border` line between groups.

## How it behaves

- Store: shared key `argus-spaces.groups`, `{ groups: [{ id, name }], members: { [key]: groupId } }`, read through `readStore` (bad values give no groups). Every write is one `setShared` after `pruneSpaces`, which drops the `["space", id]` keys of closed spaces.
- Membership key (`memberKey`): the sidebar's `repo` field of the space's git info (machine and git common folder), else `["space", id]`.
- `"group"`: Add spaces… and Rename close this popup and open the `"add"` or `"name"` view. Move up, Move down and Delete group write and close.
- `"add"`: a click or Enter toggles the row: `setMember` with this group, or with null when it is already in it. The popup stays open.
- `"name"`: without `props().group`, Enter adds a group (`addGroup` with `newGroupId`); with it, Enter renames that group. `checkName` refuses an empty name, more than 40 characters, a name another group has (case does not count) and "No group".
- Keys: ↑ and ↓ move, Enter picks, Esc closes (`menuKey`).
- Sidebar copy (`lib/space-groups-view.js`, called by the hooks of `addGroups` in `scripts/sidebar.mjs`): `argusSort` sorts the rows by group inside each machine block (`sortRows`) before the shipped `space.move` step; `argusSections` draws the sections (`sections`); a click on a header folds it (`localStorage` key `argus-spaces.groups.folded`); a drop on a header or on a row of another group sets the member.
- In this computer's section, the group headers show also when the machine has no spaces, so an empty group can still be renamed or deleted.
- The hooks refuse to apply when a name they use (`cx`, `out`, `t`, `collapsed`, `m`, `from`) is not on its anchor line in Herdr's sidebar.
- Fight guard (`guardPaused`): when Herdr's order leaves the group order 3 times within 60 s with the same groups and spaces, the copy stops sorting that machine until the groups or its spaces change. Two apps with different groups on one machine would else move its spaces back and forth.

## Built from

- `main.js`: the `View`, with `menuPopup`, `menuRow`, `field` and `errorLine` from `ui.js`, `menuKey` and `menuHeight` from `menu.js`, `createInputs` from `pane.js`, and the icon loader of `icons.js`; `spaces`, `theme`, `shared`, `setShared`, `props`, `openOverlay`, `closeOverlay`, `checking`, `readTextFile`, `appHome` from `herdr`; `View` from `gpui-kit`; `v_flex` from `gpui-base`.
- `space-groups.js`: the store, the order, the sections, the checklist, the group menu and the fight guard. Pure, tested with `node --test` (`tests/space-groups.test.js`).
- `ui.js`, `menu.js`, `pane.js`, `icons.js` and `space-groups.js` are copies of the files in `lib/`.

## Watch out

- The sidebar copy is Herdr's `spaces` mod written again by `build-layout`. When a hook anchor is gone after a Herdr update, `build-layout` prints "the sidebar has no groups" and writes the copy without groups; fix the anchors in `scripts/sidebar.mjs`.
- The copy with groups replaces Herdr's jump to the active space on a size change of the list with `argusSizeReveal`, which jumps only when the list's visible height (`scroll.viewport_size()`) drops by more than 1 px. With Herdr's jump, a scroll up ran away in a live check. The jump when the active space changes stays.
- Herdr's space menu cannot take items, so the group actions live on the group header.
- Groups are kept per Herdr app (`shared.json`); the space order is kept per machine. See the fight guard.
- In the title row (`justify_between`), a child that takes the free space (`ml_auto()`, or a `flex_1` row) hid both title buttons in a live render, also Herdr's `+`. A fixed margin and an absolute position render; the New group button is absolute.
- The first `herdr-app shot` after a hot reload can show the frame from before the reload. Wait a few seconds before you judge a shot.
- A pointer popup (`kind: "popup"`) closes when a text field in it takes focus, so the name view opens as a `dialog`.
- `herdr-app check` renders only the `"group"` view with no props; the other views, the clicks and the sidebar hooks need a live check.
