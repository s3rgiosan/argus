import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, lstatSync, symlinkSync } from "node:fs";
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
