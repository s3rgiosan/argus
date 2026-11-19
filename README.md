# Argus

Mods and tools for the [Herdr](https://herdr.dev) desktop app, built on Herdr's mod API. Named after Argus, the hundred-eyed watchman of Greek myth.

Not affiliated with Herdr or Anthropic.

## Mods

| Mod | What it does |
|---|---|
| [`argus-claude-usage`](mods/argus-claude-usage/README.md) | Claude plan usage for every Claude Code account on this computer: session, weekly and per-model limits with pace, usage by surface, extra usage, and a toast near a limit. |
| [`argus-tsk`](mods/argus-tsk/README.md) | The [tsk](https://gettsk.sh) task board: a Tasks panel with sections and a scope picker, quick capture, and a task pane with status, steps, block and review cards. |
| [`argus-awake`](mods/argus-awake/README.md) | A coffee-cup button beside the toolbar that keeps the display awake. Right-click keeps it awake until no agent is working. |
| [`argus-toolbar`](mods/argus-toolbar/README.md) | Buttons beside Herdr's tab bar that open this repo's panel mods in a panel on the right. |

## Requirements

- Herdr desktop app (tested on 0.1.16), macOS or Linux.
- Node.js 20 or later, for the scripts and tests.
- `argus-claude-usage`: Claude Code (tested on 2.1.327), signed in with a Claude plan.
- `argus-tsk`: [tsk](https://gettsk.sh) 0.13.0 or later; 0.14.0 or later to show and rename project titles.

## Install

```sh
git clone https://github.com/s3rgiosan/argus.git
cd argus
sh scripts/install.sh                     # copy every mod into ~/.config/herdr-app/mods
node scripts/build-layout.mjs --switch    # write the argus layout and show it
```

`install.sh` copies each `mods/<name>` folder, without its editor files (`gpui-kit.d.ts`, `jsconfig.json`); Herdr 0.1.16 does not load a symlinked mod folder. It refuses to replace a folder it did not install (`--force` overrides). `sh scripts/install.sh argus-claude-usage` installs one mod.

### The argus layout

Herdr places mods only through layouts, and it replaces its own layouts on every start. `build-layout.mjs` writes a personal layout, `argus`, from Herdr's current `main`. Every Herdr block stays, and three things are added:

- a coffee-cup button beside the tab bar, from `argus-awake`, that keeps the display awake;
- a toolbar beside the tab bar, with one button per installed mod that declares a panel;
- a panel column on the right, hidden until a button opens it. It opens 440 px wide, and you can drag it between 280 and 900 px.

Theme picks are kept per layout, so pick your theme once in `argus`.

## Update

```sh
git pull
sh scripts/install.sh
node scripts/build-layout.mjs
```

Run `build-layout.mjs` again after a Herdr update too: it rebuilds from Herdr's new `main`, so Herdr's changes reach the layout. Do not edit `argus.json` by hand; the next build replaces it. The script never overwrites a layout it did not write, and it writes nothing if Herdr's `main` no longer has the blocks it attaches to.

## Uninstall

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/argus.json
rm -r ~/.config/herdr-app/mods/argus-awake ~/.config/herdr-app/mods/argus-claude-usage ~/.config/herdr-app/mods/argus-toolbar ~/.config/herdr-app/mods/argus-tsk
```

## Development

```sh
npm test                               # pure modules and shell scripts, with node --test
herdr-app check mods/argus-tsk         # load and render a mod once
node scripts/sync-lib.mjs              # after editing a lib/*.js file: copy each into the mods that import it
node scripts/sync-lib.mjs --check      # exit 1 when a copy differs
```

- Each mod lives in `mods/<name>/` with a `README.md` for people and a `RECIPE.md` for an agent rebuilding it.
- `lib/` holds code shared by mods: `ui.js` (frame, header, rows, fields, buttons, meters in the sizes of Herdr's own panels), `gate.js` (one run at a time, with one queued) and `sync.js` (which open copy runs a shared read). `argus-claude-usage` and `argus-tsk` import them; `argus-toolbar` and `argus-awake` import none. Herdr loads a mod's files from its own folder only, so each mod carries a copy of the lib files it imports; a test fails when a copy differs.
- A mod gets a toolbar button by declaring `"panel": { "label": "Usage", "icon": "icons/chart-line.svg" }` in its `mod.json`.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `mods/argus-claude-usage/icons/LICENSE-Lucide.txt`).
- The `get_usage` approach in `argus-claude-usage` follows [VladTemp27/herdr-mods](https://github.com/VladTemp27/herdr-mods) `usage-limits`, which credits [jmalicki/herdr-mod-ai-usage](https://github.com/jmalicki/herdr-mod-ai-usage). No code is copied.

## License

[MIT](LICENSE)
