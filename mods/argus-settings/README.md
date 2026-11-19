# Argus settings

A popup that sets the order of the Argus toolbar's panel buttons.

Right-click a button in the toolbar and pick Argus Settings. You can also run `herdr-app do mod.open '{"name":"argus-settings"}'`. The Toolbar section lists the buttons in their current order. The up and down buttons move a row; up is off on the first row and down on the last. Save stores the order and closes the popup. Cancel and Esc close it without a change.

The toolbar shows the saved order first, then any button not in it from A to Z by label. Nothing is saved until you press Save.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-settings argus-toolbar
```
