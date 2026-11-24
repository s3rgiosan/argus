// Builds Argus's copy of Herdr's agents list. The copy shows a Claude Code agent with the
// programs.json entry that `agents.accounts` in argus.json names for its account.

/** The folder name of the copy in Herdr's mods folder. */
export const AGENT_LIST = "argus-agent-list";

/** The shipped mod the copy is made from. */
export const SHIPPED_AGENT_LIST = "agents";

const MARKER = "argus";

/** The files the copy needs next to its `main.js`: copy path to repo path. */
export const AGENT_LIST_FILES = {
  "agent-accounts-view.js": "lib/agent-accounts-view.js",
  "agent-accounts.js": "lib/agent-accounts.js",
  "argus-file.js": "lib/argus-file.js",
  "paths.js": "lib/paths.js",
};

const HOOKS_IMPORT = 'import { argusAccountsInit, argusProgram } from "./agent-accounts-view.js";';
const HERDR_IMPORT = /^import \{[^}]*\} from "herdr";$/;
const ICON_CALL = /\bicon\((\w+)\.program, /g;

/** Herdr's agents list no longer has the lines the account hooks need. */
export class AgentListError extends Error {
  constructor(reason) {
    super(`the agent account hooks do not apply (${reason})`);
    this.name = "AgentListError";
  }
}

/**
 * The lines of each anchor, found by their trimmed text. Each anchor must be on exactly one line.
 */
const ANCHORS = {
  herdrImport: (text) => HERDR_IMPORT.test(text),
  // The init hook uses `cx`, and the icon hook relies on Herdr's own `icon` helper.
  initCx: (text) => text === "init(_props, cx) {",
  init: (text) => text === "this.folded = new Set();",
  iconHelper: (text) => text === "function icon(p, size, color) {",
};

/**
 * Herdr's agents list source with the account hooks: the import, `argusAccountsInit(this, cx)`
 * in `init`, and `argusProgram(this, x)` in place of `x.program` in each `icon(…)` call.
 * Every hook applies, or none does.
 *
 * @param {string} source The shipped `mods/agents/main.js`.
 * @returns {string}
 * @throws {AgentListError} When an anchor is missing or is on more than one line, or no icon call is found.
 */
export function addAccountHooks(source) {
  const lines = source.split("\n");
  const at = {};
  for (const [name, matches] of Object.entries(ANCHORS)) {
    const found = lines.flatMap((line, i) => (matches(line.trim()) ? [i] : []));
    if (found.length !== 1) throw new AgentListError(`expected one ${name} line, found ${found.length}`);
    at[name] = found[0];
  }
  if ([...source.matchAll(ICON_CALL)].length === 0) throw new AgentListError("no icon(<agent>.program, …) call");
  const indent = (i) => lines[i].match(/^[ \t]*/)[0];
  const out = [];
  lines.forEach((line, i) => {
    out.push(line.replace(ICON_CALL, (_match, name) => `icon(argusProgram(this, ${name}), `));
    if (i === at.herdrImport) out.push(HOOKS_IMPORT);
    if (i === at.init) out.push(`${indent(i)}argusAccountsInit(this, cx);`);
  });
  return out.join("\n");
}

/**
 * The copy's `mod.json`: the shipped one, renamed, with a marker that says this script owns the folder.
 *
 * @param {object} shipped The shipped `mods/agents/mod.json`.
 * @returns {object}
 */
export function agentListManifest(shipped) {
  const title = typeof shipped?.title === "string" && shipped.title !== "" ? shipped.title : "Agents";
  return { ...shipped, title: `${title} (Argus)`, generated_by: MARKER };
}

/**
 * True when a mod folder holds a copy this script wrote, so it may be replaced.
 *
 * @param {object | null} manifest The folder's `mod.json`, or null when it has none.
 * @returns {boolean}
 */
export function ownsAgentList(manifest) {
  return manifest?.generated_by === MARKER;
}

/**
 * A copy of `layout` where every block that shows Herdr's agents list shows `mod`.
 *
 * @param {object} layout
 * @param {string} mod
 * @returns {object}
 */
export function useAgentList(layout, mod) {
  const out = structuredClone(layout);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.content?.mod === SHIPPED_AGENT_LIST) node.content.mod = mod;
    for (const child of node.children ?? []) visit(child);
  };
  visit(out);
  return out;
}
