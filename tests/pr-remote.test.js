import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followProjectKey,
  localFolders,
  localPathFor,
  mergeProjects,
  parseRemote,
  parseRevParse,
  projectKey,
  remoteArgs,
  revParseArgs,
} from "../mods/argus-pull-requests/remote.js";

const ENTRIES = [
  { folder: "/home/test/b", top: "/home/test/b", main: "/home/test/b", remote: "git@github.com:example-org/zeta.git" },
  { folder: "/wt/b/x", top: "/wt/b/x", main: "/home/test/b", remote: "https://github.com/Example-Org/zeta" },
  { folder: "/home/test/c", top: "/home/test/c", main: "/home/test/c", remote: "git@github.com:example-org/Alpha.git" },
  { folder: "/tmp/plain", top: "/tmp/plain", main: "/tmp/plain", remote: null },
];

test("parseRemote: forms", () => {
  const cases = [
    ["git@github.com:example-org/example-repo.git", "github", "github.com", "example-org/example-repo"],
    ["https://github.com/example-org/example-repo", "github", "github.com", "example-org/example-repo"],
    ["https://octo-user@GitHub.com/example-org/example-repo.git/", "github", "github.com", "example-org/example-repo"],
    ["ssh://git@ssh.github.com:443/example-org/example-repo.git", "github", "github.com", "example-org/example-repo"],
    ["git@gitlab.example.com:example-group/example-sub/example-project.git", "gitlab", "gitlab.example.com", "example-group/example-sub/example-project"],
    ["ssh://git@gitlab.example.com:2222/example-group/example-project.git", "gitlab", "gitlab.example.com", "example-group/example-project"],
    ["https://gitlab.example.com:8443/example-group/example-project", "gitlab", "gitlab.example.com:8443", "example-group/example-project"],
  ];
  for (const [url, provider, host, repo] of cases) assert.deepEqual(parseRemote(url), { provider, host, repo }, url);
});

test("parseRemote: not a forge", () => {
  for (const url of ["", "/srv/git/example.git", "file:///srv/git/example.git", "https://github.com/only-owner"]) assert.equal(parseRemote(url), null, url);
});

test("projectKey and git argument lists", () => {
  assert.equal(projectKey({ host: "GitHub.com", repo: "Example-Org/Zeta" }), "github.com/example-org/zeta");
  assert.deepEqual(revParseArgs(), ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]);
  assert.deepEqual(remoteArgs(), ["remote", "get-url", "origin"]);
});

test("localFolders: space folders and terminal cwds, local spaces only, once each", () => {
  const spaces = [
    { id: "s1", machine: null, folder: "/home/test/a", tabs: [{ id: "t1" }] },
    { id: "s2", machine: "box", folder: "/home/test/remote", tabs: [{ id: "t2" }] },
  ];
  const panes = [
    { tab: "t1", terminal: "x", cwd: "/home/test/a/sub" },
    { tab: "t1", terminal: "y", cwd: "/home/test/a" },
    { tab: "t1", terminal: null, mod: "argus-tsk", cwd: null },
    { tab: "t2", terminal: "z", cwd: "/home/test/remote" },
  ];
  assert.deepEqual(localFolders(spaces, panes), ["/home/test/a", "/home/test/a/sub"]);
});

test("parseRevParse: main checkout and linked worktree", () => {
  assert.deepEqual(parseRevParse("/home/test/a\n/home/test/a/.git\n"), { top: "/home/test/a", main: "/home/test/a" });
  assert.deepEqual(parseRevParse("/wt/a/feature\n/home/test/a/.git\n"), { top: "/wt/a/feature", main: "/home/test/a" });
  assert.equal(parseRevParse(""), null);
});

test("mergeProjects: dedupes by key, skips non-forge, sorts by repo", () => {
  const out = mergeProjects(ENTRIES);
  assert.deepEqual(out.map((p) => p.repo), ["example-org/Alpha", "example-org/zeta"]);
  assert.deepEqual(out[1].folders, ["/home/test/b", "/wt/b/x"]);
  assert.equal(out[1].localPath, "/home/test/b");
});

test("followProjectKey: longest folder match, null outside", () => {
  const projects = mergeProjects(ENTRIES);
  assert.equal(followProjectKey(projects, "/wt/b/x/src"), "github.com/example-org/zeta");
  assert.equal(followProjectKey(projects, "/wt/b/x-other"), null);
  assert.equal(followProjectKey(projects, "/home/test/other"), null);
  assert.equal(followProjectKey(projects, null), null);
});

test("localPathFor: matches host and repo case-insensitively, else null", () => {
  const projects = mergeProjects(ENTRIES);
  assert.equal(localPathFor(projects, "github.com", "EXAMPLE-ORG/ZETA"), "/home/test/b");
  assert.equal(localPathFor(projects, "gitlab.example.com", "example-org/zeta"), null);
});
