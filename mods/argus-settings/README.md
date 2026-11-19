# Argus settings

A popup that sets the order of the Argus toolbar's panel buttons.

Open it with `⌘⌥,` after you merge the key into your `keys.json`, or run `herdr-app do mod.open '{"name":"argus-settings"}'`. The same command closes it again. The key is in `mods/argus-settings/keys.json`:

```json
{ "global": { "cmd-alt-,": "mod.open:argus-settings" } }
```

Merge it by hand: add the `global` key to `~/.config/herdr-app/keys.json`. Any edit to that file makes the whole file yours, so Herdr stops adding new default shortcuts when it upgrades; add those by hand.

The Toolbar section lists the buttons in their current order. The up and down buttons move a row; up is off on the first row and down on the last. Save stores the order and closes the popup. Cancel and Esc close it without a change.

The toolbar shows the saved order first, then any button not in it from A to Z by label. Nothing is saved until you press Save.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-settings argus-toolbar
```

The install script does not change your `keys.json`.
