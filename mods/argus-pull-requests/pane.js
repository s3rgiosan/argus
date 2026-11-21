// Copied from lib/pane.js by scripts/sync-lib.mjs: edit lib/pane.js, then run it.
//
// Helpers that need Herdr itself: opening a mod's pane, the pane title, links,
// text inputs and file access for the Claude Code profile search.

import { home, readTextFile } from "herdr";
import { readdir, readFile } from "fs/promises";
import { discoveryIO } from "./accounts.js";

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
