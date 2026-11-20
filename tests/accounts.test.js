import { test } from "node:test";
import assert from "node:assert/strict";
import { discover, visibleProfiles, expandHome, tildePath } from "../lib/accounts.js";

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

test("expandHome and tildePath", () => {
  assert.equal(expandHome("~", home), "/home/u");
  assert.equal(expandHome("~/a/", home), "/home/u/a");
  assert.equal(expandHome("/x/y", home), "/x/y");
  assert.equal(tildePath("/home/u/a", home), "~/a");
  assert.equal(tildePath("/other", home), "/other");
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
