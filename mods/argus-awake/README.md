# Argus awake

A coffee-cup button beside the Argus toolbar that keeps the display awake.

- Click: turns keep-awake on, or off when it is on.
- Right-click: keeps the display awake until no agent is working. It shows a toast when no agent is working.
- Off: plain icon. On: accent icon. Until agents finish: accent icon with a dot.

While on, the mod runs `caffeinate -di -t 120` at once and again every 60 seconds. The Mac can sleep about two minutes after Herdr quits. The mode is not saved: Herdr starts with it off. It needs `caffeinate`, which macOS includes.

`scripts/build-layout.mjs` places the button in the `argus` layout, left of the toolbar.

## Install

From the repo root:

```sh
sh scripts/install.sh argus-awake
node scripts/build-layout.mjs --switch
```
