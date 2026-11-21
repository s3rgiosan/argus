import { test } from "node:test";
import assert from "node:assert/strict";
import { expandHome, tildePath } from "../lib/paths.js";

test("expandHome expands ~, trims and drops trailing slashes", () => {
  assert.equal(expandHome("~", "/home/u"), "/home/u");
  assert.equal(expandHome("~/x/", "/home/u"), "/home/u/x");
  assert.equal(expandHome(" /abs ", "/home/u"), "/abs");
  assert.equal(expandHome("/x/y", "/home/u"), "/x/y");
  assert.equal(expandHome("", "/home/u"), "");
  assert.equal(expandHome("/", "/home/u"), "/");
});

test("expandHome ignores a trailing slash on the home folder", () => {
  assert.equal(expandHome("~/x", "/home/u/"), "/home/u/x");
  assert.equal(expandHome("~", "/home/u/"), "/home/u");
});

test("tildePath shows the home folder as ~", () => {
  assert.equal(tildePath("/home/u/sites/example/wp-content", "/home/u"), "~/sites/example/wp-content");
  assert.equal(tildePath("/home/u", "/home/u"), "~");
  assert.equal(tildePath("/home/user2/site", "/home/u"), "/home/user2/site");
  assert.equal(tildePath("/tmp/example-site/wordpress/wp-content", "/home/u"), "/tmp/example-site/wordpress/wp-content");
  assert.equal(tildePath("/home/u/site", ""), "/home/u/site");
  assert.equal(tildePath("/home/u/site", "/home/u/"), "~/site");
});
