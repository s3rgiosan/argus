// Builds Review with agent: the agents to offer, their commands, the review branch and
// worktree, the read-only prompt, the review runs on the board, and their removal.

import { tildePath, visibleProfiles } from "./accounts.js";
import { branchSlug } from "./worktree.js";

/** @typedef {import("./accounts.js").Profile} Profile */
/**
 * @typedef {{key: string, name: string, icon: string|null, tint: boolean, agent: boolean, installed: boolean, run: string[]}} KnownAgent
 * @typedef {{id: string, label: string, argv: string[], model: boolean, icon: string|null, tint: boolean}} Choice
 */

/** The agents that take `--model <name>`. Only Claude Code is checked live. */
export const MODEL_AGENTS = new Set(["claude"]);

/**
 * The agents the dialog offers: each installed agent from Herdr's `knownAgents()`,
 * with Claude Code once per shown account. An extra account starts through `env`,
 * because `exec` and `space.new` take no environment.
 * @param {KnownAgent[]} known
 * @param {Profile[]} profiles The Claude Code profiles found on this computer.
 * @param {{names: Record<string, string>, hidden: string[]}} settings The argus-claude-usage settings, read only.
 * @param {string} home
 * @returns {Choice[]}
 */
export function agentChoices(known, profiles, settings, home) {
  const choices = [];
  for (const agent of known) {
    if (!agent.agent || !agent.installed || !Array.isArray(agent.run) || agent.run.length === 0) continue;
    const base = { model: MODEL_AGENTS.has(agent.key), icon: agent.icon ?? null, tint: Boolean(agent.tint) };
    const accounts = agent.key === "claude" ? visibleProfiles(profiles, settings.hidden, home) : [];
    if (accounts.length === 0) {
      choices.push({ ...base, id: agent.key, label: agent.name, argv: [...agent.run] });
      continue;
    }
    // The default profile comes first, then the others by folder.
    const sorted = [...accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
    for (const profile of sorted) {
      const name = settings.names[tildePath(profile.folder, home)] ?? profile.label;
      const argv = profile.isDefault ? [...agent.run] : ["env", `CLAUDE_CONFIG_DIR=${profile.folder}`, ...agent.run];
      choices.push({ ...base, id: `${agent.key}:${profile.folder}`, label: `${agent.name} · ${name}`, argv });
    }
  }
  return choices;
}

/**
 * The command that starts the picked agent, with `--model` when the agent takes it and a model is given.
 * @param {Choice} choice
 * @param {string} model
 * @returns {string[]}
 */
export function agentArgv(choice, model) {
  const name = String(model ?? "").trim();
  return choice.model && name !== "" ? [...choice.argv, "--model", name] : [...choice.argv];
}

/** The most characters the title part of a review branch takes. */
const SLUG_LENGTH = 40;

/**
 * The title as lowercase ASCII words joined by `-`, at most SLUG_LENGTH characters, or "" when nothing is left.
 * @param {string} title
 * @returns {string}
 */
export function titleSlug(title) {
  const words = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return words.slice(0, SLUG_LENGTH).replace(/-+$/, "");
}

/**
 * The start that every review branch of pull request `number` has. The board links runs by it.
 * @param {number} number
 * @returns {string}
 */
export function reviewPrefix(number) {
  return `argus/review-${number}-`;
}

/**
 * The default review branch: the prefix, the title slug and `hash`, 8 hex characters the caller picks.
 * @param {{number: number, title: string}} pr
 * @param {string} hash
 * @returns {string}
 */
export function reviewBranch(pr, hash) {
  const slug = titleSlug(pr.title);
  return `${reviewPrefix(pr.number)}${slug === "" ? "" : `${slug}-`}${hash}`;
}

/**
 * The reason a review branch name is refused, or null. `git check-ref-format` checks the rest at Start.
 * @param {string} branch
 * @param {number} number
 * @returns {string|null}
 */
export function branchRefusal(branch, number) {
  const name = String(branch ?? "").trim();
  const prefix = reviewPrefix(number);
  if (!name.startsWith(prefix)) return `The branch must start with ${prefix} so the board can link it to this pull request.`;
  if (/\s/.test(name)) return "The branch cannot contain a space.";
  if (name === prefix) return `Add a name after ${prefix}.`;
  return null;
}

/**
 * The worktree of a review: a new branch from the main checkout's HEAD, in the
 * worktree folder of the repo, named after the branch.
 * @param {{localPath: string, root: string, branch: string}} input
 * @returns {{path: string, cwd: string, check: string[], add: string[]}}
 */
export function reviewPlan({ localPath, root, branch }) {
  const folder = localPath.replace(/\/+$/, "").split("/").pop();
  const path = `${root}/${folder}/${branchSlug(branch)}`;
  return {
    path,
    cwd: localPath,
    check: ["check-ref-format", "--branch", branch],
    add: ["worktree", "add", "-b", branch, path, "HEAD"],
  };
}
