// Builds the argus layout from Herdr's shipped main layout: Herdr's
// blocks stay as they are, with a keep-awake button and a toolbar beside the
// tab bar and a panel column for this repo's panel mods.

import { toolbarWidthFor } from "../lib/toolbar-width.js";

export const TOOLBAR_ID = "argus-toolbar";
/** The generated layout's name, which Herdr shows in Settings. */
export const LAYOUT_NAME = "Argus";
/** The name earlier versions wrote the layout under. */
export const LEGACY_NAME = "argus";
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

/** The input layout already holds the blocks this script adds. */
export class ArgusBlocksError extends Error {
  constructor() {
    super("main.json already contains argus blocks");
    this.name = "ArgusBlocksError";
  }
}

/**
 * What to do with the layout files before writing `LAYOUT_NAME`: migrate a
 * generated legacy file, drop a generated legacy file that sits next to the
 * new one, or refuse a file the script did not write.
 *
 * @param {string[]} files Names in the layouts folder.
 * @param {(file: string) => boolean} ours Whether the script wrote that file.
 * @returns {{ migrate: boolean, removeLegacy: boolean, error: string | null }}
 */
export function planLayoutFile(files, ours) {
  const legacy = `${LEGACY_NAME}.json`;
  const current = `${LAYOUT_NAME}.json`;
  const hasLegacy = files.includes(legacy);
  const hasCurrent = files.includes(current);
  if (hasCurrent && !ours(current)) return { migrate: false, removeLegacy: false, error: `${current} was not written by this script` };
  if (hasLegacy && hasCurrent) return { migrate: false, removeLegacy: ours(legacy), error: null };
  if (hasLegacy && !ours(legacy)) return { migrate: false, removeLegacy: false, error: `${legacy} was not written by this script` };
  return { migrate: hasLegacy, removeLegacy: false, error: null };
}

/**
 * Whether to rename the legacy layout state file (`.state/argus.json`) to the
 * new name: when it exists and the new name does not. On a case-insensitive
 * disk both names are the same file, so nothing moves.
 *
 * @param {{ legacy: boolean, target: boolean }} exists
 * @returns {{ migrate: boolean }}
 */
export function planStateFile({ legacy, target }) {
  return { migrate: legacy && !target };
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
 * @param {{ stayAwake?: boolean, display?: string }} [options] `stayAwake: false` leaves out the
 *   keep-awake button; `display` ("icons", "labels" or "both") sizes the toolbar block.
 * @returns {object}
 * @throws {Error} When `main` has no `tabs` block or no `work-body` row.
 */
export function buildLayout(main, panels, { stayAwake = true, display = "both" } = {}) {
  const out = structuredClone(main);
  if (find(out, TOOLBAR_ID) || find(out, STAY_AWAKE_ID) || find(out, PANEL_ID)) throw new ArgusBlocksError();

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
        size: { px: toolbarWidthFor(panels, display) },
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
