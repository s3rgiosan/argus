// Space groups of the Argus sidebar: the stored groups and their members, and
// the order and sections of the sidebar rows. Pure functions, no Herdr imports.

/** The shared-state key that holds the groups. */
export const KEY = "argus-spaces.groups";

/** The localStorage key that holds the folded sections of a sidebar copy. */
export const FOLDED_KEY = "argus-spaces.groups.folded";

/** The longest group name. */
export const NAME_MAX = 40;

/** The name of the section for spaces without a group. */
export const NO_GROUP = "No group";

/**
 * @typedef {{ id: string, name: string }} Group
 * @typedef {{ groups: Group[], members: Record<string, string> }} Store
 */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const folded = (name) => name.trim().toLowerCase();

/**
 * The stored value as a clean store. Bad groups, a second group with the same
 * id, and members of unknown groups are dropped. A bad value gives no groups.
 *
 * @param {unknown} value
 * @returns {Store} A new object.
 */
export function readStore(value) {
  if (!isObject(value) || !Array.isArray(value.groups)) return { groups: [], members: {} };
  const groups = [];
  const ids = new Set();
  for (const group of value.groups) {
    if (!isObject(group) || typeof group.id !== "string" || group.id === "" || ids.has(group.id)) continue;
    if (typeof group.name !== "string") continue;
    const name = group.name.trim();
    if (name === "" || name.length > NAME_MAX) continue;
    ids.add(group.id);
    groups.push({ id: group.id, name });
  }
  const members = {};
  if (isObject(value.members)) {
    for (const [key, id] of Object.entries(value.members)) {
      if (typeof id === "string" && ids.has(id)) members[key] = id;
    }
  }
  return { groups, members };
}

/**
 * Why a group name is refused, or null when it is good.
 *
 * @param {Store} store
 * @param {string} name
 * @param {string} [exceptId] The group that is renamed, so its own name is not taken.
 * @returns {string | null}
 */
export function checkName(store, name, exceptId) {
  const trimmed = name.trim();
  if (trimmed === "") return "Give the group a name.";
  if (trimmed.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  const wanted = folded(trimmed);
  if (wanted === folded(NO_GROUP)) return "This name is kept for spaces without a group.";
  const taken = store.groups.some((group) => group.id !== exceptId && folded(group.name) === wanted);
  return taken ? "Another group has this name." : null;
}

/**
 * The store with a new group last. Check the name with `checkName` first.
 *
 * @param {Store} store
 * @param {string} name
 * @param {string} id
 * @returns {Store}
 */
export function addGroup(store, name, id) {
  return { groups: [...store.groups, { id, name: name.trim() }], members: { ...store.members } };
}

/**
 * The store with group `id` renamed. Check the name with `checkName` first.
 *
 * @param {Store} store
 * @param {string} id
 * @param {string} name
 * @returns {Store}
 */
export function renameGroup(store, id, name) {
  const groups = store.groups.map((group) => (group.id === id ? { id, name: name.trim() } : { ...group }));
  return { groups, members: { ...store.members } };
}

/**
 * The store with group `id` one place up (-1) or down (1). The first group
 * does not move up, and the last group does not move down.
 *
 * @param {Store} store
 * @param {string} id
 * @param {-1 | 1} delta
 * @returns {Store}
 */
export function moveGroup(store, id, delta) {
  const groups = store.groups.map((group) => ({ ...group }));
  const from = groups.findIndex((group) => group.id === id);
  const to = from + delta;
  if (from >= 0 && to >= 0 && to < groups.length) groups.splice(to, 0, groups.splice(from, 1)[0]);
  return { groups, members: { ...store.members } };
}

/**
 * The store without group `id` and its members.
 *
 * @param {Store} store
 * @param {string} id
 * @returns {Store}
 */
export function deleteGroup(store, id) {
  const groups = store.groups.filter((group) => group.id !== id).map((group) => ({ ...group }));
  const members = Object.fromEntries(Object.entries(store.members).filter(([, group]) => group !== id));
  return { groups, members };
}

/**
 * The store with `key` in group `groupId`, or in no group when `groupId` is null.
 *
 * @param {Store} store
 * @param {string} key
 * @param {string | null} groupId
 * @returns {Store}
 */
export function setMember(store, key, groupId) {
  const members = { ...store.members };
  if (groupId === null) delete members[key];
  else members[key] = groupId;
  return { groups: store.groups.map((group) => ({ ...group })), members };
}

/**
 * The store without the members of spaces that are closed. Only keys of
 * spaces that are not in a repo (`["space", id]`) are dropped; repo keys stay,
 * so a repo that opens again comes back in its group.
 *
 * @param {Store} store
 * @param {Set<string>} liveIds The ids of the open spaces.
 * @returns {Store}
 */
export function pruneSpaces(store, liveIds) {
  const members = {};
  for (const [key, group] of Object.entries(store.members)) {
    const id = spaceIdOf(key);
    if (id === null || liveIds.has(id)) members[key] = group;
  }
  return { groups: store.groups.map((group) => ({ ...group })), members };
}

/**
 * A new group id: "g-", the time in base 36, "-" and 6 random base-36 characters.
 *
 * @param {number} now
 * @param {() => number} random A function such as `Math.random`.
 * @returns {string}
 */
export function newGroupId(now, random) {
  let tail = "";
  for (let i = 0; i < 6; i++) tail += Math.floor(random() * 36).toString(36);
  return `g-${now.toString(36)}-${tail}`;
}

/** The space id in a `["space", id]` key, or null for any other key. */
function spaceIdOf(key) {
  if (!key.startsWith('["space",')) return null;
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === "string" ? parsed[1] : null;
  } catch {
    return null;
  }
}

/** The number of flips that pauses the group sort on a machine. */
export const FLIP_LIMIT = 3;

/** The time in ms in which `FLIP_LIMIT` flips pause the group sort. */
export const FLIP_WINDOW = 60000;

/**
 * The membership key of a space: its repo (the sidebar's `repo` field, the
 * machine and the git common folder), else the space itself.
 *
 * @param {{ id: string }} space
 * @param {{ repo?: unknown } | null} git
 * @returns {string}
 */
export function memberKey(space, git) {
  return typeof git?.repo === "string" ? git.repo : JSON.stringify(["space", space.id]);
}

/**
 * The group id of `key`, or null when it is in no group.
 *
 * @param {Store} store
 * @param {string} key
 * @returns {string | null}
 */
export function groupOf(store, key) {
  return Object.hasOwn(store.members, key) ? store.members[key] : null;
}

/** The machine of a sidebar row; null is this computer. */
const machineOf = (row) => row.w.machine ?? null;

/**
 * The sidebar rows sorted by group: groups in store order, rows without a
 * group last. The sort is stable and stays inside each run of rows of one
 * machine, because Herdr moves a space only inside its machine's block.
 *
 * @template {{ w: { machine?: string | null } }} Row
 * @param {Row[]} rows
 * @param {Store} store
 * @param {(row: Row) => string} keyOf
 * @returns {Row[]} A new array of the same rows.
 */
export function sortRows(rows, store, keyOf) {
  const rank = new Map(store.groups.map((group, i) => [group.id, i]));
  const rankOf = (row) => rank.get(groupOf(store, keyOf(row))) ?? store.groups.length;
  const out = [];
  let start = 0;
  while (start < rows.length) {
    let end = start + 1;
    while (end < rows.length && machineOf(rows[end]) === machineOf(rows[start])) end++;
    const run = rows.slice(start, end).map((row, i) => ({ row, i, rank: rankOf(row) }));
    run.sort((a, b) => a.rank - b.rank || a.i - b.i);
    for (const item of run) out.push(item.row);
    start = end;
  }
  return out;
}

/**
 * The sections of the sidebar rows of one machine. With no groups, one section
 * without a header. Else one section per group in store order, then the rows
 * without a group. An empty section is left out unless `local` is true.
 *
 * @template Row
 * @param {Row[]} rows
 * @param {Store} store
 * @param {(row: Row) => string} keyOf
 * @param {{ local: boolean }} options `local` is true for this computer's rows.
 * @returns {{ group: Group | null, rows: Row[], header: boolean }[]}
 */
export function sections(rows, store, keyOf, { local }) {
  if (store.groups.length === 0) return [{ group: null, rows, header: false }];
  const known = new Set(store.groups.map((group) => group.id));
  const of = (row) => {
    const id = groupOf(store, keyOf(row));
    return known.has(id) ? id : null;
  };
  const all = [
    ...store.groups.map((group) => ({ group: { ...group }, rows: rows.filter((row) => of(row) === group.id), header: true })),
    { group: null, rows: rows.filter((row) => of(row) === null), header: true },
  ];
  return all.filter((section) => local || section.rows.length > 0);
}

/**
 * One entry per membership key of the rows, in the order first seen, for the
 * Add spaces checklist. A worktree space shares its repo's key, so a repo shows once.
 *
 * @template Row
 * @param {Row[]} rows
 * @param {(row: Row) => string} keyOf
 * @param {(row: Row) => string} nameOf
 * @returns {{ key: string, name: string }[]}
 */
export function checklist(rows, keyOf, nameOf) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: nameOf(row) });
  }
  return out;
}

/**
 * The state of the guard that stops two apps from moving the same spaces
 * back and forth. Keep one per sidebar copy.
 *
 * @returns {object}
 */
export function createGuard() {
  return { machines: new Map() };
}

/**
 * True when the group sort is paused on `machine`. A flip is a call with
 * `settled` false right after a call with `settled` true and the same stamp:
 * the order matched the groups, and something moved it away. `FLIP_LIMIT`
 * flips within `FLIP_WINDOW` ms pause the machine until its stamp changes.
 *
 * @param {object} state From `createGuard`.
 * @param {{ machine: string | null, stamp: string, settled: boolean, now: number }} look
 *   `stamp` names the groups and the spaces of the machine; `settled` is true when Herdr's order matches the groups.
 * @returns {boolean}
 */
export function guardPaused(state, { machine, stamp, settled, now }) {
  let entry = state.machines.get(machine);
  if (!entry || entry.stamp !== stamp) {
    entry = { stamp, flips: [], paused: false, settled: null };
    state.machines.set(machine, entry);
  }
  if (entry.settled === true && !settled) entry.flips.push(now);
  entry.settled = settled;
  entry.flips = entry.flips.filter((at) => now - at <= FLIP_WINDOW);
  if (entry.flips.length >= FLIP_LIMIT) entry.paused = true;
  return entry.paused;
}

/** The mod that shows the group popups, and their sizes. */
export const GROUP_POPUP = "argus-space-groups";
export const MENU_WIDTH = 200;
export const WIDE_WIDTH = 260;
export const NAME_HEIGHT = 84;
export const LIST_MAX = 420;

/**
 * The rows of the popup of group `id`. Move up is left out on the first group,
 * and Move down on the last.
 *
 * @param {Store} store
 * @param {string} id
 * @returns {{ id: "add" | "rename" | "up" | "down" | "delete", label: string }[]}
 */
export function groupMenu(store, id) {
  const at = store.groups.findIndex((group) => group.id === id);
  if (at < 0) return [];
  return [
    { id: "add", label: "Add spaces…" },
    { id: "rename", label: "Rename" },
    ...(at > 0 ? [{ id: "up", label: "Move up" }] : []),
    ...(at < store.groups.length - 1 ? [{ id: "down", label: "Move down" }] : []),
    { id: "delete", label: "Delete group" },
  ];
}

/**
 * The membership key of a space while its git info can be unknown for a
 * moment. A `cd` gives the space a new folder, and git for it is read after a
 * short delay; until then the space keeps its last repo key, so it does not
 * jump to No group and back.
 *
 * @param {{ id: string }} space
 * @param {{ repo?: unknown } | null | undefined} git The sidebar's git info: undefined while unknown, null for no repo.
 * @param {string | undefined} previous The space's last repo key.
 * @returns {string}
 */
export function stickyKey(space, git, previous) {
  if (git === undefined && previous !== undefined) return previous;
  return memberKey(space, git ?? null);
}

/**
 * The stamp of one machine for `guardPaused`: the groups, and each space with
 * its membership key and its nesting. It leaves out Herdr's order, so only an
 * order change counts as a flip, not a change this app makes to its own target.
 *
 * @template {{ w: { id: string }, tree?: string | null }} Row
 * @param {Store} store
 * @param {Row[]} rows The rows of one machine.
 * @param {(row: Row) => string} keyOf
 * @returns {string}
 */
export function guardStamp(store, rows, keyOf) {
  const spaces = rows.map((row) => JSON.stringify([row.w.id, keyOf(row), Boolean(row.tree)])).sort();
  return JSON.stringify([store, spaces]);
}
