import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, lstatSync, symlinkSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/install.sh", import.meta.url));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "argus-install-"));
  mkdirSync(join(root, "repo/scripts"), { recursive: true });
  mkdirSync(join(root, "repo/mods/demo"), { recursive: true });
  copyFileSync(script, join(root, "repo/scripts/install.sh"));
  writeFileSync(join(root, "repo/mods/demo/main.js"), "export default 1;\n");
  const run = (...args) =>
    spawnSync("sh", [join(root, "repo/scripts/install.sh"), ...args], {
      env: { PATH: "/usr/bin:/bin", HOME: root, HERDR_APP_HOME: join(root, "app") },
      encoding: "utf8",
    });
  return { root, run };
}

test("a trailing slash on a linked mod never deletes the repo folder", () => {
  const { root, run } = sandbox();
  assert.equal(run("--link", "demo").status, 0);
  run("--force", "demo/");
  assert.ok(existsSync(join(root, "repo/mods/demo/main.js")), "repo mod folder must survive");
});

test("names with a slash or dots are refused", () => {
  const { run } = sandbox();
  for (const name of ["../demo", "a/b", ".", ".."]) {
    const r = run(name);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /invalid mod name|no mod named/, name);
  }
});

test("copy install replaces an earlier link", () => {
  const { root, run } = sandbox();
  assert.equal(run("--link", "demo").status, 0);
  assert.equal(run("demo/").status, 0);
  const dest = join(root, "app/mods/demo");
  assert.equal(lstatSync(dest).isSymbolicLink(), false);
  assert.ok(existsSync(join(dest, "main.js")));
  assert.ok(existsSync(join(root, "repo/mods/demo/main.js")));
});

test("a symlink to somewhere else needs --force", () => {
  const { root, run } = sandbox();
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  mkdirSync(join(root, "app/mods"), { recursive: true });
  symlinkSync(elsewhere, join(root, "app/mods/demo"));
  assert.notEqual(run("demo").status, 0);
  assert.equal(lstatSync(join(root, "app/mods/demo")).isSymbolicLink(), true);
  assert.equal(run("--force", "demo").status, 0);
  assert.ok(existsSync(elsewhere));
});

test("a symlink into this repo is replaced without --force", () => {
  const { root, run } = sandbox();
  assert.equal(run("--link", "demo").status, 0);
  assert.equal(run("demo").status, 0);
  assert.equal(lstatSync(join(root, "app/mods/demo")).isSymbolicLink(), false);
});

test("install, reinstall, refuse a foreign folder, and --force", () => {
  const { root, run } = sandbox();
  const dest = join(root, "app/mods/demo");
  assert.equal(run("demo").status, 0);
  assert.ok(existsSync(join(dest, ".installed-from-argus")));
  writeFileSync(join(root, "repo/mods/demo/main.js"), "export default 2;\n");
  assert.equal(run("demo").status, 0);
  assert.equal(readFileSync(join(dest, "main.js"), "utf8"), "export default 2;\n");

  const foreign = join(root, "app/mods/other");
  mkdirSync(join(root, "repo/mods/other"));
  writeFileSync(join(root, "repo/mods/other/main.js"), "export default 3;\n");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "main.js"), "mine");
  const refused = run("other");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /was not installed by this script/);
  assert.equal(readFileSync(join(foreign, "main.js"), "utf8"), "mine");
  assert.equal(run("--force", "other").status, 0);
  assert.equal(readFileSync(join(foreign, "main.js"), "utf8"), "export default 3;\n");
  assert.deepEqual(readdirSync(join(root, "app")).filter((n) => n.startsWith(".argus-install.")), []);
});

test("a failed copy keeps the installed mod and leaves no temporary folder", () => {
  const { root, run } = sandbox();
  const dest = join(root, "app/mods/demo");
  assert.equal(run("demo").status, 0);
  writeFileSync(join(root, "repo/mods/demo/main.js"), "export default 2;\n");
  writeFileSync(join(root, "repo/mods/demo/extra.js"), "x");
  chmodSync(join(root, "repo/mods/demo/extra.js"), 0o000);
  const r = run("demo");
  chmodSync(join(root, "repo/mods/demo/extra.js"), 0o644);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not copy demo/);
  assert.equal(readFileSync(join(dest, "main.js"), "utf8"), "export default 1;\n");
  assert.deepEqual(readdirSync(join(root, "app")).filter((n) => n.startsWith(".argus-install.")), []);
});

function shim(root, name, body) {
  mkdirSync(join(root, "shim"), { recursive: true });
  const path = join(root, "shim", name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return join(root, "shim");
}

function runWith(root, shimDir, ...args) {
  return spawnSync("sh", [join(root, "repo/scripts/install.sh"), ...args], {
    env: { PATH: `${shimDir}:/usr/bin:/bin`, HOME: root, HERDR_APP_HOME: join(root, "app") },
    encoding: "utf8",
  });
}

test("a failing mv leaves the earlier install in place", () => {
  const { root, run } = sandbox();
  const dest = join(root, "app/mods/demo");
  assert.equal(run("demo").status, 0);
  writeFileSync(join(root, "repo/mods/demo/main.js"), "export default 2;\n");
  // Fail only the move that puts the new folder in place.
  const dir = shim(root, "mv", 'case "$1" in *.argus-install.*) exit 1 ;; esac\nexec /bin/mv "$@"');
  const r = runWith(root, dir, "demo");
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(dest, "main.js"), "utf8"), "export default 1;\n");
  assert.ok(existsSync(join(dest, ".installed-from-argus")));
  assert.deepEqual(readdirSync(join(root, "app/mods")), ["demo"]);
});

test("a failing find fails the copy and leaves the earlier install", () => {
  const { root, run } = sandbox();
  const dest = join(root, "app/mods/demo");
  assert.equal(run("demo").status, 0);
  writeFileSync(join(root, "repo/mods/demo/main.js"), "export default 2;\n");
  writeFileSync(join(root, "repo/mods/demo/other.js"), "x\n");
  const dir = shim(root, "find", 'find_out=$(/usr/bin/find "$@"); echo "$find_out" | head -1; exit 1');
  const r = runWith(root, dir, "demo");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /could not copy demo/);
  assert.equal(readFileSync(join(dest, "main.js"), "utf8"), "export default 1;\n");
});

test("an installed folder gets the normal folder mode, not 0700", () => {
  const { root, run } = sandbox();
  assert.equal(run("demo").status, 0);
  const mode = (path) => lstatSync(path).mode & 0o777;
  const normal = mkdtempSync(join(root, "probe-"));
  rmSync(normal, { recursive: true });
  mkdirSync(normal);
  assert.equal(mode(join(root, "app/mods/demo")), mode(normal));
});

/** A fake `node` that logs its arguments and fails a script whose name is in FAIL_SCRIPT. */
function nodeShim(root) {
  const dir = join(root, "shim");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "node"), `#!/bin/sh\necho "$*" >> "${join(root, "node.log")}"\ncase "$1" in *"$FAIL_SCRIPT"*) [ -n "$FAIL_SCRIPT" ] && { echo "refused" >&2; exit 1; } ;; esac\nexit 0\n`);
  chmodSync(join(dir, "node"), 0o755);
  const log = () => (existsSync(join(root, "node.log")) ? readFileSync(join(root, "node.log"), "utf8").trim().split("\n").map((line) => line.replace(`${root}/repo/`, "")) : []);
  const run = (env, ...args) =>
    spawnSync("sh", [join(root, "repo/scripts/install.sh"), ...args], {
      env: { PATH: `${dir}:/usr/bin:/bin`, HOME: root, HERDR_APP_HOME: join(root, "app"), FAIL_SCRIPT: "", ...env },
      encoding: "utf8",
    });
  return { log, run };
}

test("a full install checks Herdr, copies every mod, then builds the layout and shows it the first time", () => {
  const { root } = sandbox();
  const { log, run } = nodeShim(root);
  const first = run({});
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(root, "app/mods/demo/main.js")));
  assert.deepEqual(log(), ["scripts/herdr-version.mjs", "scripts/build-layout.mjs --switch"]);
  mkdirSync(join(root, "app/layouts"), { recursive: true });
  writeFileSync(join(root, "app/layouts/Argus.json"), "{}");
  assert.equal(run({}).status, 0);
  assert.deepEqual(log().slice(2), ["scripts/herdr-version.mjs", "scripts/build-layout.mjs"]);
});

test("an older Herdr stops the install before it copies anything", () => {
  const { root } = sandbox();
  const { log, run } = nodeShim(root);
  const r = run({ FAIL_SCRIPT: "herdr-version" });
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(root, "app/mods/demo")));
  assert.deepEqual(log(), ["scripts/herdr-version.mjs"]);
});

test("named mods and --no-layout skip the layout", () => {
  const { root } = sandbox();
  const { log, run } = nodeShim(root);
  assert.equal(run({}, "demo").status, 0);
  assert.equal(run({}, "--no-layout").status, 0);
  assert.deepEqual(log(), ["scripts/herdr-version.mjs", "scripts/herdr-version.mjs"]);
});

test("a full install without node says how to go on and copies nothing", () => {
  const { root, run } = sandbox();
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /node is needed/);
  assert.match(r.stderr, /--no-layout/);
  assert.ok(!existsSync(join(root, "app/mods/demo")));
  assert.equal(run("--no-layout").status, 0);
  assert.ok(existsSync(join(root, "app/mods/demo/main.js")));
});

test("--prune removes installed Argus mods that the repo no longer has, and nothing else", () => {
  const { root, run } = sandbox();
  const mods = join(root, "app/mods");
  mkdirSync(join(mods, "gone"), { recursive: true });
  writeFileSync(join(mods, "gone/.installed-from-argus"), "");
  mkdirSync(join(mods, "foreign"), { recursive: true });
  writeFileSync(join(mods, "foreign/main.js"), "mine");
  const r = run("--no-layout", "--prune");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removed gone/);
  assert.ok(!existsSync(join(mods, "gone")));
  assert.ok(existsSync(join(mods, "foreign/main.js")));
  assert.ok(existsSync(join(mods, "demo/main.js")));
});

test("--prune removes a link to a repo mod that no longer exists, and keeps other links", () => {
  const { root, run } = sandbox();
  const mods = join(root, "app/mods");
  mkdirSync(mods, { recursive: true });
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(join(root, "repo/mods/gone"), join(mods, "gone"));
  symlinkSync(elsewhere, join(mods, "away"));
  const r = run("--no-layout", "--prune");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removed gone/);
  assert.throws(() => lstatSync(join(mods, "gone")));
  assert.ok(lstatSync(join(mods, "away")).isSymbolicLink());
  assert.ok(existsSync(elsewhere));
});
