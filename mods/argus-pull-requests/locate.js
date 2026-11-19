// Settings, CLI lookup candidates and user-facing CLI text for the gh and glab commands.

/** Refresh interval choices, in minutes. */
export const INTERVALS = [1, 3, 5, 10, 15];

/** Refresh interval used when the setting is unset or invalid, in minutes. */
export const DEFAULT_INTERVAL = 3;

export const GH_MISSING = "gh not found. Install GitHub CLI, or set the gh command in Settings.";
export const GLAB_MISSING = "glab not found. Install GitLab CLI, or set the glab command in Settings.";

/**
 * The mod's settings: the gh and glab commands ("" when unset) and the refresh interval.
 * @param {unknown} value
 * @returns {{gh: string, glab: string, interval: number}}
 */
export function normalizeSettings(value) {
  const v = value && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value) : {};
  const text = (x) => (typeof x === "string" ? x.trim() : "");
  const interval = INTERVALS.includes(/** @type {number} */ (v.interval))
    ? /** @type {number} */ (v.interval)
    : DEFAULT_INTERVAL;
  return { gh: text(v.gh), glab: text(v.glab), interval };
}

/**
 * Expands a leading `~` to `home`.
 * @param {string} path
 * @param {string} home
 * @returns {string}
 */
function expandHome(path, home) {
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}

/**
 * The commands to try for `gh` or `glab`, in order: the command setting, the
 * bare name on the PATH, then the install locations. Each appears once.
 * @param {string} setting
 * @param {"gh" | "glab"} name
 * @param {string} home
 * @returns {string[]}
 */
export function commandCandidates(setting, name, home) {
  const own = expandHome(String(setting ?? "").trim(), home);
  const list = [own, name];
  if (home) list.push(`${home}/.local/bin/${name}`);
  list.push(
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/home/linuxbrew/.linuxbrew/bin/${name}`,
  );
  return [...new Set(list.filter(Boolean))];
}

/**
 * First non-blank line of `text`, trimmed, or "".
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  const line = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return line ?? "";
}

/**
 * One-line error text for a failed CLI call.
 * @param {string} label
 * @param {{code: number, stdout: string, stderr: string}} reply
 * @returns {string}
 */
export function cliError(label, reply) {
  const err = firstLine(reply.stderr);
  if (err !== "") return `${label}: ${err}`;
  const out = firstLine(reply.stdout);
  if (out !== "") return `${label}: ${out}`;
  return `${label}: exited with code ${reply.code}`;
}

/**
 * Notes for CLIs that are missing. The gh note also shows when no project exists.
 * @param {{gh: boolean, glab: boolean, githubProjects: number, gitlabProjects: number}} state
 * @returns {string[]}
 */
export function missingNotes(state) {
  const notes = [];
  const noProjects = state.githubProjects === 0 && state.gitlabProjects === 0;
  if (!state.gh && (state.githubProjects > 0 || noProjects)) notes.push(GH_MISSING);
  if (!state.glab && state.gitlabProjects > 0) notes.push(GLAB_MISSING);
  return notes;
}

/**
 * The command and arguments that open `url` in the browser, or null for a non-http(s) URL.
 * @param {string} platform "linux" | "macos" | "windows"
 * @param {string} url
 * @returns {[string, string[]] | null}
 */
export function openArgs(platform, url) {
  if (!/^https?:\/\//.test(String(url))) return null;
  return [platform === "macos" ? "open" : "xdg-open", [url]];
}
