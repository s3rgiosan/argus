# Argus toolbar

Buttons beside Herdr's tab bar, styled like Herdr's Files and Changes buttons, that open this repo's panel mods in a panel on the right. A click opens the mod's panel; a click on the open one closes it.

The toolbar has no settings. `scripts/build-layout.mjs` places it in the `argus` layout with one button for each installed mod that declares a panel in its `mod.json`:

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
