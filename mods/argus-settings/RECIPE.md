# Argus settings

A popup that sets the order of the Argus toolbar's panel buttons.

## What you see

- A frame with a 42 px header `Argus Settings`, a `TOOLBAR` section title, one 28 px row per toolbar button (14 px icon, label, a 26 px up icon button and a 26 px down icon button), and a footer with Cancel and Save (Save is the primary button). The popup is 360 px wide; its height is 260 px and the rows scroll.

## How it behaves

- The rows come from the `argus-toolbar` block's `props.buttons` in `layout()`, sorted by the shared key `argus-toolbar.order` (`sortButtons`).
- Up and down edit a draft list only. Up is dimmed on the first row and down on the last (`canMoveUp`, `canMoveDown`).
- Save calls `setShared("argus-toolbar.order", ids)` and closes the popup. Cancel closes it. Esc closes the top popup.

## Built from

- `keys.json`: the shortcut.
- `mod.json`: `{ "place": "none", "title": "Argus Settings", "overlay": { "width": 360, "height": 260 } }`.
- `main.js`: the view. `settings-logic.js`: `toolbarButtons`.
- `order.js` and `ui.js`: copies of `lib/order.js` and `lib/ui.js` (`node scripts/sync-lib.mjs`).
- `icons/`: Lucide `arrow-up`, `arrow-down` and `LICENSE-Lucide.txt`.

## Watch out

- `keys.json` binds `cmd-alt-,` in `global` to `mod.open:argus-settings`. The person merges it into `~/.config/herdr-app/keys.json`; the install script leaves that file alone. Running `mod.open` again closes the popup.
- A panel mod that is not in the layout's toolbar buttons does not show in the list.
