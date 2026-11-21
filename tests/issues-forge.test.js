import test from "node:test";
import assert from "node:assert/strict";
import { ghSearchArgs, ghListArgs, ghViewArgs, glabArgs, limitNote, GL_USER_QUERY, GL_PROJECT_QUERY, GL_DETAIL_QUERY, LIST_LIMIT } from "../mods/argus-issues/forge.js";
import { normalizeSettings, commandCandidates, cliError, missingNotes, openArgs, GH_MISSING, GLAB_MISSING } from "../mods/argus-issues/locate.js";

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

test("glabArgs passes the host, the query and each variable as -f", () => {
  assert.deepEqual(glabArgs("gitlab.example.com", "query { x }", { path: "a/b", iid: "3" }), ["api", "graphql", "--hostname", "gitlab.example.com", "-f", "query=query { x }", "-f", "path=a/b", "-f", "iid=3"]);
});

test("GitLab queries ask for open issues only and declare their variables", () => {
  assert.match(GL_USER_QUERY, /^query\(\$user: String!\)/);
  assert.match(GL_USER_QUERY, /assigneeUsernames: \[\$user\]/);
  assert.match(GL_USER_QUERY, /authorUsername: \$user/);
  assert.match(GL_PROJECT_QUERY, /^query\(\$path: ID!\)/);
  assert.match(GL_PROJECT_QUERY, /state: opened/);
  assert.match(GL_DETAIL_QUERY, /\$iid: String!/);
  assert.match(GL_DETAIL_QUERY, /discussions\(first: 100\) \{ pageInfo \{ hasNextPage \}/);
});

test("limitNote speaks only at the limit", () => {
  assert.equal(limitNote("issues of a/b", 99), null);
  assert.equal(limitNote("issues of a/b", 100), "Showing the first 100 issues of a/b.");
});

test("normalizeSettings keeps valid values and falls back for the rest", () => {
  assert.deepEqual(normalizeSettings(null), { gh: "", glab: "", interval: 3, comments: "oldest" });
  assert.deepEqual(normalizeSettings({ gh: " /opt/gh ", glab: 3, interval: 10, comments: "newest" }), { gh: "/opt/gh", glab: "", interval: 10, comments: "newest" });
  assert.deepEqual(normalizeSettings({ interval: 7, comments: "random" }), { gh: "", glab: "", interval: 3, comments: "oldest" });
});

test("commandCandidates tries the setting, the PATH, then the install folders, each once", () => {
  assert.deepEqual(commandCandidates("~/bin/gh", "gh", "/home/test"), ["/home/test/bin/gh", "gh", "/home/test/.local/bin/gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"]);
  assert.equal(commandCandidates("", "glab", "")[0], "glab");
});

test("cliError takes the first line of stderr, then stdout, then the code", () => {
  assert.equal(cliError("gh", { code: 1, stdout: "", stderr: "\n Example error\nmore" }), "gh: Example error");
  assert.equal(cliError("gh", { code: 1, stdout: "Out", stderr: "" }), "gh: Out");
  assert.equal(cliError("gh", { code: 4, stdout: "", stderr: "" }), "gh: exited with code 4");
});

test("missingNotes asks for gh without projects and for glab only with GitLab projects", () => {
  assert.deepEqual(missingNotes({ gh: false, glab: false, githubProjects: 0, gitlabProjects: 0 }), [GH_MISSING]);
  assert.deepEqual(missingNotes({ gh: true, glab: false, githubProjects: 1, gitlabProjects: 1 }), [GLAB_MISSING]);
  assert.deepEqual(missingNotes({ gh: false, glab: true, githubProjects: 0, gitlabProjects: 1 }), []);
});

test("openArgs opens only http and https URLs", () => {
  assert.deepEqual(openArgs("macos", "https://example.com"), ["open", ["https://example.com"]]);
  assert.deepEqual(openArgs("linux", "http://example.com"), ["xdg-open", ["http://example.com"]]);
  assert.equal(openArgs("macos", "file:///etc/passwd"), null);
});
