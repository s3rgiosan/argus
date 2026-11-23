import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArgusFile } from "../lib/argus-file.js";

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
