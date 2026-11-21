// The title an account goes by in the panel, settings and toasts. No Herdr
// imports, so Node can test it.

import { tildePath } from "./paths.js";

/**
 * The display name set in settings, else the profile's label (its
 * organization name, email or folder).
 *
 * @param {{ folder: string, label: string }} profile
 * @param {Record<string, string>} names Names by folder, stored with `~`.
 * @param {string} home
 * @returns {string}
 */
export function accountTitle(profile, names, home) {
  const set = names?.[tildePath(profile.folder, home)] ?? names?.[profile.folder];
  if (typeof set === "string" && set.trim()) return set.trim();
  return profile.label;
}
