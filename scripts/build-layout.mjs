#!/usr/bin/env node
// Writes the Argus layout: Herdr's shipped main layout plus a keep-awake
// button and a toolbar beside the tab bar, a panel column for the installed
// panel mods, and Argus's copies of the pane header (`argus-pane`) and the
// sidebar (`argus-spaces`). Run it again after a Herdr update or after installing
// a mod.
//
//   node scripts/build-layout.mjs [--name Argus] [--switch]

import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, rmSync, mkdirSync, mkdtempSync, statSync, lstatSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toolbarSettings } from "../lib/argus-file.js";
import { PANE_HEADER, SHIPPED_HEADER, PaneHeaderError, ownsHeader, paneHeaderManifest, patchPaneHeader, useHeader } from "./pane-header.mjs";
import { GROUP_FILES, GroupsError, SIDEBAR, SHIPPED_SIDEBAR, SidebarError, addGroups, ownsSidebar, sidebarManifest, patchSidebar, useSidebar } from "./sidebar.mjs";
import { AGENT_LIST, AGENT_LIST_FILES, AgentListError, SHIPPED_AGENT_LIST, addAccountHooks, agentListManifest, ownsAgentList, useAgentList } from "./agent-list.mjs";
import { buildLayout, panelsFromManifests, planLayoutFile, planStateFile, ArgusBlocksError, LAYOUT_NAME, LEGACY_NAME } from "./layout-build.mjs";

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

/** Renames through a temporary name so a case-only rename works; puts the file back when the second step fails. */
function moveViaTemp(from, to, temp) {
  renameSync(from, temp);
  try {
    renameSync(temp, to);
  } catch (error) {
    try {
      renameSync(temp, from);
    } catch {
      // The temporary file stays; its name says what it is.
    }
    throw error;
  }
}

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
/** The root of this repo, where the extra files of a copy come from. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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

// The toolbar's first width follows the display set in argus.json; the toolbar mod measures it again once it shows.
let argusText = null;
try {
  argusText = readFileSync(join(appHome, "argus.json"), "utf8");
} catch {
  argusText = null;
}
const settings = toolbarSettings(argusText);
if (settings.error !== null) console.error(`build-layout: argus.json: ${settings.error}; an invalid setting uses its default`);

let layout;
try {
  layout = buildLayout(main, panels, { stayAwake: existsSync(join(modsDir, "argus-stay-awake", "main.js")), display: settings.display });
} catch (error) {
  const reason = error instanceof ArgusBlocksError ? error.message : `Herdr's main layout changed shape (${error.message})`;
  console.error(`build-layout: ${reason}; nothing written`);
  process.exit(1);
}

if (name === LAYOUT_NAME) {
  try {
    if (plan.migrate) moveViaTemp(join(layouts, `${LEGACY_NAME}.json`), target, join(layouts, `${LEGACY_NAME}.migrating.json`));
    const state = join(layouts, ".state");
    const statePlan = planStateFile({
      legacy: existsSync(join(state, `${LEGACY_NAME}.json`)),
      target: existsSync(join(state, `${LAYOUT_NAME}.json`)),
    });
    if (statePlan.migrate) moveViaTemp(join(state, `${LEGACY_NAME}.json`), join(state, `${LAYOUT_NAME}.json`), join(state, `${LEGACY_NAME}.migrating.json`));
  } catch (error) {
    console.error(`build-layout: cannot rename the earlier layout (${error.message}); nothing changed`);
    process.exit(1);
  }
}
if (plan.removeLegacy) rmSync(join(layouts, `${LEGACY_NAME}.json`));

/** Reads a JSON file, or null when it is missing or does not parse. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The first error line of `node --check` for an ES module source, or null when it parses.
 * @param {string} source
 * @returns {string | null}
 */
function syntaxError(source) {
  const dir = mkdtempSync(join(tmpdir(), "argus-pane-"));
  try {
    const file = join(dir, "main.mjs");
    writeFileSync(file, source);
    const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (check.status === 0) return null;
    return (check.stderr.split("\n").find((line) => /Error/.test(line)) ?? "node --check failed").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes a file through a temporary file in the same folder, so a cut-off write
 * never leaves a half-written file at `path`.
 * @param {string} path
 * @param {string} text
 */
function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Writes an Argus copy of a shipped mod again from the shipped files, so a Herdr
 * update reaches it on the next run. A missing shipped mod writes nothing and is
 * no error. The copy's folder may be missing, empty, or one this script wrote.
 * An `extend` step adds more to the patched source and writes its `files`
 * (copy path to repo path) next to `main.js`. When it does not apply, the copy
 * is written without it and `warning` says why.
 * @param {{ shipped: string, copy: string, what: string, patch: (source: string) => string,
 *   manifest: (shipped: object) => object, owns: (manifest: object | null) => boolean, PatchError: Function,
 *   extend?: { apply: (source: string) => string, files: Record<string, string>, PatchError: Function } }} spec
 * @returns {{ written: boolean, error: string | null, warning?: string | null }}
 */
function writeCopy({ shipped, copy: name, what, patch, manifest, owns, PatchError, extend }) {
  let source;
  try {
    source = readFileSync(join(modsDir, shipped, "main.js"), "utf8");
  } catch {
    return { written: false, error: null };
  }
  const copy = join(modsDir, name);
  let linked = false;
  try {
    linked = lstatSync(copy).isSymbolicLink();
  } catch {
    linked = false;
  }
  if (linked) return { written: false, error: `${copy} is a symbolic link` };
  if (existsSync(copy)) {
    let empty;
    try {
      empty = statSync(copy).isDirectory() && readdirSync(copy).length === 0;
    } catch (error) {
      return { written: false, error: `cannot read ${copy} (${error.message})` };
    }
    if (!empty && !owns(readJson(join(copy, "mod.json")))) {
      return { written: false, error: `${copy} exists and was not written by this script` };
    }
  }
  let patched;
  try {
    patched = patch(source);
  } catch (error) {
    if (error instanceof PatchError) return { written: false, error: error.message };
    throw error;
  }
  const parse = syntaxError(patched);
  if (parse !== null) return { written: false, error: `the patched ${what} does not parse (${parse})` };
  const extended = extend ? extendCopy(patched, extend) : { source: patched, files: {}, warning: null };
  try {
    mkdirSync(copy, { recursive: true });
    // mod.json goes first: its marker lets the next run repair a copy that stopped half way.
    writeAtomic(join(copy, "mod.json"), JSON.stringify(manifest(readJson(join(modsDir, shipped, "mod.json")) ?? {}), null, 2) + "\n");
    // The extra files go before main.js, because main.js imports them.
    for (const [path, text] of Object.entries(extended.files)) {
      mkdirSync(dirname(join(copy, path)), { recursive: true });
      writeAtomic(join(copy, path), text);
    }
    writeAtomic(join(copy, "main.js"), extended.source);
  } catch (error) {
    return { written: false, error: `cannot write ${copy} (${error.message})` };
  }
  return { written: true, error: null, warning: extended.warning };
}

/**
 * The patched source with the `extend` step and the text of its files, or the
 * patched source alone and a warning when the step or a file fails.
 * @param {string} patched
 * @param {{ apply: (source: string) => string, files: Record<string, string>, PatchError: Function }} extend
 * @returns {{ source: string, files: Record<string, string>, warning: string | null }}
 */
function extendCopy(patched, { apply, files, PatchError }) {
  const without = (warning) => ({ source: patched, files: {}, warning });
  let source;
  try {
    source = apply(patched);
  } catch (error) {
    if (error instanceof PatchError) return without(error.message);
    throw error;
  }
  const parse = syntaxError(source);
  if (parse !== null) return without(`the extended copy does not parse (${parse})`);
  const texts = {};
  for (const [path, from] of Object.entries(files)) {
    try {
      texts[path] = readFileSync(join(repoRoot, from), "utf8");
    } catch (error) {
      return without(`cannot read ${from} (${error.message})`);
    }
  }
  return { source, files: texts, warning: null };
}

const copies = [
  {
    spec: { shipped: SHIPPED_HEADER, copy: PANE_HEADER, what: "pane header", patch: patchPaneHeader, manifest: paneHeaderManifest, owns: ownsHeader, PatchError: PaneHeaderError },
    use: (out) => useHeader(out, PANE_HEADER),
  },
  {
    spec: {
      shipped: SHIPPED_SIDEBAR,
      copy: SIDEBAR,
      what: "sidebar",
      patch: patchSidebar,
      manifest: sidebarManifest,
      owns: ownsSidebar,
      PatchError: SidebarError,
      extend: { apply: addGroups, files: GROUP_FILES, PatchError: GroupsError },
    },
    warning: "the sidebar has no groups",
    use: (out) => useSidebar(out, SIDEBAR),
  },
  {
    spec: {
      shipped: SHIPPED_AGENT_LIST,
      copy: AGENT_LIST,
      what: "agents list",
      // The copy is Herdr's file as it is; the account hooks are the extend step.
      patch: (source) => source,
      manifest: agentListManifest,
      owns: ownsAgentList,
      PatchError: AgentListError,
      extend: { apply: addAccountHooks, files: AGENT_LIST_FILES, PatchError: AgentListError },
    },
    warning: "the agents list shows Herdr's icons",
    use: (out) => useAgentList(out, AGENT_LIST),
  },
];
for (const { spec, use, warning } of copies) {
  const result = writeCopy(spec);
  if (result.error !== null) console.error(`build-layout: ${result.error}; the layout uses Herdr's ${spec.what}`);
  if (result.warning) console.error(`build-layout: ${result.warning}; ${warning}`);
  if (result.written) layout = use(layout);
}

const preview = `layouts/${name}.svg`;
writeAtomic(join(layouts, `${name}.svg`), readFileSync(join(repoRoot, "layouts", "Argus.svg"), "utf8"));
writeAtomic(target, JSON.stringify({ ...layout, preview, generated_by: MARKER }, null, 2) + "\n");
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
