# Argus stay awake

A button at the right of the tab row that keeps the display awake with `caffeinate`.

## What you see

A bar the height of the tab bar, on `chrome` with a 1 px bottom `border`, with one button right-aligned 10 px from the edge. The button is Herdr's square icon button: 26 px square, radius 6, a 14 px Lucide `coffee` icon (`iconFor` in `stay-awake.js`), `muted` with `hover` background and `foreground` icon on hover. When on, the icon is `coffee-full.svg` (the `coffee` outline with the cup filled from y 11 down), and the button shows like Herdr's open Files and Changes buttons: `selected` background and `foreground` icon; waiting for agents adds a 5 px `accent` dot at its top right. Tooltip: `Keep the display awake · Right-click: until agents finish`.

## How it behaves

- Modes: `off`, `on`, `agents`. Left click (`on_click`, with a left mouse-down stop like Herdr's buttons): `off` to `on`, any other mode to `off`.
- Right click: with an agent whose status is `working` (`agents()`), the mode becomes `agents`. Otherwise the mode stays and a toast says `No agents are working`.
- While the mode is not `off`, a 60 s timer runs `caffeinate -di -t 120` (`exec` with a 150 s timeout). The first run starts at once. Up to three runs overlap, so the display stays covered between ticks.
- In `agents` mode, a tick with no working agent sets the mode to `off` and shows the toast `Agents finished · display can sleep`.
- When `caffeinate` cannot start, one toast `Keep awake needs caffeinate (macOS)` shows for each time the mode turns on. The mode stays as chosen and the next tick tries again.
- `close()` stops the timer. A running `caffeinate` ends within 120 s.

## Built from

- `mod.json`: `{ "place": "none", "title": "Stay awake" }`.
- Mouse: the left button toggles on mouse up; the right button stops propagation and picks agents mode.
- `stay-awake.js`: `MODES`, `anyWorking`, `leftClick`, `rightClick`, `tick`, `caffeinateArgs`, `shouldRun`, `MAX_RUNS`, `TICK_MS`, `EXEC_TIMEOUT_MS`. No Herdr imports.
- `main.js`: the view, the timer and `exec`.
- `icons/coffee.svg`, `icons/coffee-full.svg` (made from `coffee.svg`) and `icons/LICENSE-Lucide.txt`.
- `scripts/build-layout.mjs` places block `argus-stay-awake` (36 px wide: the 26 px button and 10 px of padding) in row `argus-tabs-row`, right of `argus-toolbar`, the last child.

## Watch out

- `exec` waits for `caffeinate` to end, so one run lasts 120 s. The timer starts a new run while fewer than three are running.
- Each open copy keeps its own mode and timer.
- The layout is generated: rebuild it after a Herdr update.
