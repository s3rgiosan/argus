import { test } from "node:test";
import assert from "node:assert/strict";
import { ghIssuesArgs, GL_ISSUES_QUERY } from "../mods/argus-pull-requests/forge.js";
import { GL_USERNAME_QUERY, glabArgs } from "../lib/forge-cli.js";
import { parseGhIssues, parseGlIssues } from "../mods/argus-pull-requests/model.js";

test("ghIssuesArgs", () => {
  assert.deepEqual(ghIssuesArgs("example-org/example-repo"), ["issue", "list", "--repo", "example-org/example-repo", "--assignee", "@me", "--state", "open", "--limit", "50", "--json", "number,title,updatedAt"]);
});

test("GitLab issue queries ask for the assigned open issues", () => {
  assert.match(GL_ISSUES_QUERY, /project\(fullPath: \$path\)/);
  assert.match(GL_ISSUES_QUERY, /issues\(state: opened, assigneeUsernames: \[\$user\], first: 50\)/);
  assert.match(GL_ISSUES_QUERY, /nodes \{ iid title updatedAt \}/);
  assert.match(GL_USERNAME_QUERY, /currentUser \{ username \}/);
  const args = glabArgs("gitlab.example.com", GL_ISSUES_QUERY, { path: "example-org/example-repo", user: "octo-user" });
  assert.deepEqual(args.slice(-4), ["-f", "path=example-org/example-repo", "-f", "user=octo-user"]);
});

test("parseGhIssues keeps valid issues, newest first", () => {
  const text = JSON.stringify([
    { number: 1, title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
    { number: 2, title: "New", updatedAt: "2026-03-01T00:00:00Z" },
    { number: "3", title: "String number", updatedAt: "2026-04-01T00:00:00Z" },
    { number: 0, title: "Zero", updatedAt: "2026-04-01T00:00:00Z" },
    { number: 4, title: "  ", updatedAt: "2026-04-01T00:00:00Z" },
    { number: 5, updatedAt: "2026-04-01T00:00:00Z" },
    null,
    { number: 6, title: "No date" },
  ]);
  assert.deepEqual(parseGhIssues(text), [
    { number: 2, title: "New", updatedAt: "2026-03-01T00:00:00Z" },
    { number: 1, title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
    { number: 6, title: "No date", updatedAt: "" },
  ]);
  assert.deepEqual(parseGhIssues("[]"), []);
  assert.throws(() => parseGhIssues("{}"));
  assert.throws(() => parseGhIssues("nope"));
});

test("parseGlIssues reads iid strings, drops invalid ones, newest first", () => {
  const nodes = [
    { iid: "7", title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
    { iid: "8", title: "New", updatedAt: "2026-05-01T00:00:00Z" },
    { iid: "x", title: "Bad iid", updatedAt: "2026-05-01T00:00:00Z" },
    { iid: "9", title: "", updatedAt: "2026-05-01T00:00:00Z" },
  ];
  const text = JSON.stringify({ data: { project: { issues: { nodes } } } });
  assert.deepEqual(parseGlIssues(text), [
    { number: 8, title: "New", updatedAt: "2026-05-01T00:00:00Z" },
    { number: 7, title: "Old", updatedAt: "2026-01-01T00:00:00Z" },
  ]);
  assert.throws(() => parseGlIssues(JSON.stringify({ data: { project: null } })), /project not found/);
  assert.throws(() => parseGlIssues(JSON.stringify({ data: { project: {} } })));
  assert.throws(() => parseGlIssues("nope"));
});

