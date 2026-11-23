# Argus settings

A Settings panel that shows `~/.config/herdr-app/argus.json` in Herdr's code editor, so you can change the Argus settings without leaving Herdr.

- Save checks the text first, with the same rules the mods use when they read the file. Text that is not JSON, or a setting with a wrong value, shows each problem under the editor, and the file stays as it was.
- Save writes only when the file on disk is still the text the panel last read. When another program changed it, the panel says "argus.json changed on disk. Revert to load it, or copy your edits first." and writes nothing.
- Revert reads the file again. With unsaved changes, the first click asks and the second click discards them.
- Without `argus.json`, the panel shows a short template with the default toolbar display. Save creates the file.
- Use the Save button to save. The panel does not change your `keys.json`.

The settings that `argus.json` holds are listed in the [README](../../README.md).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-settings
node scripts/build-layout.mjs
```

The build adds a Settings button to the Argus toolbar.
