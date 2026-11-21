// Copied from lib/pane.js by scripts/sync-lib.mjs: edit lib/pane.js, then run it.
//
// Helpers that need Herdr itself: opening a mod's pane, the pane title, links,
// text inputs and file access for the Claude Code profile search.

import { home, readTextFile, shared, setShared } from "herdr";
import { readdir, readFile } from "fs/promises";
import { discoveryIO } from "./accounts.js";
import { FORGE_FALLBACK_KEY, FORGE_KEY, forgeSettings } from "./forge-cli.js";

/**
 * File access for `discover` on this computer. `readTextFile` reads up to
 * 1 MiB and `.claude.json` can grow past that, so a larger file is read with
 * `fs/promises`.
 *
 * @returns {import("./accounts.js").DiscoveryIO}
 */
export function profileIO() {
  return discoveryIO({ home: home(), readdir, readers: [readTextFile, (path) => readFile(path, "utf8")] });
}

/**
 * Opens a web page in the browser with Herdr's `open_url`. It opens only
 * absolute http and https URLs and refuses anything else, so another link
 * opens nothing, and a failed open shows nothing.
 *
 * @param {{ open_url(url: string): void }} cx The handler's `cx`.
 * @param {string} url
 */
export function openInBrowser(cx, url) {
  try {
    cx.open_url(String(url));
  } catch {
    // A refused link opens nothing.
  }
}

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
