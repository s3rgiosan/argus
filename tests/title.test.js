import { test } from "node:test";
import assert from "node:assert/strict";
import { accountTitle } from "../mods/argus-claude-usage/title.js";

const home = "/home/u";
const work = { folder: "/home/u/.claude-work", isDefault: false, label: "Example Org" };

test("accountTitle uses the name from settings, else the profile label", () => {
  assert.equal(accountTitle(work, {}, home), "Example Org");
  assert.equal(accountTitle(work, { "~/.claude-work": " Work " }, home), "Work");
  assert.equal(accountTitle(work, { "/home/u/.claude-work": "Job" }, home), "Job");
  assert.equal(accountTitle(work, { "~/.claude-work": "  " }, home), "Example Org");
});
