# Claude usage

Claude plan usage for every Claude Code account on this computer, one section per account.

- Session, weekly and per-model limits (for example Fable), each with time to reset and pace: how much is in reserve or in deficit, and whether it lasts until the reset.
- This week's usage by surface (Claude Code, Chats, Cowork), when the account reports it.
- Extra usage: off, or spent of the monthly limit.
- A toast when an account's session or weekly use reaches 80%, once per window.

## Accounts

The mod finds the accounts by itself: `~/.claude` and every `~/.claude-*` folder that holds a `.claude.json`. Folders signed in to the same account show once. In settings (the gear icon) you can:

- hide a folder (when another folder is signed in to the same account, that one shows instead);
- give it a display name, shown instead of the organization name from Claude;
- add a profile folder with another name or place (an absolute path, or one starting with `~`);
- set the refresh interval (1, 5 or 15 minutes);
- point to another `claude` command.

## Open it

- In the `Argus` layout: the Usage button beside the tab bar opens a panel on the right. It takes its width and drag limits from Herdr's own `panel` block in `main.json` (368 px, 280 to 900 px today).
- As a popup: `herdr-app do mod.open '{"name":"argus-claude-usage"}'`. Its pane icon opens it as a pane beside your terminals.

Usage refreshes while the mod is open. All open copies share one refresh, and at most one `claude` process runs at a time.

## How it gets the numbers

For each account, the mod runs Claude Code (`usage.sh`) and asks it for usage with the `get_usage` control request. Claude Code signs in by itself; the mod never reads a token. The default account runs with `CLAUDE_CONFIG_DIR` unset, every other account with `CLAUDE_CONFIG_DIR=<folder>`.

- `get_usage` is not a documented Claude Code API. A Claude Code update can change or remove it; the account then shows "Usage unavailable".
- An account whose sign-in no longer works shows "Open Claude with this account to sign in". Asking such an account can leave its stored tokens empty; Claude Code does that, not the mod.
- macOS or Linux (`sh`, `mkfifo`).

## Install

From the repo root:

```sh
sh scripts/install.sh argus-claude-usage
node scripts/build-layout.mjs
```
