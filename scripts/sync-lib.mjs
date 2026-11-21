#!/usr/bin/env node
// Copies lib/*.js into every mod folder that uses it. Herdr loads a mod's
// modules from its own folder only, so each mod carries its own copy.
//
//   node scripts/sync-lib.mjs           copy
//   node scripts/sync-lib.mjs --check   exit 1 when a copy differs or a copy is not imported
//
// A mod uses a lib file when one of its own modules imports it, or when a lib
// file that the mod uses imports it.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
for (const folder of ["lib", "mods"]) {
  if (!existsSync(join(repo, folder))) {
    console.error(`sync-lib: no ${folder} folder in ${repo}`);
    process.exit(1);
  }
}

const libs = readdirSync(join(repo, "lib")).filter((name) => name.endsWith(".js"));
const libSources = new Map(libs.map((name) => [name, readFileSync(join(repo, "lib", name), "utf8")]));
const imports = (source, name) => source.includes(`"./${name}"`) || source.includes(`'./${name}'`);
const mods = readdirSync(join(repo, "mods"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

let stale = 0;
for (const mod of mods) {
  const sources = readdirSync(join(repo, "mods", mod), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && !libs.includes(entry.name))
    .map((entry) => readFileSync(join(repo, "mods", mod, entry.name), "utf8"));
  const used = new Set(libs.filter((name) => sources.some((source) => imports(source, name))));
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of libs) {
      if (used.has(name) || ![...used].some((user) => imports(libSources.get(user), name))) continue;
      used.add(name);
      grew = true;
    }
  }
  for (const name of libs) {
    if (!used.has(name)) {
      // A copy that no module of the mod imports is left in place.
      if (existsSync(join(repo, "mods", mod, name))) {
        console.error(`${check ? "" : "warning: "}mods/${mod}/${name} is not imported by the mod; remove it`);
        if (check) stale++;
      }
      continue;
    }
    const source = libSources.get(name);
    const target = join(repo, "mods", mod, name);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === source) continue;
    if (check) {
      console.error(`mods/${mod}/${name} differs from lib/${name}`);
      stale++;
    } else {
      writeFileSync(target, source);
      console.log(`copied lib/${name} -> mods/${mod}/${name}`);
    }
  }
}
process.exit(stale ? 1 : 0);
