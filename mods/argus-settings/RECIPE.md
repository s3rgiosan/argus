# Argus settings

A window that edits `argus.json` in Herdr's app folder with Herdr's code editor, checks the text before a save and never overwrites a change made on disk.

## What you see

A 640 x 640 window, opened by `mod.open {name: "argus-settings"}` (a second call closes it), with a panel frame (`frame` from `ui.js`) with a 42 px `header`: the title `Settings` and, on the right, the file path with `~` (`tildePath`), 12 px, `dim`, truncated. Under it, Herdr's `Editor` fills the space: JSON highlighting with the theme's ANSI colors (as Herdr's `files` mod), line numbers, folding and soft wrap, in `settings().font_family` and `settings().font_size`. At the bottom, a `footer` with a status column (12 px, one line per row, `dim`, or `blocked` for an error or a problem), then the `Revert` button and the primary `Save` button (`button` from `ui.js`). Save shows `Saving…`. Save and Revert are off while a read or a write runs, and Save is off until an editor exists. Before the first read, the body is `Loading argus.json…`; a first read that fails shows its reason there.

## How it behaves

- Open: `init` spawns a read of `${appHome()}/argus.json` with `readTextFile`. The text, or `TEMPLATE` (`{ "toolbar": { "display": "both" } }`, 2-space JSON and a final newline) when the file is missing, goes into an `EditorState` made in that task (never in render). `base` keeps the text read, null for a missing file.
- Status (`statusText`): the ask before a revert, else an error, else the problems of the last save, else `argus.json does not exist yet. Save creates it.` (no file), else `Unsaved changes` (`isDirty`: the editor text differs from `base`, or from `TEMPLATE` when there is no file), else `Saved at HH:MM`, else nothing.
- An edit (the editor's `change` event) clears the ask and the problems.
- Save: `checkArgusFile(text, home())` from `argus-file.js`, at most one problem per section, because each parser stops at its first error. Problems stop the save. Then `writeTextFile(path, text, base)`, which refuses when the file is not `base` (null: refuses when the file exists). On success `base` is the saved text. On a refusal the panel reads the file again and `saveFailure(expected, onDisk, message)` gives `argus.json changed on disk. Revert to load it, or copy your edits first.` when the file is not the expected text, else `Could not save argus.json (<reason>)`.
- Revert (`revertStep`): with unsaved changes, the first click asks (`Unsaved changes will be lost. Click Revert again to discard them.`), the second click reads the file again into the same editor state. Without changes it reads at once.
- `close()` releases the editor state.

## Built from

- `mod.json`: `{ "place": "none", "title": "Settings", "overlay": { "width": 640, "height": 640 } }`. No `panel`, so the Argus toolbar has no button for it. The person binds `mod.open:argus-settings` to a key in their own `keys.json`.
- `settings-logic.js`: `TEMPLATE`, `CONFLICT`, `isDirty`, `revertStep`, `saveFailure`, `statusText`. No Herdr imports.
- `main.js`: the view, the read and the write.
- Copies of lib files: `argus-file.js` (`checkArgusFile`), `paths.js`, `ui.js` and `menu.js`.

## Watch out

- `readTextFile` reads at most 1 MiB. A later read that fails (Revert) shows the reason in the status line and keeps the editor.
- The syntax colors come from the theme when the editor state is made, so a theme change shows when a new copy of the mod starts.
- The window does not watch the file. A change on disk shows at the next save or revert.
- The window binds no save key: the Save button saves. Never add a binding to the person's `keys.json`.
