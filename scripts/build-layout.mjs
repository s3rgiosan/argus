#!/usr/bin/env node
// Writes the Argus layout: Herdr's shipped main layout plus a keep-awake
// button and a toolbar beside the tab bar and a panel column for the
// installed panel mods. Run it again after a Herdr update or after installing
// a mod.
//
//   node scripts/build-layout.mjs [--name Argus] [--switch]

import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout, panelsFromManifests, planLayoutFile, LAYOUT_NAME, LEGACY_NAME } from "./layout-build.mjs";

const MARKER = "argus";

const args = process.argv.slice(2);
let name = LAYOUT_NAME;
let switchTo = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--switch") switchTo = true;
  else if (args[i] === "--name" && args[i + 1]) name = args[++i];
  else {
    console.error("usage: node scripts/build-layout.mjs [--name Argus] [--switch]");
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

const isOurs = (file) => {
  try {
    return JSON.parse(readFileSync(join(layouts, file), "utf8"))?.generated_by === MARKER;
  } catch {
    return false;
  }
};

// The legacy file is renamed through a temporary name, so a case-insensitive
// disk never holds two files for one layout.
let plan = { migrate: false, removeLegacy: false, error: null };
if (name === LAYOUT_NAME) {
  plan = planLayoutFile(existsSync(layouts) ? readdirSync(layouts) : [], isOurs);
  if (plan.error) {
    console.error(`build-layout: ${plan.error}; nothing written`);
    process.exit(1);
  }
} else if (existsSync(target) && !isOurs(`${name}.json`)) {
  console.error(`build-layout: ${target} exists and was not written by this script; pick another --name`);
  process.exit(1);
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
  layout = buildLayout(main, panels, { stayAwake: existsSync(join(modsDir, "argus-stay-awake", "main.js")) });
} catch (error) {
  console.error(`build-layout: Herdr's main layout changed shape (${error.message}); nothing written`);
  process.exit(1);
}

if (plan.migrate) {
  const temp = join(layouts, `${LEGACY_NAME}.migrating.json`);
  renameSync(join(layouts, `${LEGACY_NAME}.json`), temp);
  renameSync(temp, target);
}
if (plan.removeLegacy) rmSync(join(layouts, `${LEGACY_NAME}.json`));

const preview = `layouts/${name}.svg`;
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "layouts", "Argus.svg"), join(layouts, `${name}.svg`));
writeFileSync(target, JSON.stringify({ ...layout, preview, generated_by: MARKER }, null, 2) + "\n");
console.log(`${name}: ${panels.length} panel(s): ${panels.map((p) => p.label).join(", ") || "none"}`);

// A shown layout that was just renamed would no longer exist, so show the new one.
let shown = null;
if (plan.migrate) {
  try {
    shown = JSON.parse(execFileSync("herdr-app", ["status"], { encoding: "utf8" })).layout;
  } catch {
    shown = null;
  }
}

if (switchTo || shown === LEGACY_NAME) {
  try {
    execFileSync("herdr-app", ["do", "layout.switch", JSON.stringify({ name })], { stdio: "inherit" });
  } catch (error) {
    const reason = error.code === "ENOENT" ? "herdr-app not found" : `herdr-app failed (${error.message})`;
    console.error(`build-layout: ${reason}; switch by hand: herdr-app do layout.switch '{"name":"${name}"}'`);
    process.exit(1);
  }
}
