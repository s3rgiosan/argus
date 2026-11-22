// Copied from lib/sync.js by scripts/sync-lib.mjs: edit lib/sync.js, then run it.
//
// Decides which open copy of a mod runs the shared read, so only one copy
// reads at a time. Copies share a lock through Herdr's shared state.

export const LOCK_MS = 120_000;

/**
 * Whether this copy should fetch now.
 *
 * @param {{ now: number, fetchedAt?: number, lock?: { owner: string, until: number } | null, intervalMs: number, owner: string, force?: boolean }} input
 * @returns {boolean} False while another copy holds a live lock. Otherwise
 *   true when forced or when the shared data is older than the interval.
 */
export function shouldFetch({ now, fetchedAt, lock, intervalMs, owner, force }) {
  if (lock && lock.owner !== owner && lock.until > now) return false;
  if (force) return true;
  return now - (fetchedAt ?? 0) >= intervalMs;
}

/**
 * A lock for `owner`, valid for LOCK_MS from `now`.
 *
 * @param {string} owner
 * @param {number} now
 */
export function takeLock(owner, now) {
  return { owner, until: now + LOCK_MS };
}

/**
 * Whether `owner` holds a live lock.
 *
 * @param {{ owner: string, until: number } | null | undefined} lock
 * @param {string} owner
 * @param {number} now
 */
export function holdsLock(lock, owner, now) {
  return Boolean(lock) && lock.owner === owner && lock.until > now;
}

/**
 * True when the lock that `owner` holds ends in less than half of `lockMs`. Only then does a
 * long read write the lock again, so it does not render every mod after each step.
 *
 * @param {{ owner: string, until: number } | null | undefined} lock
 * @param {string} owner
 * @param {number} now
 * @param {number} [lockMs]
 * @returns {boolean}
 */
export function lockNeedsRenewal(lock, owner, now, lockMs = LOCK_MS) {
  return holdsLock(lock, owner, now) && lock.until - now < lockMs / 2;
}

/**
 * The lock value that gives the lock back: the same owner, already ended, so
 * another copy can read at once.
 *
 * @param {string} owner
 */
export function releasedLock(owner) {
  return { owner, until: 0 };
}
