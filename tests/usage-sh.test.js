import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, utimesSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = fileURLToPath(new URL("../mods/argus-claude-usage/usage.sh", import.meta.url));
const fake = (name) => fileURLToPath(new URL(`./fake-claude/${name}`, import.meta.url));
const run = (args, env) =>
  spawnSync("sh", [script, ...args], { env: { TMPDIR: process.env.TMPDIR ?? "/tmp", ...env }, encoding: "utf8", timeout: 20_000 });

test("prints the control_response line", () => {
  const r = run([], { PATH: `${fake("answer")}:/usr/bin:/bin`, CLAUDE_CONFIG_DIR: "/tmp/Claude Work" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{"type":"control_response","dir":"/tmp/Claude Work"}');
});

test("explicit command argument", () => {
  const r = run([`${fake("answer")}/claude`], { PATH: "/usr/bin:/bin" });
  assert.equal(r.status, 0);
});

test("times out with exit 1", () => {
  const r = run([], { PATH: `${fake("silent")}:/usr/bin:/bin`, CLAUDE_USAGE_TIMEOUT: "2" });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

test("a claude that ignores TERM is still stopped", () => {
  const started = Date.now();
  const r = run([], { PATH: `${fake("stubborn")}:/usr/bin:/bin`, CLAUDE_USAGE_TIMEOUT: "1" });
  assert.equal(r.status, 1);
  assert.ok(Date.now() - started < 8_000, "usage.sh must not wait for a stubborn claude");
});

test("missing claude exits 127", () => {
  const r = run([], { PATH: "/usr/bin:/bin" });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /claude not found/);
});

test("removes its own stale temp folders", () => {
  const tmp = mkdtempSync(join(tmpdir(), "argus-usage-tmp-"));
  const stale = join(tmp, "argus-claude-usage.stale1");
  mkdirSync(stale);
  const old = new Date(Date.now() - 3 * 3_600_000);
  utimesSync(stale, old, old);
  const other = join(tmp, "someone-else.keep");
  mkdirSync(other);
  utimesSync(other, old, old);
  const r = spawnSync("sh", [script], { env: { TMPDIR: tmp, PATH: `${fake("answer")}:/usr/bin:/bin` }, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(other), true);
});

test("a claude that exits at once ends with exit 1 and leaves no temp folder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "argus-usage-tmp-"));
  const r = spawnSync("sh", [script], { env: { TMPDIR: tmp, PATH: `${fake("exits")}:/usr/bin:/bin` }, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.deepEqual(readdirSync(tmp), []);
});
