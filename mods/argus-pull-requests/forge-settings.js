// Copied from lib/forge-settings.js by scripts/sync-lib.mjs: edit lib/forge-settings.js, then run it.
//
// Reads and saves the gh and glab commands that every forge mod shares, in
// Herdr's shared state.

import { shared, setShared } from "herdr";
import { FORGE_FALLBACK_KEY, FORGE_KEY, forgeSettings } from "./forge-cli.js";

/**
 * The gh and glab commands every forge mod shares, from FORGE_KEY. Until a
 * save writes that key, the commands come from FORGE_FALLBACK_KEY.
 *
 * @returns {{ gh: string, glab: string }}
 */
export function readForge() {
  return forgeSettings(shared(FORGE_KEY), shared(FORGE_FALLBACK_KEY));
}

/**
 * Saves the gh and glab commands under FORGE_KEY when they differ from the
 * ones in use.
 *
 * @param {string} gh
 * @param {string} glab
 * @returns {boolean} True when the commands changed, so the caller reads again.
 */
export function saveForge(gh, glab) {
  const current = readForge();
  const next = forgeSettings({ gh, glab });
  if (next.gh === current.gh && next.glab === current.glab) return false;
  setShared(FORGE_KEY, next);
  return true;
}
