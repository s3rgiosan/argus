// Reads and checks the settings in `argus.json`, the file in Herdr's app folder
// that people edit by hand. No Herdr imports, so Node can test it.

import { expandHome } from "./paths.js";

/** @typedef {{key: string, instructions: string|null, promptFile: string|null}} AccountSettings */

/** The ways a button shows: icon only, label only, or both. */
export const DISPLAYS = ["icons", "labels", "both"];
/** Errors that leave the other setting valid. */
export const ORDER_ERROR = "toolbar.order is not a list";
export const DISPLAY_ERROR = 'toolbar.display is not "icons", "labels" or "both"';
/**
 * The toolbar settings in the text of `argus.json`:
 * `{ "toolbar": { "order": [ids], "display": "icons" | "labels" | "both" } }`.
 * A missing, empty or blank file, or a missing key, gives the defaults
 * (`order: null`, `display: "both"`). Text that is not JSON gives the
 * defaults and an `error`. A value of the wrong type or an unknown `display`
 * gives an `error` and the default for that setting only; the other setting
 * keeps its valid value.
 *
 * @param {string | null | undefined} text
 * @returns {{ order: string[] | null, display: "icons" | "labels" | "both", error: string | null }}
 */
export function toolbarSettings(text) {
  const result = { order: null, display: "both", error: null };
  if (text === null || text === undefined || text.trim() === "") return result;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ...result, error: error.message };
  }
  if (!isObject(data)) return { ...result, error: "the file is not an object" };
  if (!("toolbar" in data)) return result;
  const toolbar = data.toolbar;
  if (!isObject(toolbar)) return { ...result, error: "toolbar is not an object" };
  if ("order" in toolbar) {
    if (Array.isArray(toolbar.order)) result.order = toolbar.order.filter((id) => typeof id === "string" && id !== "");
    else result.error = ORDER_ERROR;
  }
  if ("display" in toolbar) {
    if (DISPLAYS.includes(toolbar.display)) result.display = toolbar.display;
    else result.error ??= DISPLAY_ERROR;
  }
  return result;
}

/**
 * The review settings from the text of `argus.json`: `pullRequests.review.instructions`, text
 * added to every review prompt, `pullRequests.review.promptFile`, a file whose text replaces
 * the built-in prompt, and `pullRequests.review.accounts`, the same two settings per Claude Code
 * account folder, and `pullRequests.review.reportFolders`, the dot folders where report files may go.
 * `accounts` is keyed by the folder with `~` expanded and has no prototype; each entry
 * keeps its key as written. A key must be non-empty and expand to an absolute folder, and no two keys
 * may expand to the same folder. A missing file or key gives none and no error.
 * @param {string|null} text
 * @param {string} [home]
 * @returns {{instructions: string|null, promptFile: string|null, accounts: Record<string, AccountSettings>, reportFolders: string[], error: string|null}}
 */
export function reviewInstructions(text, home = "") {
  const none = { instructions: null, promptFile: null, accounts: {}, reportFolders: [], error: null };
  if (text === null || text === undefined || text.trim() === "") return none;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ...none, error: `argus.json is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const review = data?.pullRequests?.review;
  // Reads one text value of an object: null when missing or empty.
  const read = (source, key, name) => {
    const value = source?.[key];
    if (value === undefined || value === null) return { value: null };
    if (typeof value !== "string") return { error: `${name} is not text` };
    const trimmed = value.trim();
    return { value: trimmed === "" ? null : trimmed };
  };
  const instructions = read(review, "instructions", "pullRequests.review.instructions");
  if (instructions.error) return { ...none, error: instructions.error };
  const promptFile = read(review, "promptFile", "pullRequests.review.promptFile");
  if (promptFile.error) return { ...none, error: promptFile.error };
  const accounts = Object.create(null);
  const raw = review?.accounts;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "object" || Array.isArray(raw)) return { ...none, error: "pullRequests.review.accounts is not an object" };
    const named = accountFolders(raw, home, "pullRequests.review.accounts");
    if (named.error) return { ...none, error: named.error };
    for (const { key, entry, folder, name } of named.list) {
      const text = read(entry, "instructions", `${name}.instructions`);
      if (text.error) return { ...none, error: text.error };
      const file = read(entry, "promptFile", `${name}.promptFile`);
      if (file.error) return { ...none, error: file.error };
      accounts[folder] = { key, instructions: text.value, promptFile: file.value };
    }
  }
  const folders = reportFolders(review?.reportFolders);
  if (folders.error) return { ...none, error: folders.error };
  return { instructions: instructions.value, promptFile: promptFile.value, accounts, reportFolders: folders.value, error: null };
}

/** Dot folders that hold what git, forges, editors and agents read or run. Compared in lowercase. */
const TOOL_FOLDERS = [".git", ".github", ".gitlab", ".claude", ".githooks", ".husky", ".vscode"];

/**
 * The dot folder names of `pullRequests.review.reportFolders`, trimmed, with no repeats, in file order.
 * Each entry is one folder name that starts with a dot and is not a folder of `TOOL_FOLDERS`.
 * @param {unknown} raw
 * @returns {{value: string[], error?: undefined} | {error: string}}
 */
function reportFolders(raw) {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: "pullRequests.review.reportFolders is not a list" };
  const value = [];
  for (const [index, entry] of raw.entries()) {
    const name = `pullRequests.review.reportFolders[${index}]`;
    if (typeof entry !== "string") return { error: `${name} is not text` };
    const folder = entry.trim();
    if (!folder.startsWith(".") || folder.includes("/") || folder === "." || folder === "..") {
      return { error: `${name} must be one folder name that starts with a dot, for example ".drafts".` };
    }
    if (TOOL_FOLDERS.includes(folder.toLowerCase())) return { error: `${name} cannot be ${JSON.stringify(folder)}: tools read or run files in it.` };
    if (!value.includes(folder)) value.push(folder);
  }
  return { value };
}

/**
 * The entries of an object keyed by Claude Code account folder, in file order, each with its
 * folder (`~` expanded) and its name for messages. A key must be non-empty, not `__proto__`,
 * absolute or `~/`, and no two keys may expand to one folder. Each entry must be an object.
 * @param {Record<string, unknown>} raw
 * @param {string} home
 * @param {string} setting the setting's path, for messages
 * @returns {{list: {key: string, entry: Record<string, unknown>, folder: string, name: string}[], error?: undefined} | {error: string}}
 */
function accountFolders(raw, home, setting) {
  /** @type {Map<string, string>} */
  const named = new Map();
  const list = [];
  for (const [key, entry] of Object.entries(raw)) {
    const name = `${setting}[${JSON.stringify(key)}]`;
    const folder = expandHome(key, home);
    if (key.trim() === "") return { error: `${setting} has an empty key.` };
    if (key === "__proto__") return { error: `${name} is not a valid key.` };
    if (!folder.startsWith("/")) return { error: `${name} must be an absolute or ~/ folder.` };
    if (named.has(folder)) return { error: `${named.get(folder)} and ${name} name the same account folder.` };
    named.set(folder, name);
    if (!isObject(entry)) return { error: `${name} is not an object` };
    list.push({ key, entry: /** @type {Record<string, unknown>} */ (entry), folder, name });
  }
  return { list };
}

/**
 * `agents.accounts` from the text of `argus.json`: a `programs.json` key per Claude Code
 * account folder, so the agents lists show that entry's icon for the account's agents. Keyed by
 * the folder with `~` expanded, with no prototype; each entry keeps its key as written. A missing
 * file or key gives none and no error.
 * @param {string|null} text
 * @param {string} [home]
 * @returns {{accounts: Record<string, {key: string, program: string}>, error: string|null}}
 */
export function agentAccounts(text, home = "") {
  const none = { accounts: Object.create(null), error: null };
  if (text === null || text === undefined || text.trim() === "") return none;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ...none, error: `argus.json is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  const raw = data?.agents?.accounts;
  if (raw === undefined || raw === null) return none;
  if (!isObject(raw)) return { ...none, error: "agents.accounts is not an object" };
  const named = accountFolders(raw, home, "agents.accounts");
  if (named.error) return { ...none, error: named.error };
  const accounts = Object.create(null);
  for (const { key, entry, folder, name } of named.list) {
    const program = entry.program;
    if (typeof program !== "string") return { ...none, error: `${name}.program is not text` };
    if (program.trim() === "") return { ...none, error: `${name}.program is empty` };
    accounts[folder] = { key, program: program.trim() };
  }
  return { accounts, error: null };
}

/**
 * The problems in the text of `argus.json`, one line each, with the same rules
 * that the mods use when they read the file. Blank text has no problems,
 * because the mods then use the defaults.
 *
 * @param {string} text
 * @param {string} home
 * @returns {string[]} Empty when the text is good.
 */
export function checkArgusFile(text, home) {
  if (text.trim() === "") return [];
  try {
    JSON.parse(text);
  } catch (error) {
    return [`argus.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`];
  }
  const errors = [toolbarSettings(text).error, reviewInstructions(text, home).error, agentAccounts(text, home).error];
  return errors.filter((error) => error !== null);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
