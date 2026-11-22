# Argus stay awake

A coffee-cup button at the right of the tab row that keeps the display awake.

- Click: turns keep-awake on, or off when it is on.
- Right-click: keeps the display awake until no agent is working. It shows a toast when no agent is working.
- Off: an empty cup. On: a full cup, highlighted like Herdr's open Files and Changes buttons. Until agents finish: highlighted with an accent dot.

While on, the mod runs `caffeinate -di -t 120` at once and again every 60 seconds. The Mac can sleep about two minutes after Herdr quits. In the agents mode, the display can stay awake for up to about 2 minutes after the last agent finishes: the tick that finds no working agent starts no new run, and the last run started at the tick before lasts 120 seconds. Turning keep-awake off leaves the last run for up to 120 seconds. When `caffeinate` cannot start, a toast says so. The mode is not saved: Herdr starts with it off. It needs `caffeinate`, which macOS includes.

`scripts/build-layout.mjs` places the button in the `Argus` layout, right of the toolbar.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-stay-awake
node scripts/build-layout.mjs --switch
```
