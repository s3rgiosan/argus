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
