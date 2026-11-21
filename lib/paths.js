// Copied from lib/paths.js by scripts/sync-lib.mjs: edit lib/paths.js, then run it.
//
// Home folder helpers for paths that people type or see. No Herdr imports, so
// Node can test them.

/**
 * Expands a leading `~` to `home`, trims spaces and drops trailing slashes.
 *
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
export function expandHome(path, home) {
  const root = String(home ?? "").replace(/\/+$/, "");
  let out = String(path ?? "").trim();
  if (out === "~") out = root;
  else if (out.startsWith("~/")) out = root + out.slice(1);
  return out.length > 1 ? out.replace(/\/+$/, "") : out;
}

/**
 * Shows a path inside `home` with `~` in place of the home folder. Without a
 * home folder the path stays as it is.
 *
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
export function tildePath(path, home) {
  const root = String(home ?? "").replace(/\/+$/, "");
  if (root === "") return path;
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}
