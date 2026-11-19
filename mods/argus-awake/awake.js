// The keep-awake modes and what a click or a tick does to them. No Herdr
// imports, so Node can test it.

export const MODES = ["off", "on", "agents"];
/** How often `caffeinate` runs again while the mode is not `off`. */
export const TICK_MS = 60_000;
/** The `exec` timeout: above the 120 s `caffeinate` runs for. */
export const EXEC_TIMEOUT_MS = 150_000;

/**
 * The most `caffeinate` runs open at once. A run lasts 120 s and a tick comes
 * every 60 s or a little later, so three leave room at the hand-over.
 */
export const MAX_RUNS = 3;

const NO_AGENTS = "No agents are working";
const AGENTS_DONE = "Agents finished · display can sleep";

/** The `caffeinate` arguments: keep the display and the system awake for 120 s. */
export function caffeinateArgs() {
  return ["-di", "-t", "120"];
}

/**
 * Whether at least one agent is working.
 *
 * @param {{ status: string }[] | null | undefined} agents From `agents()`.
 */
export function anyWorking(agents) {
  return Array.isArray(agents) && agents.some((agent) => agent?.status === "working");
}

/**
 * The mode after a left click: `off` turns on, any other mode turns off.
 *
 * @param {string} mode
 */
export function leftClick(mode) {
  return mode === "off" ? "on" : "off";
}

/**
 * The result of a right click: agents mode while an agent works, else the
 * mode stays and a toast says why.
 *
 * @param {string} mode
 * @param {boolean} working
 * @returns {{ mode: string, toast: string | null }}
 */
export function rightClick(mode, working) {
  if (working) return { mode: "agents", toast: null };
  return { mode, toast: NO_AGENTS };
}

/**
 * The result of a timer tick: agents mode ends when no agent works, and
 * `keepAwake` says whether to run `caffeinate` again.
 *
 * @param {string} mode
 * @param {boolean} working
 * @returns {{ mode: string, toast: string | null, keepAwake: boolean }}
 */
export function tick(mode, working) {
  if (mode === "agents" && !working) return { mode: "off", toast: AGENTS_DONE, keepAwake: false };
  return { mode, toast: null, keepAwake: mode !== "off" };
}

/**
 * Whether to start a `caffeinate` run now.
 *
 * @param {boolean} keepAwake
 * @param {number} runs Runs open now.
 */
export function shouldRun(keepAwake, runs) {
  return keepAwake && runs < MAX_RUNS;
}
