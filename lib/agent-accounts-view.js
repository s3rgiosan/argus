// Finds the Claude Code account of each agent for an agents list, so the list can show the
// `programs.json` entry that `agents.accounts` in argus.json names for that account.

import { terminals, exec, readTextFile, appHome, home, knownAgents, checking } from "herdr";
import { agentAccounts } from "./argus-file.js";
import { accountProgram, configDirOf } from "./agent-accounts.js";

/** How often the list looks for new agents and reads argus.json again (ms). */
const TICK = 5000;
const PS_TIMEOUT = 5000;

/**
 * Sets up the account lookup on an agents list view. Every 5 s, a timer reads argus.json and
 * runs `ps` once for each Claude Code process it has not seen. Render reads the results with
 * `argusProgram` and never runs a command.
 * @param {object} view
 * @param {object} cx
 */
export function argusAccountsInit(view, cx) {
  view.argusAccounts = Object.create(null);
  view.argusKnown = [];
  // Address to account folder, and address to the pid that folder came from.
  view.argusFolder = new Map();
  view.argusPid = new Map();
  view.argusText = null;
  view.argusBusy = false;
  if (checking()) return;
  const look = (cx) => {
    if (view.argusBusy) return;
    view.argusBusy = true;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        if (await refresh(view)) cx.notify();
      } finally {
        view.argusBusy = false;
      }
    });
  };
  look(cx);
  cx.timer.every(TICK, (cx) => look(cx));
}

/**
 * The program that an agents list shows for `agent`: its account's entry when one is mapped,
 * else Herdr's.
 * @param {object} view
 * @param {{address: string, program: object|null}} agent
 * @returns {object|null}
 */
export function argusProgram(view, agent) {
  if (!view.argusFolder) return agent.program;
  return accountProgram(agent.program, view.argusFolder.get(agent.address), view.argusAccounts, view.argusKnown);
}

/** Reads argus.json, then the account of each new Claude Code process. True when something changed. */
async function refresh(view) {
  let changed = false;
  let text = null;
  try {
    text = await readTextFile(`${appHome()}/argus.json`);
  } catch {
    text = null;
  }
  if (text !== view.argusText) {
    view.argusText = text;
    const read = agentAccounts(text, home());
    view.argusAccounts = read.error === null ? read.accounts : Object.create(null);
    try {
      view.argusKnown = await knownAgents();
    } catch {
      view.argusKnown = [];
    }
    changed = true;
  }
  const live = new Set();
  for (const terminal of terminals()) {
    const pid = terminal?.foreground?.pid;
    if (terminal?.state !== "live" || terminal.program?.key !== "claude" || !Number.isInteger(pid)) continue;
    live.add(terminal.address);
    if (view.argusPid.get(terminal.address) === pid) continue;
    let folder;
    try {
      const reply = await exec("ps", ["eww", "-o", "command=", "-p", String(pid)], { timeout: PS_TIMEOUT });
      if (reply.code !== 0) continue;
      folder = configDirOf(reply.stdout, home());
    } catch {
      continue;
    }
    view.argusPid.set(terminal.address, pid);
    if (view.argusFolder.get(terminal.address) !== folder) {
      view.argusFolder.set(terminal.address, folder);
      changed = true;
    }
  }
  for (const address of [...view.argusFolder.keys()]) {
    if (live.has(address)) continue;
    view.argusFolder.delete(address);
    view.argusPid.delete(address);
    changed = true;
  }
  return changed;
}
