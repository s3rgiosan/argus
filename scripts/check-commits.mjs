#!/usr/bin/env node
// Checks commit messages against the repo rules: a Conventional Commits
// subject whose scope is a mod name or a repo folder, and no trailers or
// attribution lines.
//
//   node scripts/check-commits.mjs --file <path>   one message (the commit-msg hook)
//   node scripts/check-commits.mjs [<range>]       every commit in a range, main..HEAD when omitted

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const TYPES = ["feat", "fix", "docs", "refactor", "perf", "test", "build", "ci", "chore", "style", "revert"];
// Scopes for commits that touch no single mod.
const REPO_SCOPES = ["lib", "scripts", "tests", "skill"];
const ATTRIBUTION = [/co-authored-by:/i, /claude-session:/i, /claude\.ai\/code/i, /generated with/i];
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S/;

/** The scopes a subject can name: every mod folder, then the repo scopes. */
export function knownScopes(repo) {
  const folder = join(repo, "mods");
  const mods = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  return [...mods, ...REPO_SCOPES];
}

/**
 * The problems in one commit message, as sentences. An empty list means the
 * message follows the rules. Git's own merge, fixup and squash subjects pass.
 */
export function commitProblems(message, scopes) {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const subject = (lines[0] ?? "").trim();
  if (/^(Merge |fixup! |squash! |amend! )/.test(subject)) return [];
  const problems = [];
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?: (.+)$/.exec(subject);
  if (!match) {
    problems.push(`Subject "${subject}" is not "type(scope): text".`);
  } else {
    const [, type, scope] = match;
    if (!TYPES.includes(type)) problems.push(`Type "${type}" is not one of ${TYPES.join(", ")}.`);
    if (scope !== undefined && !scopes.includes(scope)) problems.push(`Scope "${scope}" is not a mod name or one of ${REPO_SCOPES.join(", ")}.`);
  }
  for (const line of lines) {
    if (ATTRIBUTION.some((pattern) => pattern.test(line))) problems.push(`Remove the attribution line "${line.trim()}".`);
  }
  const body = lines.slice(1).join("\n").trim();
  const last = body.split(/\n\s*\n/).pop() ?? "";
  if (last && last.split("\n").every((line) => TRAILER.test(line))) problems.push(`Remove the trailer lines "${last.split("\n")[0]}".`);
  return problems;
}

function main() {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scopes = knownScopes(repo);
  const args = process.argv.slice(2);
  const messages = [];
  if (args[0] === "--file") {
    messages.push({ name: "this commit", text: readFileSync(args[1], "utf8") });
  } else {
    const range = args[0] ?? "main..HEAD";
    // A branch can add a mod that this checkout does not have yet.
    const tip = range.includes("..") ? range.split(/\.{2,3}/).pop() || "HEAD" : range;
    const tree = spawnSync("git", ["-C", repo, "ls-tree", "-d", "--name-only", `${tip}:mods`], { encoding: "utf8" });
    if (tree.status === 0) scopes.push(...tree.stdout.split("\n").filter(Boolean));
    const out = execFileSync("git", ["-C", repo, "log", "--format=%h%x00%B%x01", range], { encoding: "utf8" });
    for (const entry of out.split("\x01")) {
      const [hash, text] = entry.replace(/^\n/, "").split("\x00");
      if (hash) messages.push({ name: hash, text });
    }
  }
  let bad = 0;
  for (const { name, text } of messages) {
    for (const problem of commitProblems(text, scopes)) {
      console.error(`check-commits: ${name}: ${problem}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
