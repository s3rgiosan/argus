# Argus toolbar

Buttons beside Herdr's tab bar that open this repo's panel mods in a panel on the right, the way Herdr's Files and Changes buttons open theirs.

## What you see

A bar the height of the tab bar, on `chrome` with a 1 px bottom `border`, buttons right-aligned 3 px apart and 10 px from the edge. Each button: 26 px high, 8 px side padding, radius 6, 12 px text, a 14 px icon tinted with the text 5 px before the label. `selected` with `foreground` text when its panel is open, else `chrome` and `muted`; `hover` on hover.

## How it behaves

- A click on a closed button selects its mod in the panel stack (`layout.select { stack, child }`) and shows the panel column (`layout.show { id }`). A click on the open one hides the column (`layout.hide { id }`).
- The open state comes from the shown layout (`layout()`): the column not hidden and the stack's `active` child.

- Order: the buttons come from `sortButtons(buttons, order)` (`order.js`): the ids in `order` first, then the rest A to Z by label, case-insensitive. `order` is `toolbar.order` in `argus.json` in the app folder (`appHome()`), read with `readTextFile`. A missing file or key gives the default order.
- The mod follows the file: from `init` it starts a task that loops on `watchFolder(appHome())`, reads the file after each batch (about 300 ms later) and acts only when the text differs from the last read. When the watch fails it reads every 5 s. Invalid JSON or a wrong type (`toolbarOrder` in `toolbar-logic.js`) shows one toast, `argus.json could not be read; using the default order`, per distinct bad text and keeps the default order.

## Built from

- `mod.json`: `{ "place": "none", "title": "Argus toolbar" }`.
- `main.js` reads `props()`: `{ panel: "argus-panel", stack: "argus-panels", buttons: [{ id, label, icon }] }`. `icon` is a path under `~/.config/herdr-app` (`mods/<mod>/<file>.svg`).
- `toolbar-logic.js`: `isOpen`, `clickCommands`, `toolbarOrder`. `order.js`: a copy of `lib/order.js`.
- `scripts/build-layout.mjs` (repo) places it: the `tabs` block becomes the first child of row `argus-tabs-row`, followed by this block (width `10 + Σ(32 + 7 × label length + 3)` px); column `argus-panel` (440 px, drags between 280 and 900 px, hidden) with stack `argus-panels` goes last in `work-body`. A mod gets a button by declaring `"panel": { "label", "icon" }` in its `mod.json`.

## Watch out

- The panel column is separate from Herdr's `panel` / `panel-body`: Herdr's `tabs` mod hides `panel` on a space switch when the remembered panel is not Files or Changes.
- The layout is generated: rebuild it after a Herdr update or a mod install; hand edits are lost.
- A new layout starts with the default theme; pick the theme once in it.
