import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorktreeRunner } from "../lib/worktree-runner.js";

const SHA = "a".repeat(40);
const project = { provider: "github", host: "github.com", repo: "example-org/example-repo", key: "github.com/example-org/example-repo", localPath: "/home/test/example-repo" };
const MAIN = `worktree /home/test/example-repo\nHEAD ${SHA}\nbranch refs/heads/main\n`;

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "fatal: no", code = 1) => ({ code, stdout: "", stderr });

/**
 * A runner over a fake git. `git(args)` answers each git call; `test -e` and `test -L` fail
 * unless `taken` holds the path. Every call and every `run` is logged.
 */
function harness({ git, taken = new Set(), settings = JSON.stringify({ worktrees: { directory: "~/worktrees" } }), forge = { locate: async () => null, attempt: async () => null }, spaces = [] }) {
  const calls = [];
  const runs = [];
  const exec = async (command, args, options = {}) => {
    calls.push([command, ...args].join(" "));
    if (command === "test") return taken.has(args[1]) ? ok() : fail("", 1);
    return git(args, options);
  };
  const worktrees = createWorktreeRunner({
    exec,
    readTextFile: async () => settings,
    appHome: () => "/home/test/.config/herdr-app",
    home: () => "/home/test",
    run: (command, args) => runs.push([command, args]),
    spaces: () => spaces,
    panes: () => [],
    forge,
  });
  return { worktrees, calls, runs };
}

/** A clone where no issue branch exists yet, the remote has none, and origin/HEAD is main. */
function freshClone(args) {
  switch (args[0]) {
    case "worktree":
      return args[1] === "list" ? ok(MAIN) : ok();
    case "rev-parse":
      return fail("", 1);
    case "ls-remote":
      return ok("");
    case "symbolic-ref":
      return ok("origin/main\n");
    case "check-ref-format":
      return ok(`${args[2]}\n`);
    case "fetch":
      return ok();
    default:
      return fail(`unexpected git ${args.join(" ")}`);
  }
}

test("createIssueWorktree cuts a branch from the default branch and opens a new space", async () => {
  const { worktrees, calls, runs } = harness({ git: freshClone });
  const outcome = await worktrees.createIssueWorktree(project, { number: 12, title: "Example title" });
  assert.deepEqual(outcome, { error: null, note: null });
  assert.ok(calls.includes("git fetch --no-tags origin -- main"));
  assert.ok(calls.includes("git worktree add --no-track -b 12-example-title /home/test/worktrees/example-repo/12-example-title origin/main"));
  assert.deepEqual(runs, [["space.new", { folder: "/home/test/worktrees/example-repo/12-example-title" }]]);
});

test("createIssueWorktree opens the space of an existing worktree", async () => {
  const list = `${MAIN}\nworktree /w/example-repo/12-example-title\nHEAD ${SHA}\nbranch refs/heads/12-example-title\n`;
  const { worktrees, runs } = harness({
    git: (args) => (args[0] === "worktree" ? ok(list) : args[0] === "rev-parse" ? ok(SHA) : freshClone(args)),
    spaces: [{ id: "space-1", folder: "/w/example-repo/12-example-title", machine: null, tabs: [] }],
  });
  assert.deepEqual(await worktrees.createIssueWorktree(project, { number: 12, title: "Example title" }), { error: null, note: null });
  assert.deepEqual(runs, [["space.select", { id: "space-1" }]]);
});

test("createIssueWorktree uses a branch of that name on the remote", async () => {
  const { worktrees, calls, runs } = harness({
    git: (args) => {
      if (args[0] === "ls-remote") return ok(`${SHA}\trefs/heads/12-example-title\n`);
      if (args[0] === "config") return args[1] === "--get-all" ? ok("+refs/heads/*:refs/remotes/origin/*\n") : ok();
      return freshClone(args);
    },
  });
  assert.deepEqual(await worktrees.createIssueWorktree(project, { number: 12, title: "Example title" }), { error: null, note: null });
  assert.ok(calls.includes("git fetch --no-tags origin +refs/heads/12-example-title:refs/remotes/origin/12-example-title"));
  assert.ok(calls.includes("git config branch.12-example-title.remote origin"));
  assert.equal(runs.length, 1);
});

test("createIssueWorktree asks the forge for the default branch when git does not know it", async () => {
  const asked = [];
  const forge = {
    locate: async (name) => (name === "gh" ? "gh" : null),
    attempt: async (label, command, args, parse) => {
      asked.push([label, command, ...args].join(" "));
      return parse("develop\n");
    },
  };
  const { worktrees, calls } = harness({ git: (args) => (args[0] === "symbolic-ref" ? fail("", 1) : freshClone(args)), forge });
  assert.deepEqual(await worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: null, note: null });
  assert.deepEqual(asked, ["gh gh repo view example-org/example-repo --json defaultBranchRef --jq .defaultBranchRef.name"]);
  assert.ok(calls.includes("git fetch --no-tags origin -- develop"));
});

test("createIssueWorktree treats an invalid default branch as unknown", async () => {
  for (const bad of ["origin/-x", "origin/a..b"]) {
    const { worktrees, calls, runs } = harness({
      git: (args) => (args[0] === "symbolic-ref" ? ok(`${bad}\n`) : args[0] === "check-ref-format" ? (args[2].startsWith("-") || args[2].includes("..") ? fail("fatal: bad", 128) : ok(`${args[2]}\n`)) : freshClone(args)),
    });
    assert.deepEqual(await worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: "Could not read the default branch of the repo.", note: null });
    assert.ok(!calls.some((call) => call.startsWith("git fetch")));
    assert.deepEqual(runs, []);
  }
  const forged = harness({
    git: (args) => (args[0] === "symbolic-ref" ? fail("", 1) : args[0] === "check-ref-format" && args[2] === "-x" ? fail("fatal: bad", 128) : freshClone(args)),
    forge: { locate: async () => "gh", attempt: async () => "-x" },
  });
  assert.equal((await forged.worktrees.createIssueWorktree(project, { number: 3, title: "Example" })).error, "Could not read the default branch of the repo.");
});

test("createIssueWorktree reads the default branch only when it cuts a new branch", async () => {
  const noHead = (args) => (args[0] === "symbolic-ref" ? fail("", 1) : freshClone(args));
  const list = `${MAIN}\nworktree /w/example-repo/3-example\nHEAD ${SHA}\nbranch refs/heads/3-example\n`;
  const open = harness({
    git: (args) => (args[0] === "worktree" ? ok(list) : args[0] === "rev-parse" ? ok(SHA) : noHead(args)),
    spaces: [{ id: "space-1", folder: "/w/example-repo/3-example", machine: null, tabs: [] }],
  });
  assert.deepEqual(await open.worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: null, note: null });
  assert.deepEqual(open.runs, [["space.select", { id: "space-1" }]]);
  const local = harness({ git: (args) => (args[0] === "rev-parse" ? ok(SHA) : noHead(args)) });
  assert.deepEqual(await local.worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: null, note: null });
  assert.ok(local.calls.includes("git worktree add /home/test/worktrees/example-repo/3-example 3-example"));
});

test("createIssueWorktree gives an error and opens nothing when a step fails", async () => {
  const unknown = harness({ git: (args) => (args[0] === "symbolic-ref" ? fail("", 1) : freshClone(args)) });
  assert.deepEqual(await unknown.worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: "Could not read the default branch of the repo.", note: null });
  assert.deepEqual(unknown.runs, []);

  const taken = harness({ git: freshClone, taken: new Set(["/home/test/worktrees/example-repo/3-example"]) });
  const outcome = await taken.worktrees.createIssueWorktree(project, { number: 3, title: "Example" });
  assert.match(outcome.error, /already exists/);
  assert.deepEqual(taken.runs, []);

  const broken = harness({ git: freshClone, settings: "{" });
  assert.match((await broken.worktrees.createIssueWorktree(project, { number: 3, title: "Example" })).error, /^settings\.json: /);

  const added = harness({ git: (args) => (args[0] === "worktree" && args[1] === "add" ? fail("fatal: could not add") : freshClone(args)) });
  assert.deepEqual(await added.worktrees.createIssueWorktree(project, { number: 3, title: "Example" }), { error: "git: fatal: could not add", note: null });
  // The failed add leaves no new branch behind.
  assert.ok(added.calls.includes("git branch -D 3-example"));

  // A failed add for an existing local branch deletes nothing.
  const reused = harness({ git: (args) => (args[0] === "rev-parse" ? ok(SHA) : args[0] === "worktree" && args[1] === "add" ? fail("fatal: could not add") : freshClone(args)) });
  assert.equal((await reused.worktrees.createIssueWorktree(project, { number: 3, title: "Example" })).error, "git: fatal: could not add");
  assert.ok(!reused.calls.some((call) => call.startsWith("git branch -D")));
});

test("branchWorktree notes a local branch that has commits of its own", async () => {
  const { worktrees, runs } = harness({
    git: (args) => {
      if (args[0] === "rev-parse") return ok(SHA);
      if (args[0] === "rev-list") return ok("2\t1\n");
      return freshClone(args);
    },
  });
  const outcome = await worktrees.branchWorktree(project, "feature/a");
  assert.deepEqual(outcome, { error: null, note: "The local branch feature/a is 2 ahead and 1 behind origin/feature/a." });
  assert.deepEqual(runs, [["space.new", { folder: "/home/test/worktrees/example-repo/feature-a" }]]);
});

test("context gives the worktrees folder and the list, and openWorktreeSpace opens a new space when none shows the folder", async () => {
  const { worktrees, runs } = harness({ git: freshClone });
  assert.deepEqual(await worktrees.context(project.localPath), { root: "/home/test/worktrees", porcelain: MAIN });
  worktrees.openWorktreeSpace("/w/example-repo/feature-a");
  assert.deepEqual(runs, [["space.new", { folder: "/w/example-repo/feature-a" }]]);
  assert.equal(await worktrees.folderTaken("/w/example-repo/feature-a"), false);
});
