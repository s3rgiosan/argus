import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_NAME, LEGACY_NAME, planLayoutFile } from "../scripts/layout-build.mjs";

const ours = (...names) => (file) => names.includes(file);

test("the layout is named Argus and the old name is argus", () => {
  assert.equal(LAYOUT_NAME, "Argus");
  assert.equal(LEGACY_NAME, "argus");
});

test("a fresh folder: nothing to migrate or refuse", () => {
  assert.deepEqual(planLayoutFile(["main.json"], ours()), { migrate: false, removeLegacy: false, error: null });
});

test("a generated argus.json is migrated", () => {
  assert.deepEqual(planLayoutFile(["main.json", "argus.json"], ours("argus.json")), { migrate: true, removeLegacy: false, error: null });
});

test("an argus.json the script did not write is refused", () => {
  const plan = planLayoutFile(["argus.json"], ours());
  assert.equal(plan.migrate, false);
  assert.match(plan.error, /argus\.json/);
});

test("a generated Argus.json is rebuilt in place", () => {
  assert.deepEqual(planLayoutFile(["Argus.json"], ours("Argus.json")), { migrate: false, removeLegacy: false, error: null });
});

test("an Argus.json the script did not write is refused", () => {
  const plan = planLayoutFile(["Argus.json"], ours());
  assert.match(plan.error, /Argus\.json/);
});

test("both files on a case-sensitive disk: the generated old one is removed", () => {
  assert.deepEqual(planLayoutFile(["Argus.json", "argus.json"], ours("Argus.json", "argus.json")), { migrate: false, removeLegacy: true, error: null });
  assert.deepEqual(planLayoutFile(["Argus.json", "argus.json"], ours("Argus.json")), { migrate: false, removeLegacy: false, error: null });
});
