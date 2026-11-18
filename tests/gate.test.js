import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../mods/argus-claude-usage/gate.js";

test("a request during a run is kept and runs once more", () => {
  const gate = createGate();
  assert.equal(gate.start(), true);
  assert.equal(gate.start(), false);
  assert.equal(gate.start(), false);
  assert.equal(gate.finish(), true);
  assert.equal(gate.start(), true);
  assert.equal(gate.finish(), false);
});
