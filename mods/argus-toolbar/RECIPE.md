# Argus toolbar

Buttons beside Herdr's tab bar that open this repo's panel mods in a panel on the right, the way Herdr's Files and Changes buttons open theirs.

## What you see

A bar the height of the tab bar, on `chrome` with a 1 px bottom `border`, buttons right-aligned 3 px apart and 10 px from the edge. Each button: 26 px high, 8 px side padding, radius 6, 12 px text, a 14 px icon tinted with the text 5 px before the label. With `display` `"icons"` a button with an icon shows only the icon and has the label as a tooltip (`.tooltip(label)`); with `"labels"` it shows only the label. A button without an icon shows its label in every mode. `selected` with `foreground` text when its panel is open, else `chrome` and `muted`; `hover` on hover.

## How it behaves

- A click on a closed button selects its mod in the panel stack (`layout.select { stack, child }`) and shows the panel column (`layout.show { id }`). A click on the open one hides the column (`layout.hide { id }`).
- The open state comes from the shown layout (`layout()`): the column not hidden and the stack's `active` child.

- Order: the buttons come from `sortButtons(buttons, order)` (`order.js`): the ids in `order` first, then the rest A to Z by label, case-insensitive. `order` is `toolbar.order` in `argus.json` in the app folder (`appHome()`), read with `readTextFile`. A missing file or key gives the default order.
- The mod follows the file: from `init` it starts a task that loops on `watchFolder(appHome())`, reads the file when the first watch starts and after a batch that names `argus.json` or the app folder itself, or is empty (`touchesFile`), and acts only when the text differs from the last read; a batch about other files starts the next watch without a read. After a batch (`waitAfter`) the next watch starts 300 ms later when the batch names `argus.json` or the app folder itself, 5 s later when the batch is empty (the watch was given up), and at once for a batch about other files; the read after the wait covers a save made during it. Invalid JSON or a wrong type (`toolbarSettings` in `toolbar-logic.js`) shows one toast per distinct bad text (`badFileToast`): the title `argus.json could not be read; using the default settings` for a file that is not usable, or `argus.json has invalid settings; using defaults for them` when only `order` or `display` is invalid, and the reason as the toast body. A bad `order` or `display` value falls back for that setting only.
- Display: `display` is `toolbar.display` in the same file: `"icons"`, `"labels"` or `"both"` (default; a missing or unknown value). The button row (`#toolbar-buttons`, content-sized) reports its rendered width through `on_size_change`; `fit()` asks `measuredResize` (`toolbar-logic.js`) for that width plus the 10 px right padding, rounded up, and when the live `layout()` width of block `argus-toolbar` differs runs `layout.resize { id: "argus-toolbar", px }`. The resize does not change the row's own width, so it settles after one call. It never runs in `render`; a display change re-renders the row and the new width follows.

## Built from

- `mod.json`: `{ "place": "none", "title": "Argus toolbar" }`.
- `main.js` reads `props()`: `{ panel: "argus-panel", stack: "argus-panels", buttons: [{ id, label, icon }] }`. `icon` is a path under `~/.config/herdr-app` (`mods/<mod>/<file>.svg`).
- `toolbar-logic.js`: `isOpen`, `clickCommands`, `toolbarSettings`, `touchesFile`, `waitAfter`, `badFileToast`, `measuredResize`, `DISPLAYS`, `SETTLE_MS`, `POLL_MS`. `order.js`: a copy of `lib/order.js`. Each button also stops the left mouse-down (`cx.stop_propagation()`) like Herdr's own buttons, so a press does not start a window drag.
- `scripts/build-layout.mjs` (repo) places it: the `tabs` block becomes the first child of row `argus-tabs-row`, followed by this block (its first width is an estimate from `scripts/toolbar-seed.mjs` for the `toolbar.display` in `argus.json`, which the script reads: `10 + Σ(16 + 16 for an icon the mode shows + 7 × label length for a label the mode shows) + 3 × (buttons − 1)` px; the mod replaces it with the measured width); the toolbar and keep-awake blocks carry `window_drag: true` like Herdr's `tabs` block; column `argus-panel` (size, min and max copied from Herdr's `panel` block in `main.json`, 368 px, 280 to 900 px today; hidden) with stack `argus-panels` goes last in `work-body`. A mod gets a button by declaring `"panel": { "label", "icon" }` in its `mod.json`.

## Watch out

- The panel column is separate from Herdr's `panel` / `panel-body`: Herdr's `tabs` mod hides `panel` on a space switch when the remembered panel is not Files or Changes.
- The layout is generated: rebuild it after a Herdr update or a mod install; hand edits are lost.
- A new layout starts with the default theme; pick the theme once in it.
