# Overview

A Herdr panel of the agents that need the person: waiting on them, failed or finished, with snooze and reopen. It reads Herdr's live agent data only and runs no programs.

## What you see

- `mod.json`: `{ "place": "none", "title": "Overview", "overlay": { "width": 360, "height": 640 }, "panel": { "label": "Overview", "icon": "icons/bot.svg" } }`. The `Argus` layout (`scripts/build-layout.mjs`) gives it a toolbar button and a panel. `mod.open` opens it as a 360 × 640 popup.
- One mod, two views picked by `props().view`: none or `"board"` (the panel), `"snooze"` (popup).
- Board, drawn with `ui.js` (a copy of `lib/ui.js`): frame; 42 px header with "Overview" (semibold), the count badge (rows in the three sections), and on the right "n working" at 11 px `dim` when an agent works; scroll area with 6 px padding.
- Sections, titled like Herdr's group headings (11.5 px, medium) in the state's color: "Needs you · n" (`blocked`), "Failed · n" (`ansi1`), "Finished · n" (`done`). Empty sections are left out. With no rows: "Nothing needs you now.", or "No agent reports a status yet." when Herdr lists no agent.
- Row (the 28 px `row` of `ui.js`, on `selected` for the focused agent): the program icon at 16 px (`svg` tinted when `program.tint`, else `image`), the space name (truncated at 120 px) and "· detail" at `dim`, or the detail alone when the space has no name, then the time in the state at 11 px `dim` ("<1m", "5m", "2h", "3d"), then a 7 px dot in the section's color. On hover the time gives way to a 26 px icon button: clock ("Snooze") or, on a snoozed row, undo-2 ("Reopen").
- Detail: the tab name when someone named the tab (a name that is not only digits), else the agent's title without its leading status glyph, else the program name.
- Snoozed shelf after the sections: `foldTitle` "Snoozed · n" (chevron left of the label, 11.5 px medium `dim`), folded when the mod starts; a click folds or unfolds it. Its rows show "Until 18:00", "Until Thu 09:00" or "Until it changes" in place of the time, and their name at `muted`.
- Snooze popup: `openOverlay({ mod: "argus-agents", props: { view: "snooze", address }, kind: "popup", width: 220, height })`, as tall as its four rows (`menuHeight`). Herdr's menu metrics (`menuRow`, 31 px rows, 5 px around): "1 hour", "3 hours", "Tomorrow morning", "Until it changes", each with its wake time at 11 px `dim` ("11:00", "Thu 09:00").
- Icons: chevron-down, chevron-right, check and clock load from Herdr's `mods/workspace-chrome/` when it has them (probed once in `init`); bot, undo-2 and the fallbacks are the Lucide copies in `icons/`.

## How it behaves

- Agent states come from `agents()` (`working`, `blocked`, `done`, `idle`) and the raw word of `terminals()` (`hc ls --json`; herdr-core's report state can be `error`).
- Category per agent (`advance` in `model.js`): raw `error` is failed; `blocked` is waiting; `working` is working; `done` is finished; `idle` is finished when the last category was working or finished, or when the terminal's `turn` (a number in `hc ls --json`, raised each time the status leaves working) went up; else idle. Working and idle agents are only counted.
- The tracker, shared key `argus-agents.track`: `{ [address]: { s, at, gen, turn } }`. `at` is when the category changed, `gen` counts changes. A raised `turn` outside working is a change too (a whole working phase came and went between looks). Entries of agents missing for more than 7 days are dropped.
- A 1 s timer (`tick`) runs `advance` on the live data and writes the tracker only when it changed; then it drops ended holds. Every open copy runs it; a copy that runs after another reads the written value and writes nothing. Render runs the same `advance` without writing, so the board shows a change before the next tick. A 30 s timer redraws the times.
- Holds, shared key `argus-agents.holds`: `{ [address]: { until, gen } }`. `until` is a time in ms, or null for "Until it changes". A hold is active while its `gen` equals the agent's `gen` and `until` is null or later than now. So a state change or the time ends it.
- Snooze: the popup's pick runs `tick` first, so the hold gets the current `gen`, then writes the hold and closes. 1 hour and 3 hours add to now; Tomorrow morning is 09:00 local time the next day. Up, Down, Enter and Escape use `lib/menu.js`.
- Reopen removes the hold.
- Row click: `pane.focus { pane }` for an agent in `agents()`. A failed terminal with no pane (a sub-agent) runs `terminal.peek { terminal }`. Such a terminal shows only while it is live, its raw word is `error`, and its parent is an agent on the board or it has a `herdr.space` label of a known space.
- Order in a section: pinned first (`terminal.pin`), then the newest `at`.

## Built from

- `main.js`: the `View`, with `menuPopup`, `foldTitle` and the rows from `ui.js`, `menuKey` and `menuHeight` from `menu.js`, and the icon loader of `icons.js` (all copies of `lib/` files); `agents`, `terminals`, `spaces`, `theme`, `shared`, `setShared`, `props`, `run`, `openOverlay`, `closeOverlay`, `checking`, `readTextFile`, `appHome` from `herdr`; `image`, `svg`, `div` from `gpui-kit`; `h_flex` from `gpui-base`.
- `model.js`: rows (`boardItems`), the tracker (`advance`, `normalizeTrack`), holds (`snoozeUntil`, `snoozeHold`, `reopenHold`, `holdActive`, `pruneHolds`, `normalizeHolds`), sections (`buildSections`) and labels (`untilLabel`, `wakeLabel`, `duration`, `cleanTitle`). Pure, tested with `node --test` (`tests/agents-model.test.js`).
- `ui.js`, `icons.js` and `menu.js` are copies of the files in `lib/`.

## Watch out

- `agents()` has no failed status. Failed depends on a program that reports `error` to herdr-core; an agent that never reports it never shows there. A terminal that exits closes its pane, so an exited agent leaves the board.
- No `setShared` in render: the tracker and the holds are written from the timer and from click handlers only.
- Do not call `setAgentOrder`: Herdr's Agents list sets the order of `agent.next`, and the last caller wins.
- The tracker is keyed by terminal address. A lost terminal that comes back with a shell keeps its address and its entry.
- `herdr-app check` renders only the empty board; the rows, the shelf and the popup need a live check.
