import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { herdrRefusal, MIN_HERDR } from "../scripts/herdr-version.mjs";

test("herdrRefusal: an older Herdr is refused, the same or a newer one passes", () => {
  assert.match(String(herdrRefusal("0.1.18", "herdr-app 0.1.17")), /^Argus needs Herdr 0\.1\.18 or later; this is 0\.1\.17\./);
  assert.equal(herdrRefusal("0.1.18", "herdr-app 0.1.18"), null);
  assert.equal(herdrRefusal("0.1.18", "herdr-app 0.2.0"), null);
  assert.equal(herdrRefusal("0.1.18", "herdr-app 0.1.18-rc1"), null);
});

test("herdrRefusal: a version it cannot read is no refusal", () => {
  assert.equal(herdrRefusal("0.1.18", ""), null);
  assert.equal(herdrRefusal("0.1.18", "herdr-app unknown"), null);
});

test("MIN_HERDR comes from package.json, and the README requirement line matches it", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(MIN_HERDR, pkg.herdr);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`- Herdr desktop app ${pkg.herdr} or later`));
});
