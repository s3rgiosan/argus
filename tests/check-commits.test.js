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

const SCISSORS = "# ------------------------ >8 ------------------------";

test("ignores the diff after the scissors line", () => {
  const message = `fix(scripts): stage install\n\n# Please enter the commit message\n#\n${SCISSORS}\n# Do not modify or remove the line above.\n# Everything below it will be ignored.\ndiff --git a/f b/f\n+generated with x\n+Signed-off-by: Octo User\n`;
  assert.deepEqual(commitProblems(message, scopes), []);
});

test("ignores the diff after a scissors line with another comment character", () => {
  const message = `fix(scripts): stage install\n\n; Please enter the commit message\n;\n; ------------------------ >8 ------------------------\n; Everything below it will be ignored.\ndiff --git a/f b/f\n+generated with x\n`;
  assert.deepEqual(commitProblems(message, scopes), []);
});

test("ignores comment lines with another comment character", () => {
  assert.deepEqual(commitProblems("fix(scripts): stage install\n\n; On branch main\n; ------------------------ >8 ------------------------\n+x\n", scopes), []);
});

test("still refuses attribution above the scissors line", () => {
  const message = `fix(scripts): stage install\n\nGenerated with Example Tool\n${SCISSORS}\ndiff\n`;
  assert.equal(commitProblems(message, scopes).length, 1);
});

test("keeps a one-line body that starts with a word and a colon", () => {
  assert.deepEqual(commitProblems("feat(lib): add\n\nNote: this is a one-line body.\n", scopes), []);
  assert.deepEqual(commitProblems("feat(lib): add\n\nBody text.\n\nNote: this is a one-line body.\n", scopes), []);
});

test("refuses a one-line trailer with a known single-word key", () => {
  assert.ok(commitProblems("fix(lib): add\n\nBody.\n\nFixes: #12\n", scopes).some((p) => p.includes("trailer")));
  assert.ok(commitProblems("fix(lib): add\n\nCloses: #12\nRefs: #13\n", scopes).some((p) => p.includes("trailer")));
});

test("refuses a trailer paragraph with a wrapped continuation line", () => {
  const message = "feat(lib): add\n\nBody.\n\nSigned-off-by: Octo User\nChange-Id: I123\n  continued here\n";
  assert.ok(commitProblems(message, scopes).some((p) => p.includes("trailer")));
});

test("keeps a paragraph whose first line is not a trailer", () => {
  assert.deepEqual(commitProblems("feat(lib): add\n\nSome prose here.\n  Signed-off-by: Octo User\n", scopes), []);
});

test("passes git revert subjects", () => {
  assert.deepEqual(commitProblems('Revert "feat(lib): add"\n\nThis reverts commit abc123.\n', scopes), []);
});
