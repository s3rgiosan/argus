// Icons that follow Herdr's own. Herdr ships some icons with the same
// drawing as this repo's bundled ones; a mod loads Herdr's file when the
// app folder has it and its own copy otherwise. No Herdr imports, so Node can
// test it.

/** Names of the icons in Herdr's `workspace-chrome` mod that match this repo's drawings. */
export const HERDR_ICONS = ["chevron-left", "chevron-down", "chevron-right", "settings", "panel-right", "check", "x", "square-pen", "clock", "plus"];

/** The app-folder path of Herdr's icon `name`. */
export function herdrIconPath(name) {
  return `mods/workspace-chrome/${name}.svg`;
}

/**
 * The path to load for `name`: Herdr's file when `found` has the name, else `fallback`.
 *
 * @param {Set<string>} found Names from `probeIcons`.
 * @param {string} name
 * @param {string} fallback
 */
export function resolveIcon(found, name, fallback) {
  return found.has(name) ? herdrIconPath(name) : fallback;
}

/**
 * A function from an icon name to the path to load, for a mod whose own
 * copies sit in `mods/<mod>/icons/<name>.svg`.
 *
 * @param {string} mod
 * @param {Set<string>} found Names from `probeIcons`.
 * @returns {(name: string) => string}
 */
export function iconResolver(mod, found) {
  return (name) => resolveIcon(found, name, `mods/${mod}/icons/${name}.svg`);
}

/**
 * The names in `names` whose Herdr file exists and holds an svg. A read that
 * fails or finds nothing leaves the name out. Run it once from a task in
 * `init`, never from `render`.
 *
 * @param {(path: string) => Promise<string | null>} read Herdr's `readTextFile`.
 * @param {string | null | undefined} home Herdr's app folder, from `appHome()`.
 * @param {string[]} [names]
 * @returns {Promise<Set<string>>}
 */
export async function probeIcons(read, home, names = HERDR_ICONS) {
  const found = new Set();
  if (typeof home !== "string" || home === "") return found;
  await Promise.all(
    names.map(async (name) => {
      try {
        const text = await read(`${home}/${herdrIconPath(name)}`);
        if (typeof text === "string" && text.includes("<svg")) found.add(name);
      } catch {
        // A missing or unreadable file keeps the mod's own copy.
      }
    }),
  );
  return found;
}
