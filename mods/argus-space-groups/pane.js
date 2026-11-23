// Copied from lib/pane.js by scripts/sync-lib.mjs: edit lib/pane.js, then run it.
//
// Helpers that need Herdr itself: opening a mod's pane, the pane title, links
// and text inputs.

import { shared, setShared, spaces, panes, run } from "herdr";
import { InputState, TextareaState } from "gpui-base";

/**
 * Opens a web page in the browser with Herdr's `open_url`. It opens only
 * absolute http and https URLs and refuses anything else, so another link
 * opens nothing, and a failed open shows nothing.
 *
 * @param {{ open_url(url: string): void }} cx The handler's `cx`.
 * @param {string} url
 */
export function openInBrowser(cx, url) {
  try {
    cx.open_url(String(url));
  } catch {
    // A refused link opens nothing.
  }
}

/**
 * Shows a pane of `mod` in the shown tab: focuses the mod's pane there, or
 * splits the tab's focused pane to the right to open one with `props`.
 *
 * @param {string} mod
 * @param {Record<string, unknown>} props
 */
export function openModPane(mod, props) {
  const tab = spaces()
    .find((space) => space.active)
    ?.tabs.find((candidate) => candidate.active);
  if (!tab) return;
  const inTab = panes().filter((pane) => pane.tab === tab.id);
  const own = inTab.find((pane) => pane.mod === mod);
  if (own) {
    run("pane.focus", { pane: own.pane });
    return;
  }
  const target = inTab.find((pane) => pane.focused) ?? inTab[0];
  run("pane.split", { ...(target ? { pane: target.pane } : {}), direction: "right", mod, props });
}

/**
 * Sets the title the Argus pane header shows for a mod's panes, under `key`.
 * Call it from an event handler or a task, in the same call that changes the
 * selection, so the header shows the new item as soon as the pane switches.
 * A write renders every mod again, so only a changed title is written.
 *
 * @param {string} key The mod's `<mod>.paneTitle` key.
 * @param {string} title
 */
export function setTitle(key, title) {
  if (shared(key) !== title) setShared(key, title);
}

/**
 * Shares the title the Argus pane header shows for a mod's panes, under `key`,
 * from a render. The write runs after this render, in a task.
 *
 * @param {object} cx The render's `cx`.
 * @param {string} key The mod's `<mod>.paneTitle` key.
 * @param {string} title
 */
export function shareTitle(cx, key, title) {
  if (shared(key) === title) return;
  cx.spawn(async (cx) => {
    await cx.sleep(0);
    setTitle(key, title);
  });
}

/**
 * A maker of text inputs for `view` that track focus in `view.focused`, so a
 * field can draw its accent border. Call it in `init`. Each input runs
 * `onSubmit(cx)` on Enter, and on blur with `saveOnBlur`. A `multiline`
 * input is a textarea: Return adds a line, and only ⌘Return submits.
 *
 * @param {{ focused: string | null }} view
 * @returns {(id: string, options: object, onSubmit: (cx: object) => void, flags?: { saveOnBlur?: boolean, multiline?: boolean }) => object}
 */
export function createInputs(view) {
  return (id, options, onSubmit, { saveOnBlur = false, multiline = false } = {}) => {
    const state = multiline ? TextareaState.new(options) : InputState.new(options);
    state.on("submit", (e, cx) => {
      if (multiline && !e?.secondary) return;
      onSubmit(cx);
    });
    state.on("focus", (_e, cx) => {
      view.focused = id;
      cx.notify();
    });
    state.on("blur", (_e, cx) => {
      if (view.focused === id) view.focused = null;
      if (saveOnBlur) onSubmit(cx);
      cx.notify();
    });
    return state;
  };
}
