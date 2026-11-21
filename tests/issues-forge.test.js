import test from "node:test";
import assert from "node:assert/strict";
import { ghSearchArgs, ghListArgs, ghViewArgs, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY } from "../mods/argus-issues/forge.js";
import { LIST_LIMIT } from "../lib/forge-cli.js";

test("ghSearchArgs filters by the signed-in user for each kind", () => {
  for (const [kind, flag] of [
    ["assigned", "--assignee=@me"],
    ["created", "--author=@me"],
    ["mentions", "--mentions=@me"],
  ]) {
    const args = ghSearchArgs(kind);
    assert.deepEqual(args.slice(0, 3), ["search", "issues", flag]);
    assert.ok(args.includes("--state=open"));
    assert.ok(args.includes("--archived=false"));
    assert.equal(args[args.indexOf("--limit") + 1], String(LIST_LIMIT));
    assert.match(args[args.indexOf("--json") + 1], /isPullRequest/);
  }
  assert.throws(() => ghSearchArgs("other"), /unknown search kind/);
  assert.throws(() => ghSearchArgs("__proto__"), /unknown search kind/);
});

test("ghListArgs and ghViewArgs name the repo and the fields", () => {
  assert.deepEqual(ghListArgs("example-org/example-repo").slice(0, 6), ["issue", "list", "--repo", "example-org/example-repo", "--state", "open"]);
  const view = ghViewArgs("example-org/example-repo", 7);
  assert.deepEqual(view.slice(0, 5), ["issue", "view", "7", "--repo", "example-org/example-repo"]);
  assert.match(view[view.length - 1], /comments/);
});

test("GitLab queries ask for open issues only and declare their variables", () => {
  assert.match(GL_USER_QUERY, /^query\(\$user: String!\)/);
  assert.match(GL_USER_QUERY, /assigneeUsernames: \[\$user\]/);
  assert.match(GL_USER_QUERY, /authorUsername: \$user/);
  assert.match(GL_PROJECT_QUERY, /^query\(\$path: ID!\)/);
  assert.match(GL_PROJECT_QUERY, /state: opened/);
  assert.match(GL_DETAIL_QUERY, /\$iid: String!/);
  assert.match(GL_DETAIL_QUERY, /discussions\(first: 100\) \{ pageInfo \{ hasNextPage \}/);
  assert.match(GL_USER_QUERY, new RegExp(`first: ${LIST_LIMIT}`));
});
