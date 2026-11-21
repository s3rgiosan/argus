// Copied from lib/forge-cli.js by scripts/sync-lib.mjs: edit lib/forge-cli.js, then run it.
//
// The parts of a `gh` or `glab` read that every forge board shares: where to
// find the commands, the shared command settings, error text, list limits and
// the JSON and GraphQL reply checks. No Herdr imports, so Node can test it.

import { expandHome } from "./paths.js";

/** The shared-state key that holds the gh and glab commands of every forge mod. */
export const FORGE_KEY = "argus.forge";

/** The settings that held the gh and glab commands before FORGE_KEY. */
export const FORGE_FALLBACK_KEY = "argus-pull-requests.settings";

export const GH_MISSING = "gh not found. Install GitHub CLI, or set the gh command in Settings.";
export const GLAB_MISSING = "glab not found. Install GitLab CLI, or set the glab command in Settings.";

/** How many items every list, search and query asks for. */
export const LIST_LIMIT = 100;

/** The signed-in GitLab user's username. */
export const GL_USERNAME_QUERY = "query { currentUser { username } }";

/** The default branch of a GitLab project. Variable: `path`. */
export const GL_DEFAULT_BRANCH_QUERY = `query($path: ID!) { project(fullPath: $path) { repository { rootRef } } }`;

/**
 * True for a plain object: not null and not an array.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for an array of strings.
 * @param {unknown} value
 * @returns {value is string[]}
 */
export function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The gh and glab commands, trimmed; "" means gh or glab from PATH, else the
 * install folders. A missing or malformed FORGE_KEY value takes the commands
 * from `fallback`, the value under FORGE_FALLBACK_KEY.
 * @param {unknown} value The value under FORGE_KEY.
 * @param {unknown} [fallback]
 * @returns {{gh: string, glab: string}}
 */
export function forgeSettings(value, fallback) {
  const text = (x) => (typeof x === "string" ? x.trim() : "");
  const source = isObject(value) ? value : isObject(fallback) ? fallback : {};
  return { gh: text(source.gh), glab: text(source.glab) };
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
  const own = expandHome(String(setting ?? ""), home);
  const list = [own, name];
  if (home) list.push(`${home}/.local/bin/${name}`);
  list.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/home/linuxbrew/.linuxbrew/bin/${name}`);
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
 * True for the reply of a gh issue read for a repo that has issues turned off. Such a repo has no issues to list.
 * @param {{code: number, stderr: string}} reply
 * @returns {boolean}
 */
export function ghIssuesOff(reply) {
  return reply.code !== 0 && /^the '[^']+' repository has disabled issues$/m.test(String(reply.stderr ?? "").trim());
}

/**
 * An empty issue list for the reply of a repo that has issues turned off, else null. Pass it as
 * the `recover` option of a forge runner's `attempt`, so such a repo reads as one with no issues.
 * @param {{code: number, stderr: string}} reply
 * @returns {never[]|null}
 */
export function issuesOffList(reply) {
  return ghIssuesOff(reply) ? [] : null;
}

/**
 * Notes for CLIs that are missing. The gh note also shows when no project exists,
 * because the GitHub searches run without one.
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
 * The note for a list that reached the limit, so the reader knows more may exist; null otherwise.
 * @param {string} what What the list holds, for example "pull requests of owner/repo".
 * @param {number} count How many items came back.
 * @param {number} [limit]
 * @returns {?string}
 */
export function limitNote(what, count, limit = LIST_LIMIT) {
  return count >= limit ? `Showing the first ${limit} ${what}.` : null;
}

/**
 * The `glab api graphql` arguments for `query` on `host`.
 * @param {string} host
 * @param {string} query
 * @param {Record<string, string>} [vars]
 * @returns {string[]}
 */
export function glabArgs(host, query, vars = {}) {
  const args = ["api", "graphql", "--hostname", host, "-f", `query=${query}`];
  for (const [key, value] of Object.entries(vars)) args.push("-f", `${key}=${value}`);
  return args;
}

/**
 * The arguments that check the glab login for one host. The command exits with 0 only when
 * glab is signed in to the host. It does not print the token.
 * @param {string} host
 * @returns {string[]}
 */
export function glabAuthArgs(host) {
  return ["auth", "status", "--hostname", host];
}

/**
 * What a `glabAuthArgs` reply says. glab exits with 1 both when it has no login for the host and
 * when its API call to the host fails, so only the "has not been authenticated" text means
 * "signed-out". Any other failure is "failed": the check gave no answer.
 * @param {{code: number, stderr: string}} reply
 * @returns {"signed-in"|"signed-out"|"failed"}
 */
export function glabLoginState(reply) {
  if (reply.code === 0) return "signed-in";
  return /has not been authenticated with glab/.test(String(reply.stderr ?? "")) ? "signed-out" : "failed";
}

/**
 * The board note for a host that glab is not signed in to.
 * @param {string} host
 * @returns {string}
 */
export function glabLoginNote(host) {
  return `${host}: no glab login for this host`;
}

/**
 * The arguments that print a GitHub repo's default branch name.
 * @param {string} repo
 * @returns {string[]}
 */
export function ghDefaultBranchArgs(repo) {
  return ["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"];
}

/**
 * The error for output that a parser cannot read.
 * @param {string} cli "gh" or "glab".
 * @returns {Error}
 */
export function unexpected(cli) {
  return new Error(`unexpected ${cli} output`);
}

/**
 * Parses JSON output of `cli`; text that is not JSON throws `unexpected(cli)`.
 * @param {string} text
 * @param {string} cli
 * @returns {unknown}
 */
export function parseJson(text, cli) {
  try {
    return JSON.parse(text);
  } catch {
    throw unexpected(cli);
  }
}

/**
 * The `data` of a glab GraphQL reply. The first error the reply reports throws with its message.
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function glReply(text) {
  const raw = parseJson(text, "glab");
  if (!isObject(raw)) throw unexpected("glab");
  if (Array.isArray(raw.errors) && raw.errors.length > 0) {
    throw new Error(String(raw.errors[0]?.message ?? "unexpected glab output"));
  }
  if (!isObject(raw.data)) throw unexpected("glab");
  return raw.data;
}

/**
 * The `nodes` of a GraphQL connection; a connection without a node list throws.
 * @param {unknown} connection
 * @returns {unknown[]}
 */
export function glNodes(connection) {
  if (!isObject(connection) || !Array.isArray(connection.nodes)) throw unexpected("glab");
  return connection.nodes;
}

/**
 * An http or https URL, or null for anything else.
 * @param {unknown} value
 * @returns {string|null}
 */
export function webUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value) && !/\s/.test(value) ? value : null;
}

/**
 * `GL_USERNAME_QUERY` output.
 * @param {string} text
 * @returns {string}
 */
export function parseGlUsername(text) {
  const name = glReply(text).currentUser?.username;
  if (typeof name !== "string" || name === "") throw unexpected("glab");
  return name;
}

/**
 * `ghDefaultBranchArgs` output: the branch name.
 * @param {string} stdout
 * @returns {string|null}
 */
export function parseGhDefaultBranch(stdout) {
  const name = String(stdout ?? "").trim();
  return name === "" ? null : name;
}

/**
 * `GL_DEFAULT_BRANCH_QUERY` output: the project's root ref.
 * @param {string} text
 * @returns {string|null}
 */
export function parseGlDefaultBranch(text) {
  const name = JSON.parse(text)?.data?.project?.repository?.rootRef;
  return typeof name === "string" && name !== "" ? name : null;
}
