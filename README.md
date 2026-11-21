# Argus

Mods and tools for the [Herdr](https://herdr.dev) desktop app, built on Herdr's mod API. Named after Argus, the hundred-eyed watchman of Greek myth.

Not affiliated with Herdr or Anthropic.

## Mods

| Mod | What it does |
|---|---|
| [`argus-claude-usage`](mods/argus-claude-usage/README.md) | Claude plan usage for every Claude Code account on this computer: session, weekly and per-model limits with pace, usage by surface, extra usage, and a toast near a limit. |
| [`argus-tsk`](mods/argus-tsk/README.md) | The [tsk](https://gettsk.sh) task board: a Tasks panel with sections and a scope picker that combines a place with a thread and an assignee, quick capture, and a task pane with status, steps, block and review cards. |
| [`argus-pull-requests`](mods/argus-pull-requests/README.md) | GitHub and GitLab pull requests: a Pull requests panel with scopes, groups and a filter, and a pane with checks, reviews, merge state and conversation, where you approve, request changes, comment and merge, or start a review by a coding agent that changes no code and posts nothing. |
| [`argus-stay-awake`](mods/argus-stay-awake/README.md) | A coffee-cup button at the right end of the tab row that keeps the display awake. Right-click keeps it awake until no agent is working. |
| [`argus-toolbar`](mods/argus-toolbar/README.md) | Buttons beside Herdr's tab bar that open this repo's panel mods in a panel on the right. |

## Requirements

- Herdr desktop app (tested on 0.1.16), macOS or Linux.
- Node.js 20 or later, for the scripts and tests.
- `argus-claude-usage`: Claude Code (tested on 2.1.327), signed in with a Claude plan.
- `argus-stay-awake`: macOS only, because it runs `caffeinate`.
- `argus-tsk`: [tsk](https://gettsk.sh) 0.13.0 or later; 0.14.0 or later to show and rename project titles.
- `argus-pull-requests`: `gh`, `glab` or both, signed in (tested on `gh` 2.104.0 and `glab` 1.131.0).

## Install

```sh
git clone https://github.com/s3rgiosan/argus.git
cd argus
sh scripts/install.sh                     # copy every mod into ~/.config/herdr-app/mods
node scripts/build-layout.mjs --switch    # write the Argus layout and show it
```

`install.sh` copies each `mods/<name>` folder, without its editor files (`gpui-kit.d.ts`, `jsconfig.json`). It copies into a temporary folder beside `mods/` (`.argus-install.*` in the Herdr app folder) and then swaps it in, so a failed copy keeps the old install. It refuses to replace a folder it did not install (`--force` overrides). `sh scripts/install.sh argus-claude-usage` installs one mod.

`--link` makes a symlink to the repo folder in place of a copy. Herdr 0.1.16 does not load a symlinked mod folder, so copy is the default.

### The Argus layout

Herdr places mods only through layouts, and it replaces its own layouts on every start. `build-layout.mjs` writes a personal layout, `Argus`, from Herdr's current `main`. Every Herdr block stays, and five things change:

- a coffee-cup button at the right end of the tab bar, from `argus-stay-awake`, that keeps the display awake;
- a toolbar beside the tab bar, with one button per installed mod that declares a panel. The buttons sort A to Z by label, or in the order set in `argus.json`;
- a panel column on the right, hidden until a button opens it. It takes its width and drag limits from Herdr's own `panel` block in `main.json` (368 px, 280 to 900 px today);
- the pane headers use `argus-pane`, a copy of Herdr's `pane` header that the script writes again from Herdr's header on every run. A pull request or task pane shows the item it holds, for example "T12 · Fix the parser", in place of the mod name. Terminal panes look as before. When the copy cannot be made (Herdr's header changed, the patched copy does not parse, or its folder cannot be written), the script says so and the layout keeps Herdr's header. It never writes into an `argus-pane` folder that it did not create, and it refuses a folder that is a symbolic link;
- the sidebar uses `argus-spaces`, a copy of Herdr's `spaces` sidebar made the same way, with the same folder rules. A space row shows no repo or branch text after its name; the ahead and behind counts stay. Space colors carry over, because Herdr keeps them in shared state.

`build-layout.mjs` writes its files atomically. It needs `argus-toolbar` installed first and stops with "install the toolbar first: sh scripts/install.sh argus-toolbar" when it is not. `--name <Name>` writes the layout under another name (letters, digits, `_` and `-` only; `main`, `terminals` and `win98` are refused), and the script does not overwrite a file of that name that it did not write.

The layout shows in Herdr's Settings under Look with a preview picture (`layouts/Argus.svg`). A layout written by an earlier version as `argus.json` is renamed to `Argus.json`, and the shown layout switches to it.

Theme picks are kept per layout, so pick your theme once in `Argus`.

## Settings file

Argus reads `~/.config/herdr-app/argus.json`. The install script does not create it. Without it, every setting has its default: the toolbar buttons sort A to Z by label and show an icon and a label.

```json
{ "toolbar": { "order": ["argus-tsk", "argus-claude-usage"], "display": "icons" } }
```

- `toolbar.order`: the panel mod names in the order their toolbar buttons show. A button not in the list follows, sorted A to Z by label. A name that matches no button is ignored. The toolbar follows the file as you save it.
- `toolbar.display`: how the toolbar buttons show. `"icons"` shows the icon only, with the label as a tooltip. `"labels"` shows the label only. `"both"` shows the icon and the label. The default is `"both"`. A button without an icon shows its label in every mode. The toolbar block resizes to fit the buttons when the value changes.

For `pullRequests.review`, see [`mods/argus-pull-requests/README.md`](mods/argus-pull-requests/README.md).

When the file is not valid JSON, a toast says so and the defaults show. A value of the wrong type or an unknown `display` shows the same toast and the default for that setting only; the other setting keeps its valid value.

## Update

```sh
git pull
sh scripts/install.sh
node scripts/build-layout.mjs
```

Run `build-layout.mjs` again after a Herdr update too: it rebuilds from Herdr's new `main`, so Herdr's changes reach the layout. Do not edit `Argus.json` by hand; the next build replaces it. The script never overwrites a layout it did not write, and it writes nothing if Herdr's `main` no longer has the blocks it attaches to.

## Uninstall

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/Argus.json ~/.config/herdr-app/layouts/Argus.svg
rm -r ~/.config/herdr-app/mods/argus-pane ~/.config/herdr-app/mods/argus-spaces ~/.config/herdr-app/mods/argus-stay-awake ~/.config/herdr-app/mods/argus-claude-usage ~/.config/herdr-app/mods/argus-toolbar ~/.config/herdr-app/mods/argus-tsk ~/.config/herdr-app/mods/argus-pull-requests
```

## Development

```sh
npm test                               # pure modules and shell scripts, with node --test
herdr-app check mods/argus-tsk         # load and render a mod once
node scripts/sync-lib.mjs              # after editing a lib/*.js file: copy each into the mods that import it
node scripts/sync-lib.mjs --check      # exit 1 when a copy differs or a copy is not imported
```

- Each mod lives in `mods/<name>/` with a `README.md` for people and a `RECIPE.md` for an agent rebuilding it.
- `lib/` holds code shared by mods: `ui.js` (frame, headers, count badge, rows, menu rows, fields, multi-line text boxes, buttons, switch, segmented control and meters in the sizes of Herdr's own panels), `icons.js` (load Herdr's icon files with a fallback to a mod's own copy), `menu.js` (Up, Down, Enter and Escape in a menu), `pool.js` (run async work with a cap on how many run at once), `follow.js` (match the focused space to a project folder, and `compareNames`, a case-insensitive name order), `gate.js` (one run at a time, with one queued), `sync.js` (which open copy runs a shared read) and `order.js` (sort the toolbar buttons) and `accounts.js` (find the Claude Code account folders). `argus-claude-usage`, `argus-pull-requests` and `argus-tsk` import `ui.js`, `icons.js`, `gate.js` and `sync.js`; `argus-claude-usage` and `argus-pull-requests` also import `accounts.js`; `argus-pull-requests` and `argus-tsk` also import `menu.js` and `follow.js`, `argus-pull-requests` imports `pool.js`, and `argus-claude-usage` imports `follow.js` for `compareNames`; `argus-toolbar` imports `order.js`; `argus-stay-awake` imports none. Herdr loads a mod's files from its own folder only, so each mod carries a copy of the lib files it imports; a test fails when a copy differs. `sync-lib.mjs` also reports a copy that no module of the mod imports: `--check` fails on it, and the copy mode prints a warning.
- A mod gets a toolbar button by declaring `"panel": { "label": "Usage", "icon": "icons/chart-line.svg" }` in its `mod.json`.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `mods/argus-claude-usage/icons/LICENSE-Lucide.txt`).
- The `get_usage` approach in `argus-claude-usage` follows [VladTemp27/herdr-mods](https://github.com/VladTemp27/herdr-mods) `usage-limits`, which credits [jmalicki/herdr-mod-ai-usage](https://github.com/jmalicki/herdr-mod-ai-usage). No code is copied.

## License

[MIT](LICENSE)
