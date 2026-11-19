// Builds the argus layout from Herdr's shipped main layout: Herdr's
// blocks stay as they are, with a keep-awake button and a toolbar beside the
// tab bar and a panel column for this repo's panel mods.

export const TOOLBAR_ID = "argus-toolbar";
export const STAY_AWAKE_ID = "argus-stay-awake";
export const PANEL_ID = "argus-panel";
export const STACK_ID = "argus-panels";
const ROW_ID = "argus-tabs-row";
// The panel opens at PANEL_WIDTH and drags between PANEL_MIN and PANEL_MAX.
const PANEL_WIDTH = 440;
const PANEL_MIN = 280;
const PANEL_MAX = 900;
/** The keep-awake block's width in px: one 30 px icon button and 10 px of padding. */
export const STAY_AWAKE_WIDTH = 40;

/**
 * The toolbar's width in px for its buttons: 10 px of padding, then per
 * button 32 px of padding and icon, about 7 px per label character and a
 * 3 px gap.
 *
 * @param {{ label: string }[]} panels
 */
export function toolbarWidth(panels) {
  return 10 + panels.reduce((sum, panel) => sum + 32 + 7 * panel.label.length + 3, 0);
}

/**
 * The panels the installed mods declare with `panel` in their mod.json.
 *
 * @param {{ name: string, manifest: { panel?: { label?: string, icon?: string } } }[]} entries
 * @returns {{ id: string, label: string, icon: string | null }[]}
 */
export function panelsFromManifests(entries) {
  return entries
    .filter(({ manifest }) => typeof manifest?.panel?.label === "string" && manifest.panel.label.trim())
    .map(({ name, manifest }) => ({
      id: name,
      label: manifest.panel.label.trim(),
      icon: safeIcon(manifest.panel.icon) ? `mods/${name}/${manifest.panel.icon}` : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Returns a new layout: `main` with the keep-awake button and the toolbar
 * beside its `tabs` block and a hidden panel column at the end of its
 * `work-body` row.
 *
 * @param {object} main Herdr's layouts/main.json.
 * @param {{ id: string, label: string, icon: string | null }[]} panels
 * @param {{ stayAwake?: boolean }} [options] `stayAwake: false` leaves out the keep-awake button.
 * @returns {object}
 * @throws {Error} When `main` has no `tabs` block or no `work-body` row.
 */
export function buildLayout(main, panels, { stayAwake = true } = {}) {
  const out = structuredClone(main);
  if (find(out, TOOLBAR_ID) || find(out, STAY_AWAKE_ID) || find(out, PANEL_ID)) throw new Error("already has the argus blocks");

  const tabsParent = parentOf(out, "tabs");
  if (!tabsParent) throw new Error("no tabs block");
  const body = find(out, "work-body");
  if (!body || !Array.isArray(body.children)) throw new Error("no work-body row");

  const index = tabsParent.children.findIndex((child) => child.id === "tabs");
  const tabs = tabsParent.children[index];
  tabsParent.children[index] = {
    id: ROW_ID,
    type: "row",
    size: tabs.size ?? { px: 42 },
    resizable: false,
    children: [
      { ...tabs, size: { weight: 1 } },
      {
        id: TOOLBAR_ID,
        type: "block",
        size: { px: toolbarWidth(panels) },
        content: { mod: TOOLBAR_ID, props: { panel: PANEL_ID, stack: STACK_ID, buttons: panels } },
      },
      ...(stayAwake ? [{ id: STAY_AWAKE_ID, type: "block", size: { px: STAY_AWAKE_WIDTH }, content: { mod: STAY_AWAKE_ID } }] : []),
    ],
  };

  body.children.push({
    id: PANEL_ID,
    type: "column",
    size: { px: PANEL_WIDTH },
    min: PANEL_MIN,
    max: PANEL_MAX,
    hidden: true,
    children: [
      {
        id: STACK_ID,
        type: "stack",
        ...(panels.length > 0 ? { active: panels[0].id } : {}),
        children: panels.map((panel) => ({ id: panel.id, type: "block", content: { mod: panel.id } })),
      },
    ],
  });

  return out;
}

/** An icon path that stays inside the mod's folder. */
function safeIcon(icon) {
  return typeof icon === "string" && icon !== "" && !icon.startsWith("/") && !icon.split("/").includes("..");
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

function parentOf(node, id) {
  for (const child of node?.children ?? []) {
    if (child.id === id) return node;
    const hit = parentOf(child, id);
    if (hit) return hit;
  }
  return null;
}
