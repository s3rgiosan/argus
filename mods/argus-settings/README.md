# Argus settings

A Settings window that shows `~/.config/herdr-app/argus.json` in Herdr's code editor, so you can change the Argus settings without leaving Herdr.

- Save checks the text first, with the same rules the mods use when they read the file. For text that is not JSON, or a setting with a wrong value, the panel shows the problem under the editor (the first one of each section), and the file stays as it was.
- Save writes only when the file on disk is still the text the window last read. When another program changed it, the window says "argus.json changed on disk. Revert to load it, or copy your edits first." and writes nothing.
- Revert reads the file again. With unsaved changes, the first click asks and the second click discards them.
- Without `argus.json`, the window shows a short template with the default toolbar display. Save creates the file.
- Use the Save button to save.

The settings that `argus.json` holds are listed in the [README](../../README.md).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-settings
```

## Open it

The `mod.open` command opens the window, and runs again to close it. To open it with a key, add a line to the `global` section of `~/.config/herdr-app/keys.json` (⌘, is Herdr's own Settings):

```json
"cmd-shift-,": "mod.open:argus-settings"
```

From a terminal:

```sh
herdr-app do mod.open '{"name":"argus-settings"}'
```

The install script does not change your `keys.json`.
