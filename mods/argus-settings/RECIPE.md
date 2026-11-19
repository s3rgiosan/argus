# Argus settings

A popup that sets the order of the Argus toolbar's panel buttons.

## What you see

- Menu view (`props { view: "menu" }`): a 200 by 42 px popup on `popover` with one 31 px row, a Lucide `settings` icon and the text `Argus Settings…`.
- Settings view: a frame with a 42 px header `Argus Settings`, a `TOOLBAR` section title, one 28 px row per toolbar button (14 px icon, label, a 26 px up icon button and a 26 px down icon button), and a footer with Cancel and Save (Save is the primary button). The popup is 360 px wide; its height is `settingsHeight(rows)`.

## How it behaves

- The rows come from the `argus-toolbar` block's `props.buttons` in `layout()`, sorted by the shared key `argus-toolbar.order` (`sortButtons`).
- Up and down edit a draft list only. Up is dimmed on the first row and down on the last (`canMoveUp`, `canMoveDown`).
- Save calls `setShared("argus-toolbar.order", ids)` and closes the popup. Cancel closes it. Esc closes the top popup.
- Picking the menu item closes the menu popup and opens the settings popup.

## Built from

- `mod.json`: `{ "place": "none", "title": "Argus Settings", "overlay": { "width": 360, "height": 240 } }`.
- `main.js`: both views. `settings-logic.js`: `toolbarButtons`, `settingsHeight`.
- `order.js` and `ui.js`: copies of `lib/order.js` and `lib/ui.js` (`node scripts/sync-lib.mjs`).
- `icons/`: Lucide `arrow-up`, `arrow-down`, `settings` and `LICENSE-Lucide.txt`.

## Watch out

- The toolbar opens the menu with a right click on a panel button: `openOverlay({ mod: "argus-settings", props: { view: "menu" }, kind: "popup", width: 200, height: 42 })`.
- A panel mod that is not in the layout's toolbar buttons does not show in the list.
