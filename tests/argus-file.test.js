import { test } from "node:test";
import assert from "node:assert/strict";
import { agentAccounts, checkArgusFile } from "../lib/argus-file.js";

const HOME = "/home/test";

test("checkArgusFile: blank text and an empty object have no problems", () => {
  assert.deepEqual(checkArgusFile("", HOME), []);
  assert.deepEqual(checkArgusFile("  \n", HOME), []);
  assert.deepEqual(checkArgusFile("{}", HOME), []);
});

test("checkArgusFile: text that is not JSON gives one line", () => {
  const lines = checkArgusFile("{", HOME);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^argus\.json is not valid JSON \(/);
});

test("checkArgusFile: JSON that is not an object", () => {
  assert.deepEqual(checkArgusFile("[]", HOME), ["the file is not an object"]);
});

test("checkArgusFile: a bad toolbar display", () => {
  assert.deepEqual(checkArgusFile('{"toolbar":{"display":"big"}}', HOME), ['toolbar.display is not "icons", "labels" or "both"']);
});

test("checkArgusFile: a problem in each section gives one line each", () => {
  const text = JSON.stringify({ toolbar: { display: "big" }, pullRequests: { review: { instructions: 5 } } });
  assert.deepEqual(checkArgusFile(text, HOME), ['toolbar.display is not "icons", "labels" or "both"', "pullRequests.review.instructions is not text"]);
});

test("checkArgusFile: a full valid file has no problems", () => {
  const text = JSON.stringify({
    toolbar: { order: ["argus-tsk"], display: "icons" },
    pullRequests: { review: { instructions: "Example", promptFile: "~/prompt.md", accounts: { "~/.claude-work": { instructions: "Example" } } } },
  });
  assert.deepEqual(checkArgusFile(text, HOME), []);
});

test("checkArgusFile: a refused report folder is one problem", () => {
  assert.equal(checkArgusFile('{"pullRequests":{"review":{"reportFolders":[".git"]}}}', HOME).length, 1);
});

test("agentAccounts: maps account folders to programs.json keys", () => {
  const read = agentAccounts('{"agents":{"accounts":{"~/.claude-work":{"program":" claude-work "},"/opt/claude":{"program":"other"}}}}', HOME);
  assert.equal(read.error, null);
  assert.deepEqual({ ...read.accounts }, {
    "/home/test/.claude-work": { key: "~/.claude-work", program: "claude-work" },
    "/opt/claude": { key: "/opt/claude", program: "other" },
  });
  assert.deepEqual({ ...agentAccounts(null, HOME).accounts }, {});
  assert.deepEqual({ ...agentAccounts('{"toolbar":{}}', HOME).accounts }, {});
});

test("agentAccounts: refuses bad keys and entries", () => {
  const error = (accounts) => agentAccounts(JSON.stringify({ agents: { accounts } }), HOME).error;
  assert.equal(agentAccounts('{"agents":{"accounts":[]}}', HOME).error, "agents.accounts is not an object");
  assert.match(String(error({ "": { program: "x" } })), /empty key/);
  assert.match(String(error({ "relative/dir": { program: "x" } })), /absolute or ~\/ folder/);
  assert.match(String(error({ "~/.claude-work": { program: "x" }, "/home/test/.claude-work": { program: "y" } })), /same account folder/);
  assert.match(String(error({ "~/.claude-work": "claude-work" })), /is not an object/);
  assert.match(String(error({ "~/.claude-work": { program: "" } })), /program is empty/);
  assert.match(String(error({ "~/.claude-work": { program: 3 } })), /program is not text/);
  assert.equal(checkArgusFile('{"agents":{"accounts":{"rel":{"program":"x"}}}}', HOME).length, 1);
});
