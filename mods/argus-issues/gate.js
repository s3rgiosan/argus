// Copied from lib/gate.js by scripts/sync-lib.mjs: edit lib/gate.js, then run it.
//
// Lets one refresh run at a time. A refresh asked for while one runs is kept,
// and runs once when the current one ends, so a settings change still applies.

/**
 * @returns {{ start(): boolean, finish(): boolean }}
 *   `start` is true when the caller may run now. `finish` is true when a
 *   request came in during the run and the caller should run once more.
 */
export function createGate() {
  let running = false;
  let again = false;

  return {
    start() {
      if (running) {
        again = true;
        return false;
      }
      running = true;
      return true;
    },
    finish() {
      running = false;
      if (!again) return false;
      again = false;
      return true;
    },
  };
}
