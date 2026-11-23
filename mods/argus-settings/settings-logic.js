// What the Settings panel says and does around a save or a revert of
// `argus.json`. No Herdr imports, so Node can test it.

/** The text the panel shows when `argus.json` does not exist. */
export const TEMPLATE = `${JSON.stringify({ toolbar: { display: "both" } }, null, 2)}\n`;

/** The message when the file on disk is not the text the panel last read. */
export const CONFLICT = "argus.json changed on disk. Revert to load it, or copy your edits first.";

const ASKING = "Unsaved changes will be lost. Click Revert again to discard them.";
const MISSING = "argus.json does not exist yet. Save creates it.";
const UNSAVED = "Unsaved changes";

/**
 * Whether the editor text differs from the file. A file that does not exist
 * (`base` null) always has unsaved text.
 *
 * @param {string} value The editor text.
 * @param {string | null} base The file text at the last read or save, or null.
 */
export function isDirty(value, base) {
  return base === null || value !== base;
}

/**
 * What a click on Revert does: reload the file, or first ask when the editor
 * has unsaved changes. A second click while the panel asks reloads.
 *
 * @param {boolean} dirty
 * @param {boolean} asking
 * @returns {"reload" | "ask"}
 */
export function revertStep(dirty, asking) {
  return dirty && !asking ? "ask" : "reload";
}

/**
 * The message for a write that failed. When the file on disk is not the text
 * the write expected, the file changed under the panel.
 *
 * @param {string | null} expected The text the write expected on disk, null for a new file.
 * @param {string | null} onDisk The text on disk after the failure, null when the file is missing.
 * @param {string} message The reason the write gave.
 */
export function saveFailure(expected, onDisk, message) {
  if (onDisk !== expected) return CONFLICT;
  return `Could not save argus.json (${message})`;
}

/**
 * The status line under the editor: an error, else the problems that stopped
 * a save, else the ask before a revert, else the state of the text.
 *
 * @param {{ base: string | null, dirty: boolean, asking: boolean, problems: string[], saved: Date | null, error: string | null }} state
 * @returns {{ text: string, level: "dim" | "error" }}
 */
export function statusText({ base, dirty, asking, problems, saved, error }) {
  if (error !== null) return { text: error, level: "error" };
  if (problems.length > 0) return { text: problems.join("\n"), level: "error" };
  if (asking) return { text: ASKING, level: "dim" };
  if (base === null) return { text: MISSING, level: "dim" };
  if (dirty) return { text: UNSAVED, level: "dim" };
  if (saved !== null) return { text: `Saved at ${clock(saved)}`, level: "dim" };
  return { text: "", level: "dim" };
}

/** The time of `date` as HH:MM. */
function clock(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
