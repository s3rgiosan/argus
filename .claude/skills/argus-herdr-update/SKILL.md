---
name: argus-herdr-update
description: Use when Herdr or herdr-core has a new version (a "Herdr X is ready" toast, an installed update, new update notes), when asked to check, review or align the Argus mods against a Herdr release, or when build-layout says that Herdr's sidebar or pane header changed.
---

# Align Argus with a Herdr update

Every Herdr release can change the mod API, the shipped mods that Argus patches (`spaces`, `pane`) and the Herdr logic that Argus copies. Review the release against Argus, record the findings, and change code only after the person picks what to build. Follow `.claude/skills/argus-mod/SKILL.md` for every code change.

## 1. Versions

- Never install a Herdr update yourself. It restarts Herdr and the person's terminals. Ask the person to install it.
- The new version: `herdr-app --version` and `hc --version`.
- The old version: the README requirement line on `main`, "Herdr desktop app X or later" (older form: "Herdr desktop app (tested on X)"). An open branch can already hold the new version there.
- herdr-core: Argus runs no `hc` command, so a core change reaches Argus only through Herdr's API. When a mod starts to run `hc`, also read `CHANGELOG.md` at the tags of `herdrdev/herdr-core`.

## 2. Sources

- Run `node scripts/herdr-diff.mjs --from <old> > <scratchpad>/herdr-diff.md` and read the file. It prints the release notes of the range, the changed shipped files, the full diff of each file that Argus follows, and whether the `argus-pane`, `argus-spaces`, `argus-agent-list` and `argus-tabs` patches (with the space group hooks, when `scripts/sidebar.mjs` has them) apply to the new shipped files and parse.
- The script checks the patches of the checkout it runs in. To check the space group hooks of an open branch, run the script in a worktree of that branch that also has `scripts/herdr-diff*.mjs`.
- The release notes are also in `~/.config/herdr-app/update-notes-cache.md`.
- The installed `AGENTS.md` and `herdr.d.ts` are the new version's.
- These do not work as sources: `herdr-app check` (its `updates()` has no notes), the What's new window (it cuts the list) and `gh release view` (the repo has tags, no releases).

## 3. Review

1. Breaks: each removed or changed signature in the `herdr.d.ts` diff, and each changed rule in the `AGENTS.md` diff. Grep `mods/`, `lib/` and `scripts/` for each one.
2. Patches: a patch line that is not "applies and parses" comes first. Fix its anchors in `scripts/sidebar.mjs`, `scripts/pane-header.mjs`, `scripts/agent-list.mjs` or `scripts/tab-row.mjs`.
3. Copied logic: for each tracked file in the diff, compare the Herdr change with the Argus code that `TRACKED` in `scripts/herdr-diff-lib.mjs` names. When Argus copies more Herdr logic, add it to `TRACKED`.
4. Core now does it: compare each "New" item in the release notes with the Argus features. Argus code that core replaces can go.
5. Improvements: each new API or command that a mod can use.
6. Version notes: `grep -rn "<old version>" .claude/skills mods/*/RECIPE.md README.md scripts/install.sh` finds notes such as "Herdr app 0.1.16 does not …". Change a note only after a live test shows the new behavior.
7. Live: run `herdr-app check ~/.config/herdr-app/mods/<mod>` for each installed `argus-*` mod, and check that `herdr-app status` shows `errors: []`.
8. Rebuild the layout (`node scripts/build-layout.mjs`). A build removes from the installed copies the work of every branch it does not include, so build from a checkout that holds all open work on `scripts/sidebar.mjs`, `scripts/pane-header.mjs`, `scripts/agent-list.mjs`, `scripts/tab-row.mjs`, `lib/space-groups*.js` and `lib/agent-accounts*.js`:
   - No open branch changes them: build from `main`.
   - One open branch changes them: build from that branch.
   - Two or more do: ask the person. Build from a throwaway worktree that merges them, or wait until they merge.

## 4. Report

Record the findings on the review task in tsk (add one with `tsk add -p argus` when none exists): `tsk edit T<n> --append-notes "…"`, then `tsk status T<n> review --done "…" --check "…"`. Use three groups:

- Checked, no action: what you verified, with its source.
- To fix: each item with its Herdr source (a changelog line or a diff hunk) and the Argus file.
- Ideas: improvements, each marked tested or not tested.

Build only the items that the person picks.

## 5. Ship the fixes

- Put the fixes in one pull request. When a pull request for this Herdr version is already open, add them to it.
- Skip each change below that the branch already has.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` → `### Changed`: "Argus needs Herdr <new version> or later."
- Change `herdr` in `package.json` and the README requirement line to the new version ("Herdr desktop app <new version> or later"; a test keeps the two equal), and the `--from` value of the `herdr-diff.mjs` line in the README to the new version. `install.sh` refuses an older Herdr from `package.json`.

## Traps

- The first `herdr-app shot` after a mod reloads can show the frame from before the reload. Wait a few seconds before you judge a shot.
- Saving a mod file reloads it in place without `init`. Code that must run in `init` needs a layout switch, which can change the space the person sees.
- A throwaway mod run with `herdr-app check` cannot write with `fs/promises`; use `writeTextFile` from `"herdr"`.
