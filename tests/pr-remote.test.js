import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followProjectKey,
  localFolders,
  localPathFor,
  mergeProjects,
  missingProjectKeys,
  newProjectKeys,
  parseRemote,
  parseRevParse,
  projectKey,
  remoteArgs,
  revParseArgs,
} from "../mods/argus-pull-requests/remote.js";
import { PROBE_TTL_MS, needsGlabLogin, needsProbe } from "../mods/argus-pull-requests/remote.js";

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

test("parseRemote: other public forges are not projects", () => {
  const urls = [
    "git@bitbucket.org:example-org/example-repo.git",
    "https://dev.azure.com/example-org/example-project/_git/example-repo",
    "git@ssh.dev.azure.com:v3/example-org/example-project/example-repo",
    "https://example-org.visualstudio.com/example-project/_git/example-repo",
    "https://codeberg.org/example-org/example-repo",
    "https://gitea.com/example-org/example-repo.git",
    "https://git.sr.ht/~example-user/example-repo",
  ];
  for (const url of urls) assert.equal(parseRemote(url), null, url);
  assert.equal(parseRemote("https://git.example.com/example-group/example-repo")?.provider, "gitlab");
});

test("missingProjectKeys: keys that no project has", () => {
  const projects = [{ key: "github.com/example-org/zeta" }];
  assert.deepEqual(missingProjectKeys(["github.com/example-org/zeta", "github.com/example-org/new"], projects), ["github.com/example-org/new"]);
  assert.deepEqual(missingProjectKeys([], projects), []);
  assert.deepEqual(missingProjectKeys(["github.com/example-org/zeta"], projects), []);
});

test("newProjectKeys: only forge remotes whose project is not known", () => {
  const known = mergeProjects(ENTRIES.slice(0, 2));
  assert.deepEqual(newProjectKeys(ENTRIES.slice(0, 2), known), []);
  assert.deepEqual(newProjectKeys(ENTRIES, known), ["github.com/example-org/alpha"]);
  assert.deepEqual(newProjectKeys([ENTRIES[3], null], []), []);
  assert.deepEqual(newProjectKeys([{ ...ENTRIES[0], remote: "git@bitbucket.org:example-org/zeta.git" }], []), []);
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

test("parseRemote: a GitHub repo is owner/name only", () => {
  for (const url of ["https://github.com/example-org/example-repo/extra", "git@github.com:example-org/example-repo/tree.git", "https://github.com/example-org"]) {
    assert.equal(parseRemote(url), null, url);
  }
  assert.equal(parseRemote("git@github.com:example-org/example-repo.git")?.repo, "example-org/example-repo");
  // GitLab keeps subgroups.
  assert.equal(parseRemote("https://gitlab.com/example-group/example-sub/deeper/example-project.git")?.repo, "example-group/example-sub/deeper/example-project");
});

test("parseRemote: a host or path part that starts with - is refused", () => {
  const urls = [
    "-example.com:example-group/example-project.git",
    "git@-example.com:example-group/example-project.git",
    "git@github.com:-example-org/example-repo.git",
    "https://github.com/example-org/-example-repo",
    "https://gitlab.example.com/example-group/-sub/example-project",
    "git@gitlab.example.com:example-group/example-sub/--upload-pack.git",
  ];
  for (const url of urls) assert.equal(parseRemote(url), null, url);
  assert.equal(parseRemote("https://github.com/example-org/example-repo-")?.repo, "example-org/example-repo-");
});

test("needsProbe: no repo and no remote probe on every read; a repo with a remote after PROBE_TTL_MS", () => {
  const repo = { folder: "/home/test/a", top: "/home/test/a", main: "/home/test/a", remote: "git@github.com:example-org/example-repo.git" };
  assert.equal(needsProbe(undefined, 1000), true);
  assert.equal(needsProbe({ entry: null, at: 1000 }, 1000), true);
  assert.equal(needsProbe({ entry: { ...repo, remote: null }, at: 1000 }, 1000), true);
  assert.equal(needsProbe({ entry: repo, at: 1000 }, 1000 + PROBE_TTL_MS - 1), false);
  assert.equal(needsProbe({ entry: repo, at: 1000 }, 1000 + PROBE_TTL_MS), true);
  assert.equal(PROBE_TTL_MS, 10 * 60 * 1000);
});

test("needsGlabLogin: every GitLab host except gitlab.com", () => {
  assert.equal(needsGlabLogin("gitlab.com"), false);
  assert.equal(needsGlabLogin("gitlab.example.com"), true);
  assert.equal(needsGlabLogin("git.example.com:8443"), true);
});
