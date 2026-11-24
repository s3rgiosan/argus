#!/usr/bin/env node
// Checks that the installed Herdr app is at least the version Argus needs (`herdr` in
// package.json). Exit 1 with a message when it is older. A missing `herdr-app`, or a version
// that cannot be read, gives a warning and exit 0, so the install goes on.
//
//   node scripts/herdr-version.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareVersions, plainVersion } from "./herdr-diff-lib.mjs";

/** The oldest Herdr app version Argus supports. */
export const MIN_HERDR = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).herdr;

/**
 * Why the install stops for the Herdr version in `versionText`, or null. A text with no
 * version number in it is no refusal.
 * @param {string} min
 * @param {string} versionText the output of `herdr-app --version`
 * @returns {string|null}
 */
export function herdrRefusal(min, versionText) {
  const version = plainVersion(versionText);
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  if (compareVersions(version, min) >= 0) return null;
  return `Argus needs Herdr ${min} or later; this is ${version}. Update Herdr, then run the install again.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text;
  try {
    text = execFileSync("herdr-app", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    console.error(`herdr-version: herdr-app not found; Argus needs Herdr ${MIN_HERDR} or later`);
    process.exit(0);
  }
  const refusal = herdrRefusal(MIN_HERDR, text);
  if (refusal !== null) {
    console.error(`herdr-version: ${refusal}`);
    process.exit(1);
  }
}
