import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEMPLATE, CONFLICT, isDirty, revertStep, saveFailure, statusText } from "../mods/argus-settings/settings-logic.js";

test("TEMPLATE: the default toolbar display, with a final newline", () => {
  assert.deepEqual(JSON.parse(TEMPLATE), { toolbar: { display: "both" } });
  assert.ok(TEMPLATE.endsWith("}\n"));
});

test("isDirty: text that differs from the last read", () => {
  assert.equal(isDirty("{}", "{}"), false);
  assert.equal(isDirty("{ }", "{}"), true);
});

test("isDirty: with no file, only an edited template is dirty", () => {
  assert.equal(isDirty(TEMPLATE, null), false);
  assert.equal(isDirty("{}", null), true);
});

test("revertStep: asks first only when there are unsaved changes", () => {
  assert.equal(revertStep(false, false), "reload");
  assert.equal(revertStep(true, false), "ask");
  assert.equal(revertStep(true, true), "reload");
});

test("saveFailure: a file that changed, was made or was removed on disk", () => {
  assert.equal(saveFailure("a", "b", "stale"), CONFLICT);
  assert.equal(saveFailure(null, "b", "stale"), CONFLICT);
  assert.equal(saveFailure("a", null, "stale"), CONFLICT);
  assert.equal(CONFLICT, "argus.json changed on disk. Revert to load it, or copy your edits first.");
});

test("saveFailure: another error names its reason", () => {
  assert.equal(saveFailure("a", "a", "boom"), "Could not save argus.json (boom)");
});

const quiet = { base: "{}", dirty: false, asking: false, problems: [], saved: null, error: null };

test("statusText: nothing to say", () => {
  assert.deepEqual(statusText(quiet), { text: "", level: "dim" });
});

test("statusText: an error comes before the problems", () => {
  assert.deepEqual(statusText({ ...quiet, error: CONFLICT, problems: ["x"], dirty: true }), { text: CONFLICT, level: "error" });
});

test("statusText: the problems, one per line", () => {
  assert.deepEqual(statusText({ ...quiet, problems: ["one", "two"], dirty: true }), { text: "one\ntwo", level: "error" });
});

test("statusText: the ask before a revert comes first, even over an error", () => {
  const ask = { text: "Unsaved changes will be lost. Click Revert again to discard them.", level: "dim" };
  assert.deepEqual(statusText({ ...quiet, dirty: true, asking: true }), ask);
  assert.deepEqual(statusText({ ...quiet, dirty: true, asking: true, error: "x", problems: ["y"] }), ask);
});

test("statusText: a file that does not exist yet", () => {
  assert.deepEqual(statusText({ ...quiet, base: null, dirty: true }), { text: "argus.json does not exist yet. Save creates it.", level: "dim" });
});

test("statusText: unsaved changes, then the save time", () => {
  assert.deepEqual(statusText({ ...quiet, dirty: true }), { text: "Unsaved changes", level: "dim" });
  const saved = new Date(2026, 0, 2, 9, 5);
  assert.deepEqual(statusText({ ...quiet, saved }), { text: "Saved at 09:05", level: "dim" });
  assert.deepEqual(statusText({ ...quiet, saved, dirty: true }), { text: "Unsaved changes", level: "dim" });
});

test("argus-settings mod.json: the command palette opens the window", () => {
  const manifest = JSON.parse(readFileSync(new URL("../mods/argus-settings/mod.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.palette, [{ title: "Argus settings", command: "mod.open", args: { name: "argus-settings" }, words: "argus.json preferences" }]);
  assert.equal(manifest.place, "none");
});
