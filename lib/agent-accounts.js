// Which Claude Code account an agent runs on, and the programs.json entry that the agents
// lists show for it.

import { expandHome } from "./paths.js";

const CONFIG_DIR = /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/;

/**
 * The Claude Code account folder of a process, from its `ps eww -o command=` line: the value of
 * `CLAUDE_CONFIG_DIR` with `~` expanded and no trailing slash, else the default `<home>/.claude`.
 * A value with a space is read up to the space, because `ps` separates the variables with spaces.
 * @param {string} psText
 * @param {string} home
 * @returns {string}
 */
export function configDirOf(psText, home) {
  const value = CONFIG_DIR.exec(String(psText ?? ""))?.[1];
  if (!value) return `${home}/.claude`;
  const folder = expandHome(value, home);
  return folder.length > 1 ? folder.replace(/\/+$/, "") : folder;
}

/**
 * The program an agents list shows: for a Claude Code agent whose account folder has an entry in
 * `agents.accounts`, the `knownAgents()` entry that the setting names, else `program` as it is.
 * @param {object|null} program the agent's program from Herdr
 * @param {string|undefined} folder the agent's account folder
 * @param {Record<string, {program: string}>} accounts from `agentAccounts`
 * @param {Array<{key: string, name: string, icon: string|null, tint: boolean, tile: string|null, color: string|null}>} known from `knownAgents()`
 * @returns {object|null}
 */
export function accountProgram(program, folder, accounts, known) {
  if (program?.key !== "claude" || folder === undefined) return program;
  const wanted = Object.hasOwn(accounts, folder) ? accounts[folder].program : null;
  const entry = wanted === null ? undefined : known.find((k) => k.key === wanted);
  if (!entry) return program;
  return { ...program, key: entry.key, name: entry.name, icon: entry.icon, tint: entry.tint, tile: entry.tile, color: entry.color };
}
