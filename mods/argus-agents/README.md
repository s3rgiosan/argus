# Overview

A board of the agents that need you: waiting on you, failed or finished, with folded lists of the rest. Panel on the right.

Herdr's own Agents list shows every agent with its status, pins and next agent. This board puts the agents to act on first, keeps a finished agent until you deal with it, and lets you snooze one.

- Open sections with counts: Needs you (the agent waits on you), Failed (the agent reported an error) and Finished (the agent finished its work). The header shows how many rows are in them, and how many agents are working.
- Folded lists after them, closed at first, each with a count: Working, Idle, Older and Snoozed. A click on the title opens or closes one.
- A finished agent stays under Finished after you look at it, until it works again or you snooze it. Herdr's "done" turns "idle" once you look, so Finished also counts an idle agent that was working before.
- An agent that finishes while its pane is the focused pane (you were watching it) goes to Idle, not Finished. An agent that finished while you looked elsewhere stays Finished, also after you focus it.
- A finished row older than 1 hour moves from Finished to Older. Snooze and Reopen work on it as before.
- Rows: the agent's icon, its space and its tab name (or its title, when the tab has no name), and how long it has been in that state. Pinned agents come first, then the newest change. The focused agent's row is highlighted.
- Click a row: Herdr shows the agent's pane. A failed helper without a pane opens in a peek.
- Snooze: the clock button on a row (shown on hover) opens a menu: 1 hour, 3 hours, Tomorrow morning (09:00) or Until it changes. Up and Down move, Enter picks, Esc closes. A snooze ends at its time, or sooner when the agent's state changes (for example, a waiting agent gets an answer and works again).
- Snoozed: snoozed rows go to the Snoozed list at the bottom. Each row shows when its snooze ends. The Reopen button (on hover) puts the row back in its section. Working and Idle rows have no snooze.
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
