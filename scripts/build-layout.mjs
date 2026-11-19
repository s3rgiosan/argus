#!/usr/bin/env node
// Writes the argus layout: Herdr's shipped main layout plus a keep-awake
// button and a toolbar beside the tab bar and a panel column for the
// installed panel mods. Run it again after a Herdr update or after installing
// a mod.
//
//   node scripts/build-layout.mjs [--name argus] [--switch]

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildLayout, panelsFromManifests } from "./layout-build.mjs";

const MARKER = "argus";

const args = process.argv.slice(2);
let name = "argus";
let switchTo = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--switch") switchTo = true;
  else if (args[i] === "--name" && args[i + 1]) name = args[++i];
  else {
    console.error("usage: node scripts/build-layout.mjs [--name argus] [--switch]");
    process.exit(2);
  }
}
if (!/^[\w-]+$/.test(name) || ["main", "terminals", "win98"].includes(name)) {
  console.error(`build-layout: invalid layout name: ${name}`);
  process.exit(2);
}

const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const layouts = join(appHome, "layouts");
const target = join(layouts, `${name}.json`);

if (existsSync(target)) {
  let current = null;
  try {
    current = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    current = null;
  }
  if (current?.generated_by !== MARKER) {
    console.error(`build-layout: ${target} exists and was not written by this script; pick another --name`);
    process.exit(1);
  }
}

const mainPath = join(layouts, "main.json");
let main;
try {
  main = JSON.parse(readFileSync(mainPath, "utf8"));
} catch (error) {
  console.error(`build-layout: cannot read ${mainPath}: ${error.message}`);
  process.exit(1);
}

const modsDir = join(appHome, "mods");
if (!existsSync(join(modsDir, "argus-toolbar", "main.js"))) {
  console.error("build-layout: install the toolbar first: sh scripts/install.sh argus-toolbar");
  process.exit(1);
}

const entries = readdirSync(modsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    try {
      return { name: entry.name, manifest: JSON.parse(readFileSync(join(modsDir, entry.name, "mod.json"), "utf8")) };
    } catch {
      return { name: entry.name, manifest: {} };
    }
  });
const panels = panelsFromManifests(entries);

let layout;
try {
  layout = buildLayout(main, panels, { awake: existsSync(join(modsDir, "argus-awake", "main.js")) });
} catch (error) {
  console.error(`build-layout: Herdr's main layout changed shape (${error.message}); nothing written`);
  process.exit(1);
}

writeFileSync(target, JSON.stringify({ ...layout, generated_by: MARKER }, null, 2) + "\n");
console.log(`${name}: ${panels.length} panel(s): ${panels.map((p) => p.label).join(", ") || "none"}`);

if (switchTo) {
  try {
    execFileSync("herdr-app", ["do", "layout.switch", JSON.stringify({ name })], { stdio: "inherit" });
  } catch (error) {
    const reason = error.code === "ENOENT" ? "herdr-app not found" : `herdr-app failed (${error.message})`;
    console.error(`build-layout: ${reason}; switch by hand: herdr-app do layout.switch '{"name":"${name}"}'`);
    process.exit(1);
  }
}
