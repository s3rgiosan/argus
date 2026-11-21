import { test } from "node:test";
import assert from "node:assert/strict";
import { createForgeRunner, CLI_CONCURRENCY } from "../lib/forge-runner.js";
import { PROBE_TTL_MS } from "../lib/remote.js";

const HOME = "/home/test";

/** A fake `exec`: `answer(command, args, options)` gives a reply or throws. Every call is logged. */
function fakeExec(answer) {
  const calls = [];
  const exec = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd ?? null });
    return answer(command, args, options);
  };
  return { exec, calls };
}

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "boom", code = 1) => ({ code, stdout: "", stderr });

function runner(answer, { settings = { gh: "", glab: "" }, clock = { now: 1_000 } } = {}) {
  const fake = fakeExec(answer);
  const forge = createForgeRunner({ exec: fake.exec, home: () => HOME, settings: () => settings, now: () => clock.now });
  return { forge, calls: fake.calls, clock };
}

test("CLI_CONCURRENCY is 4", () => {
  assert.equal(CLI_CONCURRENCY, 4);
});

test("locate gives the first candidate whose --version runs, and keeps it per setting", async () => {
  const settings = { gh: "~/bin/gh", glab: "" };
  const { forge, calls } = runner((command) => (command === "gh" ? ok("gh version 2") : fail()), { settings });
  assert.equal(await forge.locate("gh"), "gh");
  assert.deepEqual(calls.map((call) => call.command), ["/home/test/bin/gh", "gh"]);
  assert.equal(await forge.locate("gh"), "gh");
  assert.equal(calls.length, 2);
  settings.gh = "";
  assert.equal(await forge.locate("gh"), "gh");
  assert.equal(calls.length, 3);
});

test("locate gives null when no candidate runs, and a rejected run counts as missing", async () => {
  const { forge, calls } = runner(() => {
    throw new Error("not found");
  });
  assert.equal(await forge.locate("glab"), null);
  assert.equal(calls.length, 5);
  assert.equal(await forge.locate("glab"), null);
  assert.equal(calls.length, 5);
  forge.clear();
  assert.equal(await forge.locate("glab"), null);
  assert.equal(calls.length, 10);
});

test("attempt parses the output, or adds one note under the label", async () => {
  const { forge } = runner((_command, args) => {
    switch (args[0]) {
      case "ok":
        return ok("[1,2]");
      case "fail":
        return fail("HTTP 401");
      case "throw":
        throw new Error("timed out");
      default:
        return ok("not json");
    }
  });
  const notes = [];
  assert.deepEqual(await forge.attempt("gh", "gh", ["ok"], JSON.parse, notes), [1, 2]);
  assert.equal(await forge.attempt("gh", "gh", ["fail"], JSON.parse, notes), null);
  assert.equal(await forge.attempt("glab (gitlab.example.com)", "glab", ["throw"], JSON.parse, notes), null);
  assert.equal(await forge.attempt("gh", "gh", ["bad"], () => {
    throw new Error("unexpected gh output");
  }, notes), null);
  assert.deepEqual(notes, ["gh: HTTP 401", "glab (gitlab.example.com): timed out", "gh: unexpected gh output"]);
});

test("attempt takes the value that recover gives for a failed reply, with no note", async () => {
  const { forge } = runner((_command, args) => (args[0] === "off" ? fail("the 'example-org/example-repo' repository has disabled issues") : fail("HTTP 401")));
  const notes = [];
  const recover = (reply) => (reply.stderr.includes("disabled issues") ? [] : null);
  assert.deepEqual(await forge.attempt("gh", "gh", ["off"], JSON.parse, notes, { recover }), []);
  assert.equal(await forge.attempt("gh", "gh", ["other"], JSON.parse, notes, { recover }), null);
  assert.deepEqual(notes, ["gh: HTTP 401"]);
});

test("signedInGitLab keeps gitlab.com and the hosts glab is signed in to, with one note per other host", async () => {
  const { forge, calls } = runner((_command, args) => (args.includes("git.example.com") ? ok() : fail("not logged in")));
  const projects = [
    { key: "gitlab.com/example-group/a", host: "gitlab.com" },
    { key: "git.example.com/example-group/b", host: "git.example.com" },
    { key: "code.example.org/example-group/c", host: "code.example.org" },
    { key: "code.example.org/example-group/d", host: "code.example.org" },
  ];
  const notes = [];
  const kept = await forge.signedInGitLab("glab", projects, notes);
  assert.deepEqual(kept.map((project) => project.key), ["gitlab.com/example-group/a", "git.example.com/example-group/b"]);
  assert.deepEqual(notes, ["code.example.org: no glab login for this host"]);
  assert.equal(calls.length, 2);
  await forge.signedInGitLab("glab", projects, []);
  assert.equal(calls.length, 2);
});

test("glabLogin does not keep a check that could not start", async () => {
  let starts = 0;
  const { forge } = runner(() => {
    starts += 1;
    if (starts === 1) throw new Error("spawn failed");
    return ok();
  });
  assert.equal(await forge.glabLogin("glab", "git.example.com"), false);
  assert.equal(await forge.glabLogin("glab", "git.example.com"), true);
  assert.equal(await forge.glabLogin("glab", "git.example.com"), true);
  assert.equal(starts, 2);
});

test("glUsername keeps a username per command and host, and not a failed read", async () => {
  let answers = [fail("401"), ok(JSON.stringify({ data: { currentUser: { username: "octo-user" } } }))];
  const { forge, calls } = runner(() => answers.shift());
  const notes = [];
  assert.equal(await forge.glUsername("glab", "gitlab.example.com", notes), null);
  assert.deepEqual(notes, ["glab (gitlab.example.com): 401"]);
  assert.equal(await forge.glUsername("glab", "gitlab.example.com", notes), "octo-user");
  assert.equal(await forge.glUsername("glab", "gitlab.example.com", notes), "octo-user");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args.slice(0, 4), ["api", "graphql", "--hostname", "gitlab.example.com"]);
});

/** Folders under /home/test/repo are one GitHub repo; /home/test/notes is no repository. */
function gitAnswer(command, args, { cwd }) {
  assert.equal(command, "git");
  if (!cwd.startsWith("/home/test/repo")) return fail("not a git repository", 128);
  if (args[0] === "rev-parse") return ok(`${cwd}\n/home/test/repo/.git\n`);
  return ok("git@github.com:example-org/example-repo.git\n");
}

test("readProjects probes new folders and folders whose probe is old, then merges the projects", async () => {
  const { forge, calls, clock } = runner(gitAnswer);
  const projects = await forge.readProjects(["/home/test/repo", "/home/test/notes"]);
  assert.deepEqual(projects.map((project) => [project.key, project.localPath]), [["github.com/example-org/example-repo", "/home/test/repo"]]);
  assert.equal(calls.length, 3);
  assert.equal(forge.entryOf("/home/test/notes"), null);
  assert.equal(forge.entryOf("/home/test/other"), undefined);
  // The repository stays cached; the folder that is no repository is probed on each read.
  await forge.readProjects(["/home/test/repo", "/home/test/notes"]);
  assert.equal(calls.length, 4);
  clock.now += PROBE_TTL_MS;
  await forge.readProjects(["/home/test/repo"]);
  assert.equal(calls.length, 6);
});

test("probe shares a probe that runs already", async () => {
  const { forge, calls } = runner(gitAnswer);
  await Promise.all([forge.probe("/home/test/repo"), forge.probe("/home/test/repo")]);
  assert.equal(calls.length, 2);
});

test("probeNew skips probed folders and waits after a probe that could not run", async () => {
  let broken = true;
  const { forge, calls, clock } = runner((command, args, options) => {
    if (broken) throw new Error("timed out");
    return gitAnswer(command, args, options);
  });
  assert.deepEqual(await forge.probeNew(["/home/test/repo"], 60_000), [undefined]);
  assert.equal(calls.length, 1);
  broken = false;
  assert.deepEqual(await forge.probeNew(["/home/test/repo"], 60_000), [undefined]);
  assert.equal(calls.length, 1);
  clock.now += 60_000;
  const [entry] = await forge.probeNew(["/home/test/repo"], 60_000);
  assert.equal(entry.remote, "git@github.com:example-org/example-repo.git");
  assert.equal(calls.length, 3);
  await forge.probeNew(["/home/test/repo"], 60_000);
  assert.equal(calls.length, 3);
});

test("clear forgets the probes", async () => {
  const { forge, calls } = runner(gitAnswer);
  await forge.readProjects(["/home/test/repo"]);
  forge.clear();
  assert.equal(forge.entryOf("/home/test/repo"), undefined);
  await forge.readProjects(["/home/test/repo"]);
  assert.equal(calls.length, 4);
});
