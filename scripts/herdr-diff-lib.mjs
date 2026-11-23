// The pure parts of herdr-diff.mjs: version order, the changelog sections of a
// version range, and the Argus code that follows each Herdr file.

/**
 * The Herdr files that Argus follows, with the Argus code to check when one changes.
 * `herdr` is a path in the herdrdev/herdr-app repo.
 */
export const TRACKED = [
  { herdr: "defaults/herdr.d.ts", argus: "mods/, lib/", why: "The mod API. A removed or changed signature breaks a mod; a new one can improve one." },
  { herdr: "defaults/AGENTS.md", argus: "mods/, lib/, .claude/skills/argus-mod/SKILL.md", why: "The mod rules and limits, and the version notes in SKILL.md." },
  { herdr: "docs/commands.md", argus: "mods/, lib/", why: "The commands that mods run with run()." },
  { herdr: "defaults/mods/spaces/main.js", argus: "scripts/sidebar.mjs", why: "argus-spaces is a patched copy; the hooks must still find their anchors." },
  { herdr: "defaults/mods/pane/main.js", argus: "scripts/pane-header.mjs", why: "argus-pane is a patched copy; the name line and element must still match." },
  { herdr: "defaults/mods/agents/main.js", argus: "mods/argus-agents/model.js", why: "cleanTitle follows the title rule (clean) of Herdr's agents list." },
];

/**
 * A version without a leading "v", a program name or spaces: "herdr-app 0.1.17" gives "0.1.17".
 *
 * @param {string} text
 * @returns {string}
 */
export function plainVersion(text) {
  const found = String(text).trim().match(/v?(\d+(?:\.\d+)*)$/);
  return found ? found[1] : String(text).trim();
}

/**
 * Below 0 when `a` is older than `b`, 0 when equal, above 0 when newer.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const left = plainVersion(a).split(".").map(Number);
  const right = plainVersion(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The sections of a Keep a Changelog file for the versions after `from`, up to and with `to`, newest first.
 *
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {{ version: string, text: string }[]}
 */
export function changelogSections(text, from, to) {
  const heading = /^## \[([^\]]+)\][^\n]*$/gm;
  const starts = [...text.matchAll(heading)].map((m) => ({ version: m[1], at: m.index }));
  return starts
    .map((start, i) => ({ version: start.version, text: text.slice(start.at, starts[i + 1]?.at ?? text.length).trimEnd() }))
    .filter((section) => compareVersions(section.version, from) > 0 && compareVersions(section.version, to) <= 0);
}

/**
 * The tracked Herdr files among `changed`, in `TRACKED` order.
 *
 * @param {string[]} changed Paths from `git diff --name-only`.
 * @returns {typeof TRACKED}
 */
export function trackedChanges(changed) {
  const set = new Set(changed);
  return TRACKED.filter((entry) => set.has(entry.herdr));
}
