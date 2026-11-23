# Argus settings

A panel that edits `argus.json` in Herdr's app folder with Herdr's code editor, checks the text before a save and never overwrites a change made on disk.

## What you see

A panel frame (`frame` from `ui.js`) with a 42 px `header`: the title `Settings` and, on the right, the file path with `~` (`tildePath`), 12 px, `dim`, truncated. Under it, Herdr's `Editor` fills the space: JSON highlighting with the theme's ANSI colors (as Herdr's `files` mod), line numbers, folding and soft wrap, in `settings().font_family` and `settings().font_size`. At the bottom, a `footer` with a status column (12 px, one line per row, `dim`, or `blocked` for an error or a problem), then the `Revert` button and the primary `Save` button (`button` from `ui.js`). Save shows `Saving…` and is off while a write runs or before the file is read. Before the first read, the body is `Loading argus.json…`; a read that fails shows its reason there.

## How it behaves

- Open: `init` spawns a read of `${appHome()}/argus.json` with `readTextFile`. The text, or `TEMPLATE` (`{ "toolbar": { "display": "both" } }`, 2-space JSON and a final newline) when the file is missing, goes into an `EditorState` made in that task (never in render). `base` keeps the text read, null for a missing file.
- Status (`statusText`): the ask before a revert, else an error, else the problems of the last save, else `argus.json does not exist yet. Save creates it.` (no file), else `Unsaved changes` (`isDirty`: the editor text differs from `base`), else `Saved at HH:MM`, else nothing.
- An edit (the editor's `change` event) clears the ask and the problems.
- Save: `checkArgusFile(text, home())` from `argus-file.js`. Problems stop the save. Then `writeTextFile(path, text, base)`, which refuses when the file is not `base` (null: refuses when the file exists). On success `base` is the saved text. On a refusal the panel reads the file again and `saveFailure(expected, onDisk, message)` gives `argus.json changed on disk. Revert to load it, or copy your edits first.` when the file is not the expected text, else `Could not save argus.json (<reason>)`.
- Revert (`revertStep`): with unsaved changes, the first click asks (`Unsaved changes will be lost. Click Revert again to discard them.`), the second click reads the file again into the same editor state. Without changes it reads at once.
- `close()` releases the editor state.

## Built from

- `mod.json`: `{ "place": "none", "title": "Settings", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Settings", "icon": "icons/settings.svg" } }`.
- `settings-logic.js`: `TEMPLATE`, `CONFLICT`, `isDirty`, `revertStep`, `saveFailure`, `statusText`. No Herdr imports.
- `main.js`: the view, the read and the write.
- Copies of lib files: `argus-file.js` (`checkArgusFile`), `paths.js`, `ui.js` and `menu.js`.
- `icons/settings.svg` and `icons/LICENSE-Lucide.txt`.

## Watch out

- `readTextFile` reads at most 1 MiB. When the read fails, the body shows the reason and no editor.
- The panel does not watch the file. A change on disk shows at the next save or revert.
- The panel binds no save key: the Save button saves. Never add a binding to the person's `keys.json`.
