import test from "node:test";
import assert from "node:assert/strict";
import {
  GH_MISSING,
  GLAB_MISSING,
  commandCandidates,
  cliError,
  missingNotes,
  normalizeSettings,
} from "../mods/argus-pull-requests/locate.js";

test("normalizeSettings defaults", () => {
  assert.deepEqual(normalizeSettings(null), { gh: "", glab: "", interval: 3, conversation: "oldest" });
});

test("normalizeSettings rejects an interval outside the choices", () => {
  assert.equal(normalizeSettings({ interval: 4 }).interval, 3);
});

test("normalizeSettings keeps a valid interval and trims commands", () => {
  const s = normalizeSettings({ interval: 10, gh: " ~/bin/gh " });
  assert.equal(s.interval, 10);
  assert.equal(s.gh, "~/bin/gh");
});

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

test("normalizeSettings keeps a known conversation order only", () => {
  assert.equal(normalizeSettings({ conversation: "newest" }).conversation, "newest");
  assert.equal(normalizeSettings({ conversation: "sideways" }).conversation, "oldest");
});

