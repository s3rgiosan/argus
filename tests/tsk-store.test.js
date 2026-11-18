import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStamp, stampArgs, storeChanged } from "../mods/argus-tsk/store.js";

test("stampArgs asks a shell for the data file's modification time and size", () => {
  const [command, args] = stampArgs("/tmp/example-store");
  assert.equal(command, "/bin/sh");
  assert.equal(args[0], "-c");
  assert.match(args[1], /stat -f "%Fm %z" "\$1"/);
  assert.match(args[1], /stat -c "%\.9Y %s" "\$1"/);
  // The path is an argument, never part of the script text.
  assert.equal(args[2], "sh");
  assert.equal(args[3], "/tmp/example-store/tsk.json");
  assert.ok(!args[1].includes("example-store"));
});

test("parseStamp keeps the first line of a successful stat, else null", () => {
  assert.equal(parseStamp({ code: 0, stdout: "1700000000.123456789 741\n" }), "1700000000.123456789 741");
  assert.equal(parseStamp({ code: 1, stdout: "" }), null);
  assert.equal(parseStamp({ code: 0, stdout: "  \n" }), null);
  assert.equal(parseStamp(null), null);
});

test("storeChanged is false only when both stamps are known and equal", () => {
  assert.equal(storeChanged("1700000000.1 741", "1700000000.1 741"), false);
  assert.equal(storeChanged("1700000000.1 741", "1700000000.2 741"), true);
  assert.equal(storeChanged("1700000000.1 741", "1700000000.1 742"), true);
  assert.equal(storeChanged(null, "1700000000.1 741"), true);
  assert.equal(storeChanged("1700000000.1 741", null), true);
  assert.equal(storeChanged(null, null), true);
});
