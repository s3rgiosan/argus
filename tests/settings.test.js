import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, toggleHidden, addExtra, removeExtra, isHidden, DEFAULTS } from "../mods/argus-claude-usage/settings.js";

const home = "/home/u";

test("normalizeSettings fills defaults and drops bad values", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  assert.deepEqual(normalizeSettings({ hidden: ["~/a", 3], extra: "x", interval: 7, claude: 5 }), { hidden: ["~/a"], extra: [], interval: 5, claude: "", names: {} });
  assert.equal(normalizeSettings({ interval: 15 }).interval, 15);
});

test("toggleHidden adds then removes, matching ~ and full paths", () => {
  const once = toggleHidden(DEFAULTS, "/home/u/.claude-work", home);
  assert.deepEqual(once.hidden, ["~/.claude-work"]);
  assert.equal(isHidden(once, "/home/u/.claude-work", home), true);
  assert.deepEqual(toggleHidden({ ...DEFAULTS, hidden: ["/home/u/.claude-work/"] }, "/home/u/.claude-work", home).hidden, []);
});

test("addExtra trims and ignores empty and duplicate folders", () => {
  let s = addExtra(DEFAULTS, "  ~/Claude Work/ ", home);
  assert.deepEqual(s.extra, ["~/Claude Work"]);
  s = addExtra(s, "/home/u/Claude Work", home);
  assert.deepEqual(s.extra, ["~/Claude Work"]);
  assert.equal(addExtra(s, "   ", home), s);
});

test("removeExtra", () => {
  assert.deepEqual(removeExtra({ ...DEFAULTS, extra: ["~/a", "~/b"] }, "~/a").extra, ["~/b"]);
});

test("setName stores a trimmed name under the ~ path, empty clears it", async () => {
  const { setName } = await import("../mods/argus-claude-usage/settings.js");
  const named = setName(DEFAULTS, "/home/u/.claude-work", "  Work ", home);
  assert.deepEqual(named.names, { "~/.claude-work": "Work" });
  assert.deepEqual(setName(named, "/home/u/.claude-work", "", home).names, {});
});

test("normalizeSettings keeps string names only", () => {
  assert.deepEqual(normalizeSettings({ names: { "~/a": "A", "~/b": 3, "~/c": " " } }).names, { "~/a": "A" });
  assert.deepEqual(normalizeSettings(null).names, {});
});

test("pendingMoves copies old keys that the new names do not have yet", async () => {
  const { pendingMoves } = await import("../mods/argus-claude-usage/settings.js");
  const store = { "claude-usage.settings": { interval: 15 }, "claude-usage.folded": ["/a"], "argus-claude-usage.folded": ["/b"] };
  const moves = pendingMoves((key) => store[key], "claude-usage.", "argus-claude-usage.", ["settings", "folded", "alerts"]);
  assert.deepEqual(moves, [["argus-claude-usage.settings", { interval: 15 }]]);
});

test("pendingMoves treats a null read as a missing key", async () => {
  const { pendingMoves } = await import("../mods/argus-claude-usage/settings.js");
  const store = { "claude-usage.settings": { interval: 15 } };
  const moves = pendingMoves((key) => store[key] ?? null, "claude-usage.", "argus-claude-usage.", ["settings", "alerts"]);
  assert.deepEqual(moves, [["argus-claude-usage.settings", { interval: 15 }]]);
});

test("addExtra ignores a relative path", () => {
  assert.equal(addExtra(DEFAULTS, "projects/claude", home), DEFAULTS);
  assert.equal(addExtra(DEFAULTS, "$HOME/.claude-x", home), DEFAULTS);
  assert.deepEqual(addExtra(DEFAULTS, "/opt/claude", home).extra, ["/opt/claude"]);
});
