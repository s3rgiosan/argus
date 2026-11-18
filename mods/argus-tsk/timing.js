// Timing helpers with an injectable clock, so tests run without real timers.

/**
 * @typedef {(context: any, ms: number, handler: (context: any) => void) => { cancel(): void }} Clock
 *   Calls `handler` once after `ms`. `context` is what the caller passed in;
 *   the handler gets the clock's own context (in Herdr, the timer's `cx`).
 */

/**
 * Wraps `fn` so that a burst of calls runs it once, `ms` after the last call.
 * @param {(context: any) => void} fn
 * @param {number} ms
 * @param {Clock} clock
 * @returns {((context: any) => void) & { cancel(): void }}
 */
export function debounce(fn, ms, clock) {
  let pending = null;
  const call = (context) => {
    pending?.cancel();
    pending = clock(context, ms, (next) => {
      pending = null;
      fn(next);
    });
  };
  call.cancel = () => {
    pending?.cancel();
    pending = null;
  };
  return call;
}
