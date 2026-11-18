import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFetch, takeLock, holdsLock, LOCK_MS } from "../mods/argus-claude-usage/sync.js";

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
