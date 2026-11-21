# Overview

A board of the agents that need you: waiting on you, failed or finished. Panel on the right.

Herdr's own Agents list shows every agent with its status, pins and next agent. This board shows only the agents to act on, keeps a finished agent until you deal with it, and lets you snooze one.

- Three sections with counts: Needs you (the agent waits on you), Failed (the agent reported an error) and Finished (the agent finished its work). The header shows how many rows there are, and how many agents are working.
- A finished agent stays under Finished after you look at it, until it works again or you snooze it. Herdr's "done" turns "idle" once you look, so Finished also counts an idle agent that was working before.
- Rows: the agent's icon, its space and its tab name (or its title, when the tab has no name), and how long it has been in that state. Pinned agents come first, then the newest change. The focused agent's row is highlighted.
- Click a row: Herdr shows the agent's pane. A failed helper without a pane opens in a peek.
- Snooze: the clock button on a row (shown on hover) opens a menu: 1 hour, 3 hours, Tomorrow morning (09:00) or Until it changes. Up and Down move, Enter picks, Esc closes. A snooze ends at its time, or sooner when the agent's state changes (for example, a waiting agent gets an answer and works again).
- Snoozed: snoozed rows go to a Snoozed shelf at the bottom, folded at first. Each row shows when its snooze ends. The Reopen button (on hover) puts the row back in its section.
- Live: the board looks at Herdr's agents every second. Snoozes and the remembered states are kept in Herdr's shared state, so they survive a restart and every open copy shows the same.

Failed shows only agents whose program reports an error status to Herdr. An agent that exits does not show, because Herdr closes its pane.

## Open it

In the `Argus` layout: the Overview button beside the tab bar.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC, `icons/LICENSE-Lucide.txt`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-agents
node scripts/build-layout.mjs
```
