---
name: argus-mod
description: Use when creating, changing, reviewing or debugging an Argus mod for the Herdr desktop app (anything under mods/, lib/ or scripts/ in this repo), so the mod follows Herdr's API rules, matches Herdr's UI, and fits Argus conventions.
---

# Argus mods for Herdr

Argus is a set of mods for the Herdr desktop app. Every mod must work like part of Herdr: same API rules, same look, and no breakage when Herdr updates. Read this before you touch `mods/`, `lib/` or `scripts/`.

## Sources of truth

- Herdr's mod docs: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, and `gpui-kit.d.ts`. The last one is very large, so search it with grep and do not read it whole.
- Herdr's own mods in `~/.config/herdr-app/mods/` are the reference for look and behavior. Before you draw a control, find how Herdr draws the same control (for example `changes`, `files`, `agents`, `spaces`, `tabs`, `menu`, `frame/settings`) and copy its values.
- `herdr-app commands` lists every command a mod can run.
- Check every API, value and command against these sources. Do not rely on memory.

## Herdr API rules

- Never start work from `render`: no `exec`, timers, watches, `setShared`, or `InputState`/`TextareaState`. Create input states only in `init`, event handlers, timers or spawned tasks.
- In Herdr app 0.1.16, `cx.spawn` ran its body at once. Start every spawned body with `await cx.sleep(0)`.
- Never keep a `cx` for later. Use the `cx` that each handler or timer receives.
- Read props with `props()` from `"herdr"`.
- Take every color from `theme()`. Never write a literal color.
- `setShared` re-renders every mod. Write a shared key once per change, not in a loop.
- `exec(command, args, { cwd, timeout })` has no stdin and no env option. To set an environment variable, put `env NAME=value` in argv. The timeout cap is 600,000 ms, and the output cap is 8 MiB.
- `close(cx)` gets at most 250 ms. An `exec` that already started keeps running after close.
- Guard side effects with `checking()`, because `herdr-app check` runs the mod.
- `herdr-app check <mod dir>` renders only the first state. It does not test clicks, popups or later states.
- Herdr app 0.1.16 does not load a symlinked mod folder. `scripts/install.sh` copies the files.
- Herdr replaces its shipped layouts on start and does not let mods edit them. Never edit Herdr's shipped mods or layouts. Argus builds its own layout with `node scripts/build-layout.mjs`; rebuild it after a Herdr update. A copy of a shipped mod is allowed only when that script writes it again from the shipped files on every run, as `scripts/pane-header.mjs` and `scripts/sidebar.mjs` do for `argus-pane` and `argus-spaces`, and the script keeps the shipped mod when its patch no longer applies.
- `readTextFile` reads at most 1 MiB and gives null when the file is missing.
- Keep data for one copy in the instance and data for all copies in shared state, because a mod can have several copies open.
- A mod imports only files in its own folder. This is why `lib/` is copied into each mod.
- In Herdr app 0.1.16, `localeCompare` sorted names case-sensitively. Sort names with `compareNames` from `lib/follow.js`.
- Esc closes the top popup without a call from the mod.

## Match Herdr's UI

- Use the building blocks that `lib/ui.js` exports, because they copy Herdr's values. Read the file for the current list. It has settings fields (`commandField`, `forgeCommandFields`, `intervalPicker`), popup menus (`menuPopup` with `menuHeight` from `lib/menu.js`), board rows (`twoLineRow`) and pane parts (`paneHead`, `foldTitle`, `markdown`). Do not draw a second version of a control that `lib/ui.js` already has.
- `lib/pane.js` opens a mod's pane (`openModPane`), shares its title (`shareTitle`), opens links with `cx.open_url` (`openInBrowser`) and makes text inputs that track focus (`createInputs`).
- When Herdr has a control that `lib/ui.js` does not have, copy Herdr's values from its mod into a new block in `lib/ui.js`. Name the Herdr file and line in your report, not in the code comment.
- Section titles use sentence case, for example "Ready to merge".
- Popup menus use `menuRow` and the keys in `lib/menu.js` (↑ and ↓ move, Enter picks).
- Icons: use Herdr's own icon file when Herdr ships one, through `lib/icons.js` (`resolveIcon` / `iconResolver`). This keeps the icon in step with Herdr and falls back to the mod's own copy when Herdr's file is missing. Decide the path in `init`, never in `render`. For icons that Herdr does not ship, add the Lucide SVG to the mod's `icons/` folder with `LICENSE-Lucide.txt`.
- A refresh spins the refresh icon (`.spin(900)`) with no text. An action the person started (Working…, Checking out…, Starting…) may show a short text state.
- On a button, stop the left mouse-down (`on_mouse_down("left", (_e, cx) => cx.stop_propagation())`) and act on click. Handle a right-click with `on_mouse_down("right")` and `stop_propagation`. Give an icon-only button a tooltip.
- Layout blocks in the tab row carry `window_drag: true`, like Herdr's own tab bar block.
- Sizes that Herdr's layout defines are read from the live layout. For example, the Argus panel copies `size`, `min` and `max` from Herdr's `panel` block in `main.json`.
- Panel buttons in the Argus toolbar come from `mod.json` `"panel": { "label", "icon" }`. The toolbar measures its own width.

## Argus conventions

- Before you write a helper, a parser, a CLI call or a control, look in `lib/`. Use the `lib/` module when it does the job. Extend it when it almost does. When a second mod needs code that one mod has, move that code to `lib/` and import it from both. Never copy a file or a function from one mod into another.
- Shared code lives in `lib/`. `node scripts/sync-lib.mjs` copies each `lib/` file into the mods that import it, and the lib files that those files import. Run `node scripts/sync-lib.mjs --check` before every commit. Edit the `lib/` file, never the copy in a mod.
- A forge board (GitHub and GitLab) builds on `lib/forge-cli.js`, `lib/forge-settings.js`, `lib/forge-runner.js`, `lib/forge-board.js`, `lib/board-sync.js` and `lib/remote.js`. Worktrees come from `lib/worktree.js` and `lib/worktree-runner.js`.
- Run each shared CLI read through `lib/gate.js` and `lib/sync.js`, so several copies run one read.
- Do not commit `gpui-kit.d.ts` or `jsconfig.json` in a mod folder.
- Put logic in pure modules without Herdr imports, and test them with `node --test` (`npm test`). Write the test first and watch it fail.
- Each mod has `README.md` (for people) and `RECIPE.md` (for an agent that rebuilds the mod). `RECIPE.md` has these sections in this order: `# Name`, one paragraph, `## What you see`, `## How it behaves`, `## Built from`, `## Watch out`.
- `argus.json` in Herdr's app folder (`appHome()`) holds settings that people edit by hand. Today it holds `toolbar.order`, `toolbar.display`, and `pullRequests.review.instructions`, `pullRequests.review.promptFile` and `pullRequests.review.accounts`. Read the file with `readTextFile` and watch the folder with `watchFolder`. When the file is missing, use the defaults. When the file is not valid, show one toast and use the defaults.
- A mod's own Settings view stores its values in one shared-state key named `<mod name>.settings`, for example `argus-tsk.settings`, `argus-claude-usage.settings` and `argus-pull-requests.settings`. The value is a small object that the mod normalizes when it reads it.
- Shared-state keys start with the mod name, for example `argus-tsk.board`. Settings and keys that several mods share start with `argus.`, for example `argus.forge` (the `gh` and `glab` commands of every forge mod, through `lib/forge-settings.js`).
- A mod that starts or reads Claude Code must support several Claude Code accounts. Find the profile folders (`~/.claude` and every `~/.claude-*`) and start each account with `env CLAUDE_CONFIG_DIR=<folder>` (no variable for the default `~/.claude`). Use the display names from `argus-claude-usage` when that mod is installed.
- Do not include defaults that belong to one stack, company or skill. The mods are for anyone.

## Public repo safety

- This repo is public. Tests, fixtures, docs and commits use made-up data only: `example-org/example-repo`, `octo-user`, `Example title`, `/home/test/...`.
- Never copy real names, emails, repo names, PR or task titles, tokens or home-folder paths into a file. Live checks may read real data. Reports give counts and shapes, not the data.
- Mods never store or read tokens. Forge access goes through `gh` and `glab`.

## Live checks

- Install, then rebuild the layout when panels or the tab row change. Look at the result with `herdr-app shot <path>` and crop it with `sips`.
- Tests and live checks for `argus-tsk` use a throwaway `--state-dir` and never write to the real store.
- To test a click or a popup, add a temporary driver to the installed copy (for example `cx.timer.after(3000, ...)` in `init`). Reinstall the clean build afterwards.
- End every live check with `herdr-app status` showing `errors: []` and `overlays: []`. Remove anything the test made, such as worktrees, branches, spaces, test files or `caffeinate` runs.
- Never edit the person's `keys.json` or `settings.json`. Change `argus.json` only when the person asks for it.

## Commits and releases

- Conventional Commits with the mod name as the scope, for example `fix(argus-tsk): …`. Add no trailers and no attribution lines.
- The scope is a mod name, or `lib`, `scripts`, `tests` or `skill` for a change outside one mod. A commit that changes no single area has no scope, for example `docs: …`.
- Turn on the commit check once per clone with `git config core.hooksPath .githooks`. Worktrees share it. Before you hand off a branch, run `node scripts/check-commits.mjs`, which checks `main..HEAD`.
- A brief for another agent links this file for the commit rules. It does not restate them.
- `CHANGELOG.md` follows Keep a Changelog 1.1.0, with full-sentence entries under `## [Unreleased]`.
- Tags are plain semver without `v`, for example `1.3.1`. A release bumps `package.json`, dates the CHANGELOG section and adds its compare link.
- Never commit `docs/` or `.superpowers/`.
