import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORGE_KEY,
  GH_MISSING,
  GLAB_MISSING,
  GL_DEFAULT_BRANCH_QUERY,
  cliError,
  commandCandidates,
  forgeSettings,
  forgeNeedsWrite,
  ghDefaultBranchArgs,
  ghIssuesOff,
  issuesOffList,
  glNodes,
  glReply,
  glabArgs,
  glabAuthArgs,
  glabLoginState,
  glabLoginNote,
  isObject,
  isStringArray,
  limitNote,
  missingNotes,
  parseGhDefaultBranch,
  parseGlDefaultBranch,
  parseGlUsername,
  parseJson,
  webUrl,
} from "../lib/forge-cli.js";

const QUERY = "query($path: ID!, $iid: String!) { project(fullPath: $path) { issue(iid: $iid) { title } } }";

test("commandCandidates puts the setting or the bare name first", () => {
  assert.equal(commandCandidates("", "gh", "/home/test")[0], "gh");
  assert.equal(commandCandidates("~/bin/gh", "gh", "/home/test")[0], "/home/test/bin/gh");
});


test("commandCandidates lists the install locations once each", () => {
  const list = commandCandidates("gh", "gh", "/home/test");
  assert.equal(new Set(list).size, list.length);
  assert.deepEqual(list, [
    "gh",
    "/home/test/.local/bin/gh",
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/home/linuxbrew/.linuxbrew/bin/gh",
  ]);
});


test("cliError uses the first non-empty stderr line", () => {
  const reply = {
    code: 4,
    stdout: "",
    stderr: "\nTo get started with GitHub CLI, please run:  gh auth login\n",
  };
  assert.equal(cliError("gh", reply), "gh: To get started with GitHub CLI, please run:  gh auth login");
});


test("cliError falls back to stdout, then the exit code", () => {
  assert.equal(cliError("gh", { code: 1, stdout: "\nout line\nmore", stderr: " \n" }), "gh: out line");
  assert.equal(cliError("gh", { code: 4, stdout: "", stderr: "" }), "gh: exited with code 4");
});


test("missingNotes", () => {
  const base = { gh: true, glab: true, githubProjects: 0, gitlabProjects: 0 };
  assert.deepEqual(missingNotes({ ...base, gh: false }), [GH_MISSING]);
  assert.deepEqual(missingNotes({ ...base, gh: false, gitlabProjects: 2 }), []);
  assert.deepEqual(missingNotes({ ...base, gh: false, githubProjects: 1 }), [GH_MISSING]);
  assert.deepEqual(missingNotes({ ...base, glab: false, gitlabProjects: 1 }), [GLAB_MISSING]);
  assert.deepEqual(missingNotes({ ...base, glab: false }), []);
  assert.deepEqual(missingNotes(base), []);
});


test("glabArgs passes the host, the query and string variables", () => {
  assert.deepEqual(glabArgs("gitlab.example.com", QUERY, { path: "example-group/example-project", iid: "12" }),
    ["api", "graphql", "--hostname", "gitlab.example.com", "-f", `query=${QUERY}`, "-f", "path=example-group/example-project", "-f", "iid=12"]);
});


test("limitNote: a note only when a list reached the limit", () => {
  assert.equal(limitNote("pull requests of example-org/example-repo", 100), "Showing the first 100 pull requests of example-org/example-repo.");
  assert.equal(limitNote("merge requests", 101), "Showing the first 100 merge requests.");
  assert.equal(limitNote("pull requests", 99), null);
  assert.equal(limitNote("pull requests", 0), null);
  assert.equal(limitNote("pull requests", 3, 3), "Showing the first 3 pull requests.");
});


test("glabAuthArgs checks one host, and the note names it", () => {
  assert.deepEqual(glabAuthArgs("git.example.com"), ["auth", "status", "--hostname", "git.example.com"]);
  assert.equal(glabLoginNote("git.example.com"), "git.example.com: no glab login for this host");
});


test("the default branch is read from the forge", () => {
  assert.deepEqual(ghDefaultBranchArgs("example-org/example-repo"), ["repo", "view", "example-org/example-repo", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  assert.equal(parseGhDefaultBranch("main\n"), "main");
  assert.equal(parseGhDefaultBranch("\n"), null);
  assert.match(GL_DEFAULT_BRANCH_QUERY, /project\(fullPath: \$path\) \{ repository \{ rootRef \} \}/);
  assert.equal(parseGlDefaultBranch(JSON.stringify({ data: { project: { repository: { rootRef: "main" } } } })), "main");
  assert.equal(parseGlDefaultBranch(JSON.stringify({ data: { project: { repository: null } } })), null);
  assert.equal(parseGlDefaultBranch(JSON.stringify({ data: { project: null } })), null);
});


test("parseGlUsername", () => {
  assert.equal(parseGlUsername(JSON.stringify({ data: { currentUser: { username: "octo-user" } } })), "octo-user");
  assert.throws(() => parseGlUsername(JSON.stringify({ data: { currentUser: null } })));
  assert.throws(() => parseGlUsername("nope"));
});


test("forgeNeedsWrite writes a key that was never written, or a changed value", () => {
  const same = { gh: "gh", glab: "glab" };
  assert.equal(forgeNeedsWrite(undefined, same, same), true);
  assert.equal(forgeNeedsWrite("x", same, same), true);
  assert.equal(forgeNeedsWrite({ gh: "gh", glab: "glab" }, same, same), false);
  assert.equal(forgeNeedsWrite({ gh: "gh", glab: "glab" }, same, { gh: "a", glab: "glab" }), true);
});

test("forgeSettings trims the commands and reads the old settings while the shared key is missing", () => {
  assert.equal(FORGE_KEY, "argus.forge");
  assert.deepEqual(forgeSettings(undefined), { gh: "", glab: "" });
  assert.deepEqual(forgeSettings({ gh: " ~/bin/gh ", glab: 3 }), { gh: "~/bin/gh", glab: "" });
  assert.deepEqual(forgeSettings(undefined, { gh: "/opt/gh", glab: " glab ", interval: 5 }), { gh: "/opt/gh", glab: "glab" });
  assert.deepEqual(forgeSettings({ gh: "", glab: "" }, { gh: "/opt/gh" }), { gh: "", glab: "" });
  assert.deepEqual(forgeSettings([], { gh: "/opt/gh" }), { gh: "/opt/gh", glab: "" });
  assert.deepEqual(forgeSettings(null, "x"), { gh: "", glab: "" });
});

test("commandCandidates skips the home install folder without a home", () => {
  assert.deepEqual(commandCandidates("", "glab", ""), ["glab", "/opt/homebrew/bin/glab", "/usr/local/bin/glab", "/home/linuxbrew/.linuxbrew/bin/glab"]);
});

test("isStringArray is true only for an array of strings", () => {
  assert.equal(isStringArray([]), true);
  assert.equal(isStringArray(["a", "b"]), true);
  assert.equal(isStringArray(["a", 1]), false);
  assert.equal(isStringArray("a"), false);
  assert.equal(isStringArray(null), false);
});

test("isObject and webUrl", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
  assert.equal(webUrl("https://github.com/example-org/example-repo"), "https://github.com/example-org/example-repo");
  assert.equal(webUrl("http://gitlab.example.com/x"), "http://gitlab.example.com/x");
  assert.equal(webUrl("file:///etc/hosts"), null);
  assert.equal(webUrl("https://example.com/a b"), null);
  assert.equal(webUrl(3), null);
});

test("parseJson names the CLI when the text is not JSON", () => {
  assert.deepEqual(parseJson("[1]", "gh"), [1]);
  assert.throws(() => parseJson("nope", "gh"), /unexpected gh output/);
  assert.throws(() => parseJson("nope", "glab"), /unexpected glab output/);
});

test("glReply gives the data and throws the first reported error", () => {
  assert.deepEqual(glReply(JSON.stringify({ data: { a: 1 } })), { a: 1 });
  assert.throws(() => glReply(JSON.stringify({ errors: [{ message: "Field missing" }] })), /Field missing/);
  assert.throws(() => glReply(JSON.stringify({ data: null })), /unexpected glab output/);
  assert.throws(() => glReply("[]"), /unexpected glab output/);
  assert.throws(() => glReply("nope"), /unexpected glab output/);
});

test("glNodes gives the node list of a connection", () => {
  assert.deepEqual(glNodes({ nodes: [1, 2] }), [1, 2]);
  assert.throws(() => glNodes({ nodes: null }), /unexpected glab output/);
  assert.throws(() => glNodes(null), /unexpected glab output/);
});

test("ghIssuesOff knows the gh reply for a repo with issues turned off", () => {
  const reply = (stderr, code = 1) => ({ code, stdout: "", stderr });
  assert.equal(ghIssuesOff(reply("the 'example-org/example-repo' repository has disabled issues\n")), true);
  assert.equal(ghIssuesOff(reply("HTTP 401: Bad credentials")), false);
  assert.equal(ghIssuesOff(reply("GraphQL: Could not resolve to a Repository with the name 'example-org/example-repo'.")), false);
  assert.equal(ghIssuesOff(reply("the 'example-org/example-repo' repository has disabled issues", 0)), false);
});

test("issuesOffList gives an empty list for a repo with issues turned off, else null", () => {
  const reply = (stderr, code = 1) => ({ code, stdout: "", stderr });
  assert.deepEqual(issuesOffList(reply("the 'example-org/example-repo' repository has disabled issues")), []);
  assert.equal(issuesOffList(reply("HTTP 401: Bad credentials")), null);
});

test("glabLoginState reads a glab auth status reply", () => {
  const reply = (code, stderr) => ({ code, stdout: "", stderr });
  assert.equal(glabLoginState(reply(0, "git.example.com\n  ✓ Logged in to git.example.com as octo-user (keyring)")), "signed-in");
  assert.equal(glabLoginState(reply(1, "git.example.com\n  x git.example.com has not been authenticated with glab; run `glab auth login --hostname git.example.com` to authenticate.")), "signed-out");
  assert.equal(glabLoginState(reply(1, 'git.example.com\n  x git.example.com: API call failed: Get "https://git.example.com/api/v4/user": dial tcp: i/o timeout')), "failed");
  assert.equal(glabLoginState(reply(1, "")), "failed");
});
