// Copied from lib/accounts.js by scripts/sync-lib.mjs: edit lib/accounts.js, then run it.
// Finds the Claude Code profiles on this computer. File access comes in
// through `io`, so Node can test discovery without Herdr.

/**
 * @typedef {{ folder: string, isDefault: boolean, label: string, email: string | null, accountUuid: string | null }} Profile
 * @typedef {{ home: string, listHome(): Promise<{ name: string, isDirectory: boolean }[]>, readText(path: string): Promise<string | null> }} DiscoveryIO
 */

/**
 * Expands a leading `~` and drops trailing slashes.
 *
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
export function expandHome(path, home) {
  let out = String(path ?? "").trim();
  if (out === "~") out = home;
  else if (out.startsWith("~/")) out = home + out.slice(1);
  return out.length > 1 ? out.replace(/\/+$/, "") : out;
}

/**
 * Shows a path under the home folder with `~`.
 *
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
export function tildePath(path, home) {
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

/**
 * Lists the Claude Code profile folders: the default one, every `~/.claude-*`
 * folder, then the folders added in settings. A folder is a profile when it
 * holds `.claude.json` (the default profile keeps it at `~/.claude.json`).
 *
 * @param {DiscoveryIO} io
 * @param {{ extra: string[] }} settings
 * @returns {Promise<Profile[]>}
 */
export async function discover(io, settings) {
  const { home } = io;
  const candidates = [{ folder: `${home}/.claude`, isDefault: true, labelFile: `${home}/.claude.json` }];

  const entries = (await io.listHome()) ?? [];
  entries
    .filter((entry) => entry.isDirectory && entry.name.startsWith(".claude-"))
    .map((entry) => entry.name)
    .sort()
    .forEach((name) => candidates.push(candidate(`${home}/${name}`)));

  (settings.extra ?? []).forEach((folder) => candidates.push(candidate(expandHome(folder, home))));

  const seen = new Set();
  const profiles = [];
  for (const { folder, isDefault, labelFile } of candidates) {
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);

    const text = await io.readText(labelFile);
    if (text === null || text === undefined) continue;
    profiles.push(toProfile(folder, isDefault, text, home));
  }
  return profiles;
}

/**
 * The profiles to show: hidden folders left out, then one folder per Claude
 * account (the first), so hiding a folder shows another folder of the same
 * account.
 *
 * @param {Profile[]} profiles
 * @param {string[]} hidden Folders as stored in settings.
 * @param {string} home
 * @returns {Profile[]}
 */
export function visibleProfiles(profiles, hidden, home) {
  const hide = new Set((hidden ?? []).map((folder) => expandHome(folder, home)));
  const accounts = new Set();
  return profiles.filter((profile) => {
    if (hide.has(profile.folder)) return false;
    if (!profile.accountUuid) return true;
    if (accounts.has(profile.accountUuid)) return false;
    accounts.add(profile.accountUuid);
    return true;
  });
}

function candidate(folder) {
  return { folder, isDefault: false, labelFile: `${folder}/.claude.json` };
}

function toProfile(folder, isDefault, text, home) {
  let account = null;
  try {
    account = JSON.parse(text)?.oauthAccount ?? null;
  } catch {
    account = null;
  }

  const org = nonEmpty(account?.organizationName);
  const email = nonEmpty(account?.emailAddress);
  return {
    folder,
    isDefault,
    label: org ?? email ?? tildePath(folder, home),
    email,
    accountUuid: nonEmpty(account?.accountUuid),
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Reads a text file with the first reader that returns text. A reader that
 * rejects or returns null passes the read on to the next one.
 *
 * @param {((path: string) => Promise<string | null>)[]} readers
 * @param {string} path
 * @returns {Promise<string | null>}
 */
export async function readFirst(readers, path) {
  for (const read of readers) {
    try {
      const text = await read(path);
      if (typeof text === "string") return text;
    } catch {
      // Try the next reader.
    }
  }
  return null;
}
