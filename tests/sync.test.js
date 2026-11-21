import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFetch, takeLock, holdsLock, lockNeedsRenewal, releasedLock, LOCK_MS } from "../lib/sync.js";

const now = 1_000_000;
const base = { now, intervalMs: 300_000, owner: "a", force: false, lock: null };

test("fresh data is not fetched, stale data is", () => {
  assert.equal(shouldFetch({ ...base, fetchedAt: now - 10_000 }), false);
  assert.equal(shouldFetch({ ...base, fetchedAt: now - 300_000 }), true);
  assert.equal(shouldFetch({ ...base, fetchedAt: undefined }), true);
});

test("force fetches fresh data", () => {
  assert.equal(shouldFetch({ ...base, fetchedAt: now, force: true }), true);
});

test("another copy's live lock blocks, even with force", () => {
  const lock = { owner: "b", until: now + 1 };
  assert.equal(shouldFetch({ ...base, fetchedAt: 0, lock }), false);
  assert.equal(shouldFetch({ ...base, fetchedAt: 0, lock, force: true }), false);
});

test("an expired lock or one's own lock does not block", () => {
  assert.equal(shouldFetch({ ...base, fetchedAt: 0, lock: { owner: "b", until: now } }), true);
  assert.equal(shouldFetch({ ...base, fetchedAt: 0, lock: { owner: "a", until: now + 5 } }), true);
});

test("takeLock and holdsLock", () => {
  const lock = takeLock("a", now);
  assert.deepEqual(lock, { owner: "a", until: now + LOCK_MS });
  assert.equal(holdsLock(lock, "a", now), true);
  assert.equal(holdsLock(lock, "b", now), false);
  assert.equal(holdsLock(lock, "a", now + LOCK_MS), false);
  assert.equal(holdsLock(null, "a", now), false);
});

test("lockNeedsRenewal writes only in the second half of the lock", () => {
  const now = 1_000_000;
  assert.equal(lockNeedsRenewal({ owner: "a", until: now + LOCK_MS }, "a", now), false);
  assert.equal(lockNeedsRenewal({ owner: "a", until: now + LOCK_MS / 2 }, "a", now), false);
  assert.equal(lockNeedsRenewal({ owner: "a", until: now + LOCK_MS / 2 - 1 }, "a", now), true);
  assert.equal(lockNeedsRenewal({ owner: "b", until: now + 1 }, "a", now), false);
  assert.equal(lockNeedsRenewal({ owner: "a", until: now - 1 }, "a", now), false);
  assert.equal(lockNeedsRenewal(null, "a", now), false);
  assert.equal(lockNeedsRenewal({ owner: "a", until: now + 10 }, "a", now, 30), true);
});

test("releasedLock keeps the owner and ends the lock", () => {
  const lock = releasedLock("a");
  assert.deepEqual(lock, { owner: "a", until: 0 });
  assert.equal(holdsLock(lock, "a", 1), false);
  assert.equal(shouldFetch({ now: 1, fetchedAt: 0, lock, intervalMs: 0, owner: "b" }), true);
});
