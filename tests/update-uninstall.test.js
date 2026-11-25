import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, lstatSync, readFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const update = fileURLToPath(new URL("../scripts/update.sh", import.meta.url));
const uninstall = fileURLToPath(new URL("../scripts/uninstall.sh", import.meta.url));
const ENV = { PATH: "/usr/bin:/bin", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: { ...ENV, HOME: cwd }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** A clone of a bare origin, with update.sh and an install.sh that logs its arguments. */
function clone() {
  const root = mkdtempSync(join(tmpdir(), "argus-update-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(root, "clone", "-q", "origin.git", "repo");
  const repo = join(root, "repo");
  mkdirSync(join(repo, "scripts"));
  copyFileSync(update, join(repo, "scripts/update.sh"));
  writeFileSync(join(repo, "scripts/install.sh"), `echo "install $*" >> "${join(root, "log")}"\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  const run = (...args) => spawnSync("sh", [join(repo, "scripts/update.sh"), ...args], { env: { ...ENV, HOME: root }, encoding: "utf8" });
  const log = () => (existsSync(join(root, "log")) ? readFileSync(join(root, "log"), "utf8").trim() : "");
  return { root, repo, run, log };
}

test("update.sh pulls, then runs install.sh with its arguments", () => {
  const { root, run, log } = clone();
  git(root, "clone", "-q", "origin.git", "other");
  writeFileSync(join(root, "other/NEW"), "x");
  git(join(root, "other"), "add", ".");
  git(join(root, "other"), "commit", "-q", "-m", "new");
  git(join(root, "other"), "push", "-q", "origin", "HEAD:main");
  const r = run("--prune");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(root, "repo/NEW")));
  assert.equal(log(), "install --prune");
});

test("update.sh refuses a clone with local changes and installs nothing", () => {
  const { repo, run, log } = clone();
  writeFileSync(join(repo, "scripts/install.sh"), "echo changed\n");
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /local changes/);
  assert.equal(log(), "");
});

/** A Herdr app folder with Argus's files and the person's own. */
function app() {
  const root = mkdtempSync(join(tmpdir(), "argus-uninstall-"));
  const home = join(root, "app");
  const mod = (name, files) => {
    mkdirSync(join(home, "mods", name), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(home, "mods", name, file), text);
  };
  mod("argus-tsk", { ".installed-from-argus": "", "main.js": "" });
  mod("argus-spaces", { "mod.json": '{\n  "title": "Spaces (Argus)",\n  "generated_by": "argus"\n}\n', "main.js": "" });
  mod("mine", { "mod.json": '{ "title": "Mine" }', "main.js": "" });
  mkdirSync(join(home, "layouts"), { recursive: true });
  writeFileSync(join(home, "layouts/Argus.json"), '{\n  "id": "root",\n  "generated_by": "argus"\n}\n');
  writeFileSync(join(home, "layouts/Argus.svg"), "<svg/>");
  writeFileSync(join(home, "layouts/Mine.json"), '{ "id": "root" }');
  writeFileSync(join(home, "argus.json"), "{}");
  const run = (path = "/usr/bin:/bin") => spawnSync("sh", [uninstall], { env: { PATH: path, HOME: root, HERDR_APP_HOME: home }, encoding: "utf8" });
  return { root, home, run };
}

test("uninstall.sh removes Argus's mods, copies and layouts, and keeps the person's files", () => {
  const { home, run } = app();
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  for (const gone of ["mods/argus-tsk", "mods/argus-spaces", "layouts/Argus.json", "layouts/Argus.svg"]) assert.ok(!existsSync(join(home, gone)), gone);
  for (const kept of ["mods/mine/main.js", "layouts/Mine.json", "argus.json"]) assert.ok(existsSync(join(home, kept)), kept);
  assert.match(r.stdout, /argus\.json stays/);
});

test("uninstall.sh removes a link to this repo's mod folder, never its target, and keeps other links", () => {
  const { root, home, run } = app();
  const repoMods = fileURLToPath(new URL("../mods", import.meta.url));
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, "main.js"), "");
  symlinkSync(join(repoMods, "argus-issues"), join(home, "mods/argus-issues"));
  symlinkSync(elsewhere, join(home, "mods/linked-away"));
  symlinkSync(join(repoMods, "argus-issues"), join(home, "mods/other-name"));
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.throws(() => lstatSync(join(home, "mods/argus-issues")));
  assert.ok(existsSync(join(repoMods, "argus-issues/main.js")));
  assert.ok(lstatSync(join(home, "mods/linked-away")).isSymbolicLink());
  assert.ok(lstatSync(join(home, "mods/other-name")).isSymbolicLink());
  assert.ok(existsSync(join(elsewhere, "main.js")));
});

test("uninstall.sh switches Herdr to main first when an Argus layout shows", () => {
  const { root, home, run } = app();
  const shim = join(root, "shim");
  mkdirSync(shim);
  writeFileSync(join(shim, "herdr-app"), `#!/bin/sh\necho "$*" >> "${join(root, "herdr.log")}"\n[ "$1" = status ] && echo '{ "layout": "Argus" }'\nexit 0\n`);
  chmodSync(join(shim, "herdr-app"), 0o755);
  assert.equal(run(`${shim}:/usr/bin:/bin`).status, 0);
  assert.match(readFileSync(join(root, "herdr.log"), "utf8"), /do layout\.switch \{"name":"main"\}/);
  assert.ok(!existsSync(join(home, "layouts/Argus.json")));
});
