import { test } from "node:test";
import assert from "node:assert/strict";
import { discover, discoveryIO, usageSettings, visibleProfiles } from "../lib/accounts.js";

const home = "/home/u";
const files = {
  "/home/u/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "me@example.com", organizationName: "", accountUuid: "a1" } }),
  "/home/u/.claude-work/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "w@example.com", organizationName: "Example Org", accountUuid: "a2" } }),
  "/home/u/.claude-zdupe/.claude.json": JSON.stringify({ oauthAccount: { accountUuid: "a2" } }),
  "/home/u/Claude Work/.claude.json": "not json",
};
const entries = [
  { name: ".claude", isDirectory: true },
  { name: ".claude-work", isDirectory: true },
  { name: ".claude-zdupe", isDirectory: true },
  { name: ".claude-old", isDirectory: true },
  { name: ".claude-notes", isDirectory: false },
  { name: ".claude.json.move-bak.123", isDirectory: false },
];
const io = { home, listHome: async () => entries, readText: async (p) => files[p] ?? null };

test("discovers every profile folder and skips non-profiles", async () => {
  const p = await discover(io, { extra: ["~/Claude Work/"] });
  assert.deepEqual(p.map((x) => [x.folder, x.isDefault, x.label]), [
    ["/home/u/.claude", true, "me@example.com"],
    ["/home/u/.claude-work", false, "Example Org"],
    ["/home/u/.claude-zdupe", false, "~/.claude-zdupe"],
    ["/home/u/Claude Work", false, "~/Claude Work"],
  ]);
  assert.equal(p[1].email, "w@example.com");
  assert.equal(p[3].email, null);
});

test("visibleProfiles drops hidden folders, then shows one folder per account", async () => {
  const all = await discover(io, { extra: [] });
  assert.deepEqual(visibleProfiles(all, [], home).map((x) => x.folder), ["/home/u/.claude", "/home/u/.claude-work"]);
  assert.deepEqual(visibleProfiles(all, ["~/.claude-work"], home).map((x) => x.folder), ["/home/u/.claude", "/home/u/.claude-zdupe"]);
  assert.deepEqual(visibleProfiles(all, ["~/.claude-work", "/home/u/.claude-zdupe/"], home).map((x) => x.folder), ["/home/u/.claude"]);
});

test("readFirst falls back when a reader rejects or returns null", async () => {
  const { readFirst } = await import("../lib/accounts.js");
  const fails = async () => { throw new Error("too big"); };
  const none = async () => null;
  const ok = async (p) => `text of ${p}`;
  assert.equal(await readFirst([fails, ok], "/a"), "text of /a");
  assert.equal(await readFirst([none, ok], "/a"), "text of /a");
  assert.equal(await readFirst([none, fails], "/a"), null);
});

test("discoveryIO lists the home folder and reads with the first reader that answers", async () => {
  const listed = discoveryIO({
    home: "/home/test",
    readdir: async (path, options) => {
      assert.equal(path, "/home/test");
      assert.deepEqual(options, { withFileTypes: true });
      return [{ name: ".claude-work", isDirectory: () => true }, { name: "notes.txt", isDirectory: () => false }];
    },
    readers: [async () => null, async (path) => `text of ${path}`],
  });
  assert.equal(listed.home, "/home/test");
  assert.deepEqual(await listed.listHome(), [{ name: ".claude-work", isDirectory: true }, { name: "notes.txt", isDirectory: false }]);
  assert.equal(await listed.readText("/home/test/.claude.json"), "text of /home/test/.claude.json");
  const failing = discoveryIO({ home: "/home/test", readdir: async () => { throw new Error("denied"); }, readers: [] });
  assert.deepEqual(await failing.listHome(), []);
  assert.equal(await failing.readText("/home/test/.claude.json"), null);
});

test("usageSettings keeps names, hidden and extra folders of the right type", () => {
  assert.deepEqual(usageSettings(undefined), { names: {}, hidden: [], extra: [] });
  assert.deepEqual(usageSettings({ names: { "~/.claude": "Example Org", "~/.claude-x": " ", "~/.claude-y": 3 }, hidden: ["~/.claude-old", 1], extra: "x" }), {
    names: { "~/.claude": "Example Org" },
    hidden: ["~/.claude-old"],
    extra: [],
  });
  assert.deepEqual(usageSettings({ names: ["x"] }).names, {});
});
