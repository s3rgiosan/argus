// Tells a real store change from the folder events a read causes. Every
// `tsk` run changes the store's file metadata (its ctime), so the folder
// watch reports a change after each read. The board re-reads only when the
// data file's modification time or size moved.

/** The file tsk keeps the board in, inside the store folder. */
export const DATA_FILE = "tsk.json";

// BSD stat (macOS) first, then GNU stat (Linux). Both print
// "<mtime with fractions> <size>".
const STAMP_SCRIPT = 'stat -f "%Fm %z" "$1" 2>/dev/null || stat -c "%.9Y %s" "$1" 2>/dev/null';

/**
 * The command and arguments that print the data file's stamp. The path is
 * passed as `$1`, so it is never read as shell code.
 * @param {string} dir the store folder
 * @returns {[string, string[]]}
 */
export function stampArgs(dir) {
  return ["/bin/sh", ["-c", STAMP_SCRIPT, "sh", `${dir}/${DATA_FILE}`]];
}

/**
 * The stamp in a stat run's output, or null when the run failed or printed nothing.
 * @param {{ code: number, stdout: string } | null} result
 * @returns {string | null}
 */
export function parseStamp(result) {
  if (!result || result.code !== 0) return null;
  const first = String(result.stdout ?? "").split("\n")[0].trim();
  return first === "" ? null : first;
}

/**
 * Whether the store changed between two stamps. An unknown stamp counts as
 * a change, so a failed stat still leads to a read.
 * @param {string | null} previous
 * @param {string | null} next
 */
export function storeChanged(previous, next) {
  return previous === null || next === null || previous !== next;
}
