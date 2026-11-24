// Builds Argus's copy of Herdr's tab row. A tab led by a Claude Code agent shows the icon of the
// programs.json entry that `agents.accounts` in argus.json names for the agent's account.

import { AGENT_LIST_FILES } from "./agent-list.mjs";

/** The folder name of the copy in Herdr's mods folder. */
export const TAB_ROW = "argus-tabs";

/** The shipped mod the copy is made from. */
export const SHIPPED_TAB_ROW = "tabs";

const MARKER = "argus";

/** The files the copy needs next to its `main.js`: copy path to repo path. */
export const TAB_ROW_FILES = { ...AGENT_LIST_FILES };

const HOOKS_IMPORT = 'import { argusAccountsInit, argusProgram } from "./agent-accounts-view.js";';
const HERDR_IMPORT = /^import \{[^}]*\} from "herdr";$/;
const INIT = /^init\((?:_props, cx)?\) \{$/;
const PROGRAM = "const program = lead?.program;";
const ACCOUNT_PROGRAM = "const program = argusProgram(this, { address: lead?.terminal, program: lead?.program });";

/** Herdr's tab row no longer has the lines the account hooks need. */
export class TabRowError extends Error {
  constructor(reason) {
    super(`the tab account hooks do not apply (${reason})`);
    this.name = "TabRowError";
  }
}

/** The lines of each anchor, found by their trimmed text. Each anchor must be on exactly one line. */
const ANCHORS = {
  herdrImport: (text) => HERDR_IMPORT.test(text),
  init: (text) => INIT.test(text),
  program: (text) => text === PROGRAM,
};

/**
 * Herdr's tab row source with the account hooks: the import, `argusAccountsInit(this, cx)` at
 * the start of `init`, and the lead pane's program read through `argusProgram`. Only the icon
 * reads that program; the tab name keeps Herdr's program name. Every hook applies, or none does.
 *
 * @param {string} source The shipped `mods/tabs/main.js`.
 * @returns {string}
 * @throws {TabRowError} When an anchor is missing or is on more than one line.
 */
export function addTabAccountHooks(source) {
  const lines = source.split("\n");
  const at = {};
  for (const [name, matches] of Object.entries(ANCHORS)) {
    const found = lines.flatMap((line, i) => (matches(line.trim()) ? [i] : []));
    if (found.length !== 1) throw new TabRowError(`expected one ${name} line, found ${found.length}`);
    at[name] = found[0];
  }
  const indent = (i) => lines[i].match(/^[ \t]*/)[0];
  const body = indent(at.init) + "  ";
  const out = [];
  lines.forEach((line, i) => {
    if (i === at.init) {
      out.push(`${indent(i)}init(_props, cx) {`, `${body}argusAccountsInit(this, cx);`);
      return;
    }
    out.push(i === at.program ? `${indent(i)}${ACCOUNT_PROGRAM}` : line);
    if (i === at.herdrImport) out.push(HOOKS_IMPORT);
  });
  return out.join("\n");
}

/**
 * The copy's `mod.json`: the shipped one, renamed, with a marker that says this script owns the folder.
 *
 * @param {object} shipped The shipped `mods/tabs/mod.json`.
 * @returns {object}
 */
export function tabRowManifest(shipped) {
  const title = typeof shipped?.title === "string" && shipped.title !== "" ? shipped.title : "Tabs";
  return { ...shipped, title: `${title} (Argus)`, generated_by: MARKER };
}

/**
 * True when a mod folder holds a copy this script wrote, so it may be replaced.
 *
 * @param {object | null} manifest The folder's `mod.json`, or null when it has none.
 * @returns {boolean}
 */
export function ownsTabRow(manifest) {
  return manifest?.generated_by === MARKER;
}

/**
 * A copy of `layout` where every block that shows Herdr's tab row shows `mod`.
 *
 * @param {object} layout
 * @param {string} mod
 * @returns {object}
 */
export function useTabRow(layout, mod) {
  const out = structuredClone(layout);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.content?.mod === SHIPPED_TAB_ROW) node.content.mod = mod;
    for (const child of node.children ?? []) visit(child);
  };
  visit(out);
  return out;
}
