// Copied from lib/pool.js by scripts/sync-lib.mjs: edit lib/pool.js, then run it.
//
// Runs async work with a cap on how many tasks run at once. No Herdr imports,
// so Node can test it.

/**
 * Maps `items` through `work` with at most `limit` calls running together.
 * The results keep the order of `items`. A call that rejects rejects the whole
 * map; the calls already running finish, and no new call starts.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit A value below 1 counts as 1.
 * @param {(item: T, index: number) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

/**
 * A limiter for work that starts processes: at most `max` tasks run at once, and the other tasks
 * wait in order. Several nested lists of work can share one limiter.
 * @param {number} max A value below 1 counts as 1.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(max) {
  const cap = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  /** @type {Array<{task: () => Promise<unknown>, resolve: (value: unknown) => void, reject: (error: unknown) => void}>} */
  const waiting = [];
  const next = () => {
    if (active >= cap || waiting.length === 0) return;
    const { task, resolve, reject } = /** @type {(typeof waiting)[number]} */ (waiting.shift());
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}
