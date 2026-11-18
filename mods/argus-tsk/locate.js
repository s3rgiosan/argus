// Where the `tsk` binary and its store live, and which tsk versions work.

/** Oldest supported tsk version. */
export const MIN_TSK = [0, 13, 0];

/**
 * Install locations to try for `tsk`, most specific first.
 * @param {string} [home] The user's home directory.
 * @returns {string[]}
 */
export function defaultCandidates(home) {
  const out = [];
  if (home) out.push(`${home}/.local/bin/tsk`);
  out.push(
    "/opt/homebrew/bin/tsk",
    "/usr/local/bin/tsk",
    "/home/linuxbrew/.linuxbrew/bin/tsk",
  );
  return out;
}

/**
 * The tsk store: `TSK_STATE_DIR` when set and non-empty, else `~/.tsk`.
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @returns {string}
 */
export function storeDir(env, home) {
  const dir = env.TSK_STATE_DIR;
  if (dir) return dir;
  return `${home}/.tsk`;
}

/**
 * Reads `tsk 0.13.0` into `[0, 13, 0]`; a prerelease suffix on the patch is ignored.
 * @param {string} text
 * @returns {number[] | null}
 */
export function parseVersion(text) {
  const trimmed = String(text).trim();
  if (!trimmed.startsWith("tsk ")) return null;
  const token = trimmed.slice(4).trim().split(/\s+/)[0] ?? "";
  const parts = token.split(".");
  if (parts.length < 3) return null;
  const major = /^\d+$/.test(parts[0]) ? Number(parts[0]) : NaN;
  const minor = /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
  const patch = /^\d+/.exec(parts[2]);
  if (Number.isNaN(major) || Number.isNaN(minor) || !patch) return null;
  return [major, minor, Number(patch[0])];
}

/**
 * True when `tsk --version` output names a version of 0.13.0 or newer.
 * @param {string} versionText
 * @returns {boolean}
 */
export function versionOk(versionText) {
  const v = parseVersion(versionText);
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== MIN_TSK[i]) return v[i] > MIN_TSK[i];
  }
  return true;
}
