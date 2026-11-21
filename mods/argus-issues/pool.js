// Runs async work over a list with a cap on how many run at once. No Herdr
// imports, so Node can test it.

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
