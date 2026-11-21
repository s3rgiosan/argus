// Copied from lib/board-sync.js by scripts/sync-lib.mjs: edit lib/board-sync.js, then run it.
//
// Keeps a forge board in shared state for every open copy of a mod. The copy
// that wins the lock reads the board; the others draw it. A folder watch probes
// the folders of new spaces and forces a read when one holds a new project.
// Herdr's shared state comes in as parameters, so Node can test the flow.

import { createGate } from "./gate.js";
import { holdsLock, lockNeedsRenewal, releasedLock, shouldFetch, takeLock } from "./sync.js";
import { missingProjectKeys, newProjectKeys } from "./remote.js";
import { withFolders, withNote } from "./forge-board.js";

/** How long a forced read waits before it tries again while another copy holds the lock, in ms. */
export const LOCK_RETRY_MS = 1_000;

/**
 * @typedef {{readAt: number, folders: string[], notes: string[], projects: Array<{key: string}>}} Board
 * @typedef {{spawn(body: (cx: any) => unknown): unknown, sleep(ms: number): Promise<void>, notify(): void, timer: {after(ms: number, handler: (cx: any) => void): unknown}}} Cx
 */

/**
 * The board sync of one copy of a mod.
 * @template {Board} B
 * @param {object} options
 * @param {string} options.boardKey The shared-state key of the board.
 * @param {string} options.lockKey The shared-state key of the read lock.
 * @param {string} options.owner This copy's lock owner.
 * @param {string} options.mod The mod name, for log lines.
 * @param {string} options.failure The start of the note a failed read leaves, for example "Could not read the pull requests".
 * @param {(key: string) => unknown} options.shared Herdr's `shared`.
 * @param {(key: string, value: unknown) => void} options.setShared Herdr's `setShared`.
 * @param {() => boolean} options.checking Herdr's `checking`.
 * @param {() => B} options.readBoard The board in shared state, normalized.
 * @param {(startedAt: number) => Promise<B>} options.read One read of the whole board.
 * @param {() => number} options.intervalMs How old the board may get before a read.
 * @param {() => string[]} options.folders The folders of the open local spaces (`localFolders`).
 * @param {{probeNew(folders: string[], retryMs: number): Promise<unknown[]>}} options.forge The mod's forge runner.
 * @param {(board: B) => number} [options.fetchedAt] When the board counts as read; `readAt` by default.
 * @param {(next: B, current: B, startedAt: number) => B} [options.merge] What a read writes, given the board in shared state at its end.
 */
export function createBoardSync({ boardKey, lockKey, owner, mod, failure, shared, setShared, checking, readBoard, read, intervalMs, folders, forge, fetchedAt = (board) => board.readAt, merge = (next) => next }) {
  const gate = createGate();
  let force = false;
  // The project keys that caused a forced read, or null when the force has no key list.
  let forceKeys = null;
  let probing = false;
  let reading = false;
  const holds = () => holdsLock(shared(lockKey), owner, Date.now());

  /** Starts a sync in a task. */
  function start(cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      await sync(cx);
    });
  }

  /** Asks for a read now, in this copy, even when the board looks fresh. */
  function refresh(cx) {
    force = true;
    forceKeys = null;
    start(cx);
    cx.notify();
  }

  /** Gives the lock back when this copy holds it. */
  function release() {
    if (holds()) setShared(lockKey, releasedLock(owner));
  }

  /** Extends the lock while this copy holds it and less than half of its time is left. */
  function renew() {
    const now = Date.now();
    if (lockNeedsRenewal(shared(lockKey), owner, now)) setShared(lockKey, takeLock(owner, now));
  }

  /**
   * Reads the board into shared state when it is older than the interval (or a read was
   * forced) and no other copy holds the lock. A read that throws leaves one note on the board.
   */
  async function sync(cx) {
    if (checking() || !gate.start()) return;
    let didRead = false;
    try {
      // Another copy may have read the project that asked for this force.
      if (force && forceKeys !== null && missingProjectKeys(forceKeys, readBoard().projects).length === 0) {
        force = false;
        forceKeys = null;
      }
      const startedAt = Date.now();
      const due = shouldFetch({ now: startedAt, fetchedAt: fetchedAt(readBoard()), lock: shared(lockKey), intervalMs: intervalMs(), owner, force });
      if (!due) {
        // Another copy is reading; check again once it is done.
        if (force) cx.timer.after(LOCK_RETRY_MS, (cx) => start(cx));
        return;
      }

      setShared(lockKey, takeLock(owner, startedAt));
      if (!holds()) return;
      force = false;
      forceKeys = null;
      didRead = true;
      reading = true;
      cx.notify();

      const folderedBefore = new Set(readBoard().folders);
      const next = await read(startedAt);
      if (!holds()) return;
      const current = readBoard();
      // Folders that the folder watch added to the board during the read stay on it.
      const added = current.folders.filter((folder) => !folderedBefore.has(folder));
      setShared(boardKey, withFolders(merge(next, current, startedAt), added));
    } catch (caught) {
      const text = `${failure}: ${caught?.message ?? String(caught)}`;
      console.log(`${mod}: ${text}`);
      if (didRead && holds()) setShared(boardKey, withNote(readBoard(), text));
    } finally {
      reading = false;
      release();
      const again = gate.finish();
      if (didRead) cx.notify();
      if (again) start(cx);
    }
  }

  /**
   * Probes the folders the last read did not see, with git only. A project key the board
   * does not have forces a read; any other folder is listed on the board at once, so Follow
   * space stops waiting on it. A folder whose probe could not run waits one interval.
   */
  function watchFolders(cx) {
    if (probing) return;
    const known = new Set(readBoard().folders);
    const unseen = folders().filter((folder) => !known.has(folder));
    if (unseen.length === 0) return;
    probing = true;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      try {
        const probed = await forge.probeNew(unseen, intervalMs());
        const fresh = newProjectKeys(probed.map((entry) => entry ?? null), readBoard().projects);
        if (fresh.length === 0) {
          const board = readBoard();
          const listed = withFolders(board, unseen.filter((_folder, index) => probed[index] !== undefined));
          if (listed !== board) setShared(boardKey, listed);
          return;
        }
        if (!force) forceKeys = [];
        if (forceKeys !== null) forceKeys = [...new Set([...forceKeys, ...fresh])];
        force = true;
        start(cx);
      } catch (caught) {
        console.log(`${mod}: the folder watch failed: ${caught?.message ?? String(caught)}`);
      } finally {
        probing = false;
      }
    });
  }

  return {
    start,
    sync,
    refresh,
    release,
    renew,
    watchFolders,
    /** Whether this copy is reading the board now. */
    get reading() {
      return reading;
    },
  };
}
