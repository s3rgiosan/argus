import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/sync-lib.mjs", import.meta.url));

function repo({ lib = true, mods = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "argus-sync-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(script, join(root, "scripts/sync-lib.mjs"));
  if (lib) {
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "lib/ui.js"), "export const x = 1;\n");
  }
  if (mods) mkdirSync(join(root, "mods"));
  return root;
}
const run = (root, ...args) => spawnSync(process.execPath, [join(root, "scripts/sync-lib.mjs"), ...args], { encoding: "utf8" });

test("copies into a mod that imports with single quotes", () => {
  const root = repo();
  mkdirSync(join(root, "mods/m"));
  writeFileSync(join(root, "mods/m/main.js"), "import { x } from './ui.js';\n");
  assert.equal(run(root).status, 0);
  assert.equal(readFileSync(join(root, "mods/m/ui.js"), "utf8"), "export const x = 1;\n");
});

test("leaves a mod alone that does not import it", () => {
  const root = repo();
  mkdirSync(join(root, "mods/m"));
  writeFileSync(join(root, "mods/m/main.js"), "export default 1;\n");
  assert.equal(run(root).status, 0);
  assert.equal(existsSync(join(root, "mods/m/ui.js")), false);
});

test("missing lib or mods folder: clear message, no stack trace", () => {
  for (const options of [{ lib: false }, { mods: false }]) {
    const r = run(repo(options));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^sync-lib: no (lib|mods) folder/m);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
});

test("an orphan copy fails --check and only warns when copying", () => {
  const root = repo();
  mkdirSync(join(root, "mods/m"));
  writeFileSync(join(root, "mods/m/main.js"), "export default 1;\n");
  writeFileSync(join(root, "mods/m/ui.js"), "export const x = 1;\n");
  const checked = run(root, "--check");
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /mods\/m\/ui\.js/);
  const copied = run(root);
  assert.equal(copied.status, 0);
  assert.match(copied.stderr, /warning: mods\/m\/ui\.js/);
  assert.equal(existsSync(join(root, "mods/m/ui.js")), true);
});

test("copies a lib file that another used lib file imports", () => {
  const root = repo();
  writeFileSync(join(root, "lib/a.js"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(join(root, "lib/b.js"), "export const b = 1;\n");
  mkdirSync(join(root, "mods/m"));
  writeFileSync(join(root, "mods/m/main.js"), 'import { a } from "./a.js";\n');
  assert.equal(run(root).status, 0);
  assert.equal(readFileSync(join(root, "mods/m/b.js"), "utf8"), "export const b = 1;\n");
  assert.equal(existsSync(join(root, "mods/m/ui.js")), false);
  assert.equal(run(root, "--check").status, 0);
});
