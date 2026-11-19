// Builds Argus's copy of Herdr's sidebar mod. The copy shows each space with no
// repo or branch text after its name; the ahead and behind counts stay.

/** The folder name of the copy in Herdr's mods folder. */
export const SIDEBAR = "argus-spaces";

/** The shipped mod the copy is made from. */
export const SHIPPED_SIDEBAR = "spaces";

const MARKER = "argus";

const METHOD = /^(\s*)gitTail\(/gm;
const WHERE = /^(\s*)const where = (.+);$/gm;

/** Herdr's sidebar no longer has the lines the patch changes. */
export class SidebarError extends Error {
  constructor(reason) {
    super(`Herdr's sidebar changed (${reason})`);
    this.name = "SidebarError";
  }
}

/**
 * Herdr's sidebar source with the repo and branch text left out: the `where`
 * line of `gitTail` becomes an empty string.
 *
 * @param {string} source The shipped `mods/spaces/main.js`.
 * @returns {string}
 * @throws {SidebarError} When `gitTail`, its single `const where` line or its ahead and behind counts are not found.
 */
export function patchSidebar(source) {
  const methods = [...source.matchAll(METHOD)];
  if (methods.length !== 1) throw new SidebarError(`expected one gitTail method, found ${methods.length}`);
  const start = methods[0].index;
  // The method ends at the first line that closes a block at the method's own indent.
  const close = source.indexOf(`\n${methods[0][1]}}`, start);
  if (close < 0) throw new SidebarError("gitTail has no end");
  const body = source.slice(start, close);
  if (!body.includes("g.ahead") || !body.includes("g.behind")) throw new SidebarError("gitTail shows no ahead and behind counts");
  const wheres = [...body.matchAll(WHERE)];
  if (wheres.length !== 1) throw new SidebarError(`expected one "const where =" line in gitTail, found ${wheres.length}`);

  const [line, indent] = wheres[0];
  const at = start + wheres[0].index;
  const patched = `${indent}// Argus leaves out the repo and branch text; the ahead and behind counts stay.\n${indent}const where = "";`;
  return source.slice(0, at) + patched + source.slice(at + line.length);
}

/**
 * The copy's `mod.json`: the shipped one, renamed, with a marker that says this
 * script owns the folder.
 *
 * @param {object} shipped The shipped `mods/spaces/mod.json`.
 * @returns {object}
 */
export function sidebarManifest(shipped) {
  const title = typeof shipped?.title === "string" && shipped.title !== "" ? shipped.title : "Spaces";
  return { ...shipped, title: `${title} (Argus)`, generated_by: MARKER };
}

/**
 * True when a mod folder holds a copy this script wrote, so it may be replaced.
 *
 * @param {object | null} manifest The folder's `mod.json`, or null when it has none.
 * @returns {boolean}
 */
export function ownsSidebar(manifest) {
  return manifest?.generated_by === MARKER;
}

/**
 * A copy of `layout` where every block that shows the shipped sidebar shows `mod`.
 *
 * @param {object} layout
 * @param {string} mod
 * @returns {object}
 */
export function useSidebar(layout, mod) {
  const out = structuredClone(layout);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.content?.mod === SHIPPED_SIDEBAR) node.content.mod = mod;
    for (const child of node.children ?? []) visit(child);
  };
  visit(out);
  return out;
}
