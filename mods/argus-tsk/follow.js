// Copied from lib/follow.js by scripts/sync-lib.mjs: edit lib/follow.js, then run it.
//
// Helpers that match the focused space to a project folder, and a name order.

/**
 * The project that is `folder` or holds it, matched on whole folder names; the
 * longest match wins. Trailing and doubled slashes are ignored. Returns the path
 * as `projects` has it, or null.
 * @param {Array<?string>} projects
 * @param {?string} folder
 * @returns {?string}
 */
export function followedProject(projects, folder) {
  if (typeof folder !== "string" || folder === "") return null;
  const target = segments(folder);
  let best = null;
  let bestLength = 0;
  for (const project of projects) {
    if (typeof project !== "string") continue;
    const own = segments(project);
    if (own.length === 0 || own.length > target.length || own.length <= bestLength) continue;
    if (own.every((part, i) => part === target[i])) {
      best = project;
      bestLength = own.length;
    }
  }
  return best;
}

/**
 * The folder of the focused space: the focused terminal's folder, else a
 * terminal's in the focused tab, else one in another tab of that space, else
 * the space's folder. Without focus it reads the shown space and its shown tab.
 * A space on another machine gives null: its folders are not on this computer.
 * @param {?{space?: string, tab?: string, cwd?: ?string}} focused from `focused()`
 * @param {Array<{terminal?: ?string, tab: string, cwd?: ?string}>} panes from `panes()`
 * @param {Array<{id: string, active: boolean, machine?: ?string, folder?: string, tabs?: Array<{id: string, active: boolean}>}>} spaces from `spaces()`
 * @returns {?string}
 */
export function followFolder(focused, panes, spaces) {
  const text = (v) => (typeof v === "string" && v !== "" ? v : null);
  const space = spaces.find((s) => s.id === focused?.space) ?? spaces.find((s) => s.active);
  if (text(space?.machine)) return null;
  const own = text(focused?.cwd);
  if (own) return own;
  if (!space) return null;
  const tabs = space.tabs ?? [];
  const tab = focused?.tab ?? tabs.find((t) => t.active)?.id ?? null;
  const terminals = panes.filter((p) => typeof p.terminal === "string" && text(p.cwd));
  const inTab = terminals.find((p) => p.tab === tab);
  if (inTab) return inTab.cwd;
  const tabIds = new Set(tabs.map((t) => t.id));
  const inSpace = terminals.find((p) => tabIds.has(p.tab));
  if (inSpace) return inSpace.cwd;
  return text(space.folder);
}

/**
 * Orders names A-Z without regard to case, then by their exact text so the order is stable.
 * Plain comparisons keep the order the same in every JavaScript runtime.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareNames(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function segments(path) {
  return path.split(/[\\/]+/).filter((s) => s !== "");
}
