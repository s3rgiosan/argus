# Argus toolbar

Buttons beside Herdr's tab bar, styled like Herdr's Files and Changes buttons, that open this repo's panel mods in a panel on the right. A click opens the mod's panel; a click on the open one closes it. The panel column opens 440 px wide, and you can drag it between 280 and 900 px.

The buttons sort A to Z by label. Set another order in `~/.config/herdr-app/argus.json`: `{ "toolbar": { "order": ["argus-tsk", "argus-claude-usage"] } }`. The listed buttons come first, in that order. The toolbar follows the file as you save it. Set `"display"` in the same object to `"icons"`, `"labels"` or `"both"` (the default) to show the buttons as an icon with the label as a tooltip, as a label only, or as an icon and a label. The toolbar block resizes to fit when you change it. When the file is not valid, a toast says so and the defaults show. A bad value for one setting leaves the other setting as it is.

The toolbar has no other settings. `scripts/build-layout.mjs` places it in the `Argus` layout with one button for each installed mod that declares a panel in its `mod.json`:

```json
{ "panel": { "label": "Usage", "icon": "icons/chart-line.svg" } }
```

`icon` is a path inside the mod's folder. Run `node scripts/build-layout.mjs` again after installing a mod to add its button.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-toolbar
node scripts/build-layout.mjs --switch
```
