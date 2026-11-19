# Argus awake

A button beside the Argus toolbar that keeps the display awake with `caffeinate`.

## What you see

A bar the height of the tab bar, on `chrome` with a 1 px bottom `border`, with one button right-aligned 3 px from the edge. The button: 26 px high, 8 px side padding, radius 6, a 14 px Lucide `coffee` icon. `muted` when off, `accent` when on, `accent` with a 5 px dot at its top right when waiting for agents. `hover` on hover. Tooltip: `Keep the display awake · Right-click: until agents finish`.

## How it behaves

- Modes: `off`, `on`, `agents`. Left click: `off` to `on`, any other mode to `off`.
- Right click: with an agent whose status is `working` (`agents()`), the mode becomes `agents`. Otherwise the mode stays and a toast says `No agents are working`.
- While the mode is not `off`, a 60 s timer runs `caffeinate -di -t 120` (`exec` with a 150 s timeout). The first run starts at once. At most two runs overlap, so the display stays covered between ticks.
- In `agents` mode, a tick with no working agent sets the mode to `off` and shows the toast `Agents finished · display can sleep`.
- A failed `caffeinate` is ignored; the next tick tries again.
- `close()` stops the timer. A running `caffeinate` ends within 120 s.

## Built from

- `mod.json`: `{ "place": "none", "title": "Keep awake" }`.
- `awake.js`: `MODES`, `anyWorking`, `leftClick`, `rightClick`, `tick`, `caffeinateArgs`, `TICK_MS`, `EXEC_TIMEOUT_MS`. No Herdr imports.
- `main.js`: the view, the timer and `exec`.
- `icons/coffee.svg` and `icons/LICENSE-Lucide.txt`.
- `scripts/build-layout.mjs` places block `argus-awake` (33 px wide) in row `argus-tabs-row`, between `tabs` and `argus-toolbar`.

## Watch out

- `exec` waits for `caffeinate` to end, so one run lasts 120 s. The timer starts a new run while fewer than two are running.
- Each open copy keeps its own mode and timer.
- The layout is generated: rebuild it after a Herdr update.
