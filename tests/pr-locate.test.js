import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings } from "../mods/argus-pull-requests/locate.js";

test("normalizeSettings defaults", () => {
  assert.deepEqual(normalizeSettings(null), { gh: "", glab: "", interval: 3, conversation: "oldest" });
});

test("normalizeSettings rejects an interval outside the choices", () => {
  assert.equal(normalizeSettings({ interval: 4 }).interval, 3);
});

test("normalizeSettings keeps a valid interval and trims commands", () => {
  const s = normalizeSettings({ interval: 10, gh: " ~/bin/gh " });
  assert.equal(s.interval, 10);
  assert.equal(s.gh, "~/bin/gh");
});

test("normalizeSettings keeps a known conversation order only", () => {
  assert.equal(normalizeSettings({ conversation: "newest" }).conversation, "newest");
  assert.equal(normalizeSettings({ conversation: "sideways" }).conversation, "oldest");
});

