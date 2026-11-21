import { test } from "node:test";
import assert from "node:assert/strict";
import { HERDR_ICONS, herdrIconPath, resolveIcon, iconResolver, probeIcons } from "../lib/icons.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

test("HERDR_ICONS lists the icons with the same geometry as Herdr's", () => {
  assert.deepEqual(HERDR_ICONS, ["chevron-left", "chevron-down", "chevron-right", "settings", "panel-right", "check", "x", "square-pen", "clock", "plus"]);
});

test("herdrIconPath points into the workspace-chrome mod", () => {
  assert.equal(herdrIconPath("settings"), "mods/workspace-chrome/settings.svg");
});

test("resolveIcon: Herdr's file when found, else the fallback", () => {
  const fallback = "mods/argus-tsk/icons/x.svg";
  assert.equal(resolveIcon(new Set(["x"]), "x", fallback), "mods/workspace-chrome/x.svg");
  assert.equal(resolveIcon(new Set(["check"]), "x", fallback), fallback);
  assert.equal(resolveIcon(new Set(), "x", fallback), fallback);
});

test("iconResolver: Herdr's icon for a found name, the mod's own file for the rest", () => {
  const icon = iconResolver("argus-tsk", new Set(["check"]));
  assert.equal(icon("check"), "mods/workspace-chrome/check.svg");
  assert.equal(icon("x"), "mods/argus-tsk/icons/x.svg");
  assert.equal(icon("pencil"), "mods/argus-tsk/icons/pencil.svg");
});

test("probeIcons reads each file once and keeps the names whose file is an svg", async () => {
  const reads = [];
  const read = async (path) => {
    reads.push(path);
    if (path.endsWith("/check.svg")) return SVG;
    if (path.endsWith("/x.svg")) return null;
    if (path.endsWith("/settings.svg")) throw new Error("denied");
    if (path.endsWith("/panel-right.svg")) return "not an image";
    if (path.endsWith("/chevron-left.svg")) return "";
    return SVG;
  };
  const found = await probeIcons(read, "/home/app");
  assert.deepEqual([...found].sort(), ["check", "chevron-down", "chevron-right", "clock", "plus", "square-pen"]);
  assert.equal(reads.length, 10);
  assert.ok(reads.every((path) => path.startsWith("/home/app/mods/workspace-chrome/")));
});

test("probeIcons: nothing found when the app home is empty or unknown", async () => {
  assert.equal((await probeIcons(async () => null, "/h")).size, 0);
  assert.equal((await probeIcons(async () => SVG, "")).size, 0);
  assert.equal((await probeIcons(async () => SVG, null)).size, 0);
});
