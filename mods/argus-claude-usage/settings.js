// The mod's settings and the changes the settings view makes to them.
// No Herdr imports, so Node can test them. Folders are stored with `~`.

import { expandHome, tildePath } from "./accounts.js";

export const INTERVALS = [1, 5, 15];

/** @type {{ hidden: string[], extra: string[], interval: number, claude: string, names: Record<string, string> }} */
export const DEFAULTS = Object.freeze({ hidden: [], extra: [], interval: 5, claude: "", names: {} });

/**
 * Reads stored settings, keeping only values of the right type.
 *
 * @param {unknown} value
 * @returns {{ hidden: string[], extra: string[], interval: number, claude: string, names: Record<string, string> }}
 */
export function normalizeSettings(value) {
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
  return {
    hidden: strings(v.hidden),
    extra: strings(v.extra),
    interval: INTERVALS.includes(/** @type {number} */ (v.interval)) ? /** @type {number} */ (v.interval) : DEFAULTS.interval,
    claude: typeof v.claude === "string" ? v.claude : DEFAULTS.claude,
    names: namesOf(v.names),
  };
}

function namesOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, name]) => typeof name === "string" && name.trim()));
}

/**
 * Whether a profile folder is hidden.
 *
 * @param {{ hidden: string[] }} settings
 * @param {string} folder Absolute folder.
 * @param {string} home
 */
export function isHidden(settings, folder, home) {
  return settings.hidden.some((entry) => expandHome(entry, home) === folder);
}

/**
 * Hides a shown profile folder, or shows a hidden one.
 *
 * @template {{ hidden: string[] }} S
 * @param {S} settings
 * @param {string} folder Absolute folder.
 * @param {string} home
 * @returns {S}
 */
export function toggleHidden(settings, folder, home) {
  if (isHidden(settings, folder, home)) {
    return { ...settings, hidden: settings.hidden.filter((entry) => expandHome(entry, home) !== folder) };
  }
  return { ...settings, hidden: [...settings.hidden, tildePath(folder, home)] };
}

/**
 * Adds a folder to check for a profile. Empty input and folders already
 * listed leave the settings as they are.
 *
 * @template {{ extra: string[] }} S
 * @param {S} settings
 * @param {string} input Folder as typed.
 * @param {string} home
 * @returns {S}
 */
export function addExtra(settings, input, home) {
  const folder = expandHome(input, home);
  if (!folder.startsWith("/")) return settings;
  if (settings.extra.some((entry) => expandHome(entry, home) === folder)) return settings;
  return { ...settings, extra: [...settings.extra, tildePath(folder, home)] };
}

/**
 * Removes an added folder, given as stored.
 *
 * @template {{ extra: string[] }} S
 * @param {S} settings
 * @param {string} entry
 * @returns {S}
 */
export function removeExtra(settings, entry) {
  return { ...settings, extra: settings.extra.filter((x) => x !== entry) };
}

/**
 * Sets the name an account goes by; an empty name clears it.
 *
 * @template {{ names: Record<string, string> }} S
 * @param {S} settings
 * @param {string} folder Absolute folder.
 * @param {string} name
 * @param {string} home
 * @returns {S}
 */
export function setName(settings, folder, name, home) {
  const key = tildePath(folder, home);
  const names = { ...settings.names };
  delete names[folder];
  const trimmed = String(name ?? "").trim();
  if (trimmed) names[key] = trimmed;
  else delete names[key];
  return { ...settings, names };
}

/**
 * The shared values to copy from old key names to new ones: each key the
 * new name does not hold yet and the old name does.
 *
 * @param {(key: string) => unknown} read Reads a shared value.
 * @param {string} from Old key prefix, such as "claude-usage.".
 * @param {string} to New key prefix.
 * @param {string[]} names Key names after the prefix.
 * @returns {[string, unknown][]}
 */
export function pendingMoves(read, from, to, names) {
  return names
    .filter((name) => read(to + name) == null && read(from + name) != null)
    .map((name) => [to + name, read(from + name)]);
}
