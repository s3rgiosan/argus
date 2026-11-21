import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commitProblems } from "../scripts/check-commits.mjs";

const scopes = ["argus-tsk", "lib", "scripts"];
const script = fileURLToPath(new URL("../scripts/check-commits.mjs", import.meta.url));

test("passes a scoped subject with a body", () => {
  assert.deepEqual(commitProblems("fix(argus-tsk): keep rows\n\nOld rows stay on bad output.\n", scopes), []);
});

test("passes a subject with no scope", () => {
  assert.deepEqual(commitProblems("docs: update readme\n", scopes), []);
});

test("passes git merge and fixup subjects", () => {
  assert.deepEqual(commitProblems("Merge branch 'main'\n", scopes), []);
  assert.deepEqual(commitProblems("fixup! fix(argus-tsk): keep rows\n", scopes), []);
});

test("refuses a plain subject", () => {
  assert.equal(commitProblems("Add an issues board\n", scopes).length, 1);
});

test("refuses an unknown type and an unknown scope", () => {
  const problems = commitProblems("feature(argus-nope): add\n", scopes);
  assert.equal(problems.length, 2);
});

test("refuses attribution lines anywhere", () => {
  const problems = commitProblems("feat(lib): add\n\nGenerated with Example Tool\n", scopes);
  assert.ok(problems.some((p) => p.includes("attribution")));
});

test("refuses a trailer paragraph", () => {
  const problems = commitProblems("feat(lib): add\n\nBody text.\n\nReviewed-by: Octo User\nSigned-off-by: Octo User\n", scopes);
  assert.ok(problems.some((p) => p.includes("trailer")));
});

test("keeps a body line with a colon in prose", () => {
  assert.deepEqual(commitProblems("feat(lib): add\n\nNote: this keeps the old rows.\nSecond line of prose.\n", scopes), []);
});

test("ignores comment lines git adds to the message file", () => {
  assert.deepEqual(commitProblems("fix(scripts): stage install\n# Please enter the commit message\n", scopes), []);
});

test("the --file mode exits 1 on a bad message and 0 on a good one", () => {
  const dir = mkdtempSync(join(tmpdir(), "argus-commit-"));
  const bad = join(dir, "bad");
  const good = join(dir, "good");
  writeFileSync(bad, "Add things\n");
  writeFileSync(good, "fix(scripts): stage install\n");
  assert.equal(spawnSync(process.execPath, [script, "--file", bad]).status, 1);
  assert.equal(spawnSync(process.execPath, [script, "--file", good]).status, 0);
});
