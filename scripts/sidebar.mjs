// Builds Argus's copy of Herdr's sidebar mod. The copy shows each space with no
// repo or branch text after its name; the ahead and behind counts stay.

/** The folder name of the copy in Herdr's mods folder. */
export const SIDEBAR = "argus-spaces";

/** The shipped mod the copy is made from. */
export const SHIPPED_SIDEBAR = "spaces";

const MARKER = "argus";

// The indent is spaces and tabs only, so a blank line before a match stays out of it.
const METHOD = /^([ \t]*)gitTail\(/gm;
const WHERE = /^([ \t]*)const where = (.+);$/gm;

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
  const patched = `${indent}// Argus leaves out the repo and branch text; the ahead and behind counts stay.\n${indent}// The locals above stay unused.\n${indent}const where = "";`;
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

/** Herdr's sidebar no longer has the lines the groups hooks need. */
export class GroupsError extends Error {
  constructor(reason) {
    super(`the groups hooks do not apply (${reason})`);
    this.name = "GroupsError";
  }
}

/** The files the copy with groups needs next to its `main.js`: copy path to repo path. */
export const GROUP_FILES = {
  "space-groups.js": "lib/space-groups.js",
  "space-groups-view.js": "lib/space-groups-view.js",
  "menu.js": "lib/menu.js",
  "ui.js": "lib/ui.js",
  "icons/ellipsis.svg": "mods/argus-space-groups/icons/ellipsis.svg",
  "icons/LICENSE-Lucide.txt": "mods/argus-space-groups/icons/LICENSE-Lucide.txt",
  "icons.js": "lib/icons.js",
  "icons/folder-plus.svg": "mods/argus-space-groups/icons/folder-plus.svg",
  "icons/chevron-down.svg": "mods/argus-space-groups/icons/chevron-down.svg",
  "icons/chevron-right.svg": "mods/argus-space-groups/icons/chevron-right.svg",
};

const GROUPS_IMPORT = 'import { argusInit, argusSort, argusSections, argusDropOnRow, argusNewGroupButton } from "./space-groups-view.js";';
const HERDR_IMPORT = /^import \{[^}]*\} from "herdr";$/;
const ITEMS_START = "const items = [cell(head),";
const ITEMS_DRAW = "mine.length ? mine.map(draw) :";

/**
 * The lines of each anchor, found by their trimmed text. Each anchor must be
 * on exactly one line.
 */
const ANCHORS = {
  herdrImport: (text) => HERDR_IMPORT.test(text),
  init: (text) => text === "this.machines = [];",
  sort: (text) => text === "const order = sp.map(w => w.id);",
  // The sort hook reads the git info of a space with `where(w, ps)` in `ordered()`.
  where: (text) => text.startsWith("const where = (s, ps) =>"),
  spacesAndPanes: (text) => text === "const sp = spaces(), ps = panes();",
  // The names the hook lines use, so a rename in Herdr refuses the hooks.
  initCx: (text) => text === "init(_props, cx) {",
  outList: (text) => text === "const out = [];",
  groupedArgs: (text) => text === "grouped(t, collapsed) {",
  machineArg: (text) => text === "return machineNames.flatMap((m) => {",
  dragFrom: (text) => text === "const from = this.pressed;",
  renderTheme: (text) => text === "const t = theme();",
  renderCollapsed: (text) => text === "const collapsed = narrow();",
  localActive: (text) => text === "this.activeAt = rows.findIndex(r => r.w.active);",
  localReturn: (text) => text === "return rows.map(draw);",
  remoteItems: (text) => text.startsWith(ITEMS_START) && text.includes(ITEMS_DRAW),
  remoteFirst: (text) => text === "const first = folded ? -1 : mine.findIndex(r => r.w.active);",
  drop: (text) => text === "const index = spaces().findIndex(s => s.id === w.id);",
  title: (text) => text.startsWith('.child(div().id("space-new")'),
  sizeReveal: (text) => text === SIZE_REVEAL,
};

// The scroll list jumps back to the active space each time its size changes. In the copy with
// groups, this jump fights a scroll up and the list runs away, so the copy drops it.
const SIZE_REVEAL = ".on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })";
const SIZE_REVEAL_COMMENT = "// A block above";

/**
 * The patched sidebar source with the space groups hooks: one-line calls into
 * `space-groups-view.js`, which `build-layout` writes next to the copy, and
 * without the jump to the active space on a size change. Every hook applies,
 * or none does.
 *
 * @param {string} source The sidebar source after `patchSidebar`.
 * @returns {string}
 * @throws {GroupsError} When an anchor is missing or is on more than one line.
 */
export function addGroups(source) {
  const lines = source.split("\n");
  const at = {};
  for (const [name, matches] of Object.entries(ANCHORS)) {
    const found = lines.flatMap((line, i) => (matches(line.trim()) ? [i] : []));
    if (found.length !== 1) throw new GroupsError(`expected one ${name} line, found ${found.length}`);
    at[name] = found[0];
  }
  if (at.localReturn !== at.localActive + 1) throw new GroupsError("the local return does not follow the active row");
  const indent = (i) => lines[i].match(/^[ \t]*/)[0];
  const before = new Map();
  const after = new Map();
  const replace = new Map();
  after.set(at.herdrImport, [GROUPS_IMPORT]);
  after.set(at.init, [`${indent(at.init)}argusInit(this, cx);`]);
  before.set(at.sort, [`${indent(at.sort)}out.splice(0, out.length, ...argusSort(this, out, sp, (w) => this.git[where(w, ps)]));`]);
  const local = indent(at.localActive);
  replace.set(at.localActive, [
    `${local}const argus = argusSections(this, rows, draw, t, collapsed, null);`,
    `${local}this.activeAt = argus.active;`,
    `${local}return argus.items;`,
  ]);
  replace.set(at.localReturn, []);
  before.set(at.remoteItems, [`${indent(at.remoteItems)}const argusMine = argusSections(this, mine, draw, t, collapsed, m);`]);
  // The group headers show also when this machine has no spaces, so an empty group stays reachable.
  replace.set(at.remoteItems, [lines[at.remoteItems].replace(ITEMS_DRAW, "argusMine.items.length ? argusMine.items :")]);
  replace.set(at.remoteFirst, [`${indent(at.remoteFirst)}const first = folded ? -1 : argusMine.active;`]);
  before.set(at.drop, [`${indent(at.drop)}argusDropOnRow(this, from, w);`]);
  before.set(at.title, [`${indent(at.title)}.when(!collapsed, el => el.child(argusNewGroupButton(this, t)))`]);
  replace.set(at.sizeReveal, []);
  // The comment above the jump explains only the jump, so it goes too.
  const comment = at.sizeReveal - 1;
  if (lines[comment].trim().startsWith(SIZE_REVEAL_COMMENT) && !replace.has(comment)) replace.set(comment, []);
  const out = [];
  lines.forEach((line, i) => {
    out.push(...(before.get(i) ?? []));
    out.push(...(replace.has(i) ? replace.get(i) : [line]));
    out.push(...(after.get(i) ?? []));
  });
  return out.join("\n");
}
