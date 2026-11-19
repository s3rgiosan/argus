// Builds Argus's copy of Herdr's pane header mod. The copy shows, for a mod
// pane, the title that mod shares under `<mod>.paneTitle`, so a detail pane
// reads "T12 · Fix the parser" in place of the mod's folder name.

/** The folder name of the copy in Herdr's mods folder. */
export const PANE_HEADER = "argus-pane";

/** The shipped mod the copy is made from. */
export const SHIPPED_HEADER = "pane";

const MARKER = "argus";

const IMPORT = /^import \{([^}]*)\} from "herdr";$/m;
// The indent is spaces and tabs only, so a blank line before the match stays out of it.
const NAME = /^([ \t]*)const name = (.+);$/gm;

const HELPER = `
// The title a mod shares for its own panes under \`<mod>.paneTitle\`, or null.
function paneTitle(p) {
  if (!p.mod) return null;
  const title = shared(\`\${p.mod}.paneTitle\`);
  return typeof title === "string" && title !== "" ? title : null;
}
`;

/** Herdr's pane header no longer has the lines the patch changes. */
export class PaneHeaderError extends Error {
  constructor(reason) {
    super(`Herdr's pane header changed (${reason})`);
    this.name = "PaneHeaderError";
  }
}

/**
 * Herdr's pane header source with the title patch: the `herdr` import adds
 * `shared`, and the `name` line puts the shared title of a mod pane first.
 *
 * @param {string} source The shipped `mods/pane/main.js`.
 * @returns {string}
 * @throws {PaneHeaderError} When the `herdr` import or a single `const name` line is not found.
 */
export function patchPaneHeader(source) {
  const imports = source.match(IMPORT);
  if (!imports) throw new PaneHeaderError('no import from "herdr"');
  const names = [...source.matchAll(NAME)];
  if (names.length !== 1) throw new PaneHeaderError(`expected one "const name =" line, found ${names.length}`);
  // The helper adds a top-level paneTitle and uses the plain shared import, so neither may exist already.
  if (/\bpaneTitle\b/.test(source)) throw new PaneHeaderError("it already has a paneTitle");
  const list = imports[1].split(",").map((name) => name.trim()).filter((name) => name !== "");
  if (list.some((name) => /^shared\s+as\b/.test(name))) throw new PaneHeaderError("it imports shared under another name");
  if (/\b(?:const|let|var|function|class)\s+shared\b/.test(source)) throw new PaneHeaderError("it declares its own shared");
  if (!list.includes("shared")) list.push("shared");

  // Each part is replaced at its own position, so the same text elsewhere stays.
  const [line, indent, value] = names[0];
  const at = names[0].index;
  const named = `${source.slice(0, at)}${indent}const name = paneTitle(p) ?? (${value});${source.slice(at + line.length)}`;
  const importAt = named.indexOf(imports[0]);
  const patched = `${named.slice(0, importAt)}import { ${list.join(", ")} } from "herdr";${named.slice(importAt + imports[0].length)}`;
  return patched.trimEnd() + "\n" + HELPER;
}

/**
 * The copy's `mod.json`: the shipped one, renamed, with a marker that says this
 * script owns the folder.
 *
 * @param {object} shipped The shipped `mods/pane/mod.json`.
 * @returns {object}
 */
export function paneHeaderManifest(shipped) {
  const title = typeof shipped?.title === "string" && shipped.title !== "" ? shipped.title : "Pane header";
  return { ...shipped, title: `${title} (Argus)`, generated_by: MARKER };
}

/**
 * True when a mod folder holds a copy this script wrote, so it may be replaced.
 *
 * @param {object | null} manifest The folder's `mod.json`, or null when it has none.
 * @returns {boolean}
 */
export function ownsHeader(manifest) {
  return manifest?.generated_by === MARKER;
}

/**
 * A copy of `layout` where every pane header that shows the shipped header mod shows `mod`.
 *
 * @param {object} layout
 * @param {string} mod
 * @returns {object}
 */
export function useHeader(layout, mod) {
  const out = structuredClone(layout);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const header = node.content?.pane?.header;
    if (header?.content?.mod === SHIPPED_HEADER) header.content.mod = mod;
    for (const child of node.children ?? []) visit(child);
  };
  visit(out);
  return out;
}
