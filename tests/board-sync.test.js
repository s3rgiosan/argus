import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoardSync, LOCK_RETRY_MS } from "../lib/board-sync.js";
import { takeLock } from "../lib/sync.js";

const BOARD = "example.board";
const LOCK = "example.lock";

/** A fake of Herdr's shared state and a `cx` whose tasks are kept until `settle()`. */
function harness({ read, folders = () => [], probeNew = async (list) => list.map(() => null), intervalMs = 60_000, merge } = {}) {
  const store = new Map();
  const tasks = [];
  const timers = [];
  let notified = 0;
  const cx = {
    spawn(body) {
      tasks.push(Promise.resolve().then(() => body(cx)));
    },
    sleep: async () => {},
    notify() {
      notified += 1;
    },
    timer: {
      after(ms, handler) {
        timers.push({ ms, handler });
      },
    },
  };
  const readBoard = () => store.get(BOARD) ?? { readAt: 0, folders: [], notes: [], projects: [] };
  const sync = createBoardSync({
    boardKey: BOARD,
    lockKey: LOCK,
    owner: "me",
    mod: "example-mod",
    failure: "Could not read the items",
    shared: (key) => store.get(key),
    setShared: (key, value) => store.set(key, value),
    checking: () => false,
    readBoard,
    read,
    intervalMs: () => intervalMs,
    folders,
    forge: { probeNew },
    ...(merge ? { merge } : {}),
  });
  const settle = async () => {
    while (tasks.length > 0) await tasks.shift();
  };
  return { sync, store, cx, timers, settle, notified: () => notified, readBoard };
}

const board = (overrides = {}) => ({ readAt: Date.now(), folders: [], notes: [], projects: [], ...overrides });

test("a due read writes the board and gives the lock back", async () => {
  const h = harness({ read: async (startedAt) => board({ readAt: startedAt, folders: ["/home/test/a"] }) });
  h.sync.start(h.cx);
  await h.settle();
  assert.deepEqual(h.readBoard().folders, ["/home/test/a"]);
  assert.equal(h.store.get(LOCK).until, 0);
  assert.equal(h.sync.reading, false);
  assert.ok(h.notified() >= 2);
});

test("a fresh board is not read again until a refresh", async () => {
  let reads = 0;
  const h = harness({ read: async () => board({ readAt: Date.now(), notes: [`read ${++reads}`] }) });
  h.store.set(BOARD, board());
  h.sync.start(h.cx);
  await h.settle();
  assert.equal(reads, 0);
  h.sync.refresh(h.cx);
  await h.settle();
  assert.equal(reads, 1);
});

test("a forced read waits while another copy holds the lock", async () => {
  let reads = 0;
  const h = harness({ read: async () => board({ notes: [`read ${++reads}`] }) });
  h.store.set(LOCK, takeLock("other", Date.now()));
  h.sync.refresh(h.cx);
  await h.settle();
  assert.equal(reads, 0);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, LOCK_RETRY_MS);
  h.store.delete(LOCK);
  h.timers[0].handler(h.cx);
  await h.settle();
  assert.equal(reads, 1);
});

test("a read that throws leaves one note on the board", async () => {
  const h = harness({
    read: async () => {
      throw new Error("boom");
    },
  });
  const logged = [];
  const log = console.log;
  console.log = (line) => logged.push(line);
  try {
    h.sync.start(h.cx);
    await h.settle();
  } finally {
    console.log = log;
  }
  assert.deepEqual(h.readBoard().notes, ["Could not read the items: boom"]);
  assert.deepEqual(logged, ["example-mod: Could not read the items: boom"]);
  assert.equal(h.store.get(LOCK).until, 0);
});

test("merge sees the board in shared state, and folders the watch added during the read stay", async () => {
  const h = harness({
    read: async (startedAt) => {
      h.store.set(BOARD, { ...h.readBoard(), folders: ["/home/test/new"], staleAt: startedAt + 1 });
      return board({ readAt: startedAt, folders: ["/home/test/a"] });
    },
    merge: (next, current) => ({ ...next, staleAt: current.staleAt }),
  });
  h.sync.start(h.cx);
  await h.settle();
  assert.deepEqual(h.readBoard().folders, ["/home/test/a", "/home/test/new"]);
  assert.equal(typeof h.readBoard().staleAt, "number");
});

test("renew writes the lock only past half of its time", async () => {
  const h = harness({ read: async () => board() });
  h.store.set(LOCK, { owner: "me", until: Date.now() + 100_000 });
  h.sync.renew();
  assert.ok(h.store.get(LOCK).until - Date.now() <= 100_000);
  h.store.set(LOCK, { owner: "me", until: Date.now() + 10_000 });
  h.sync.renew();
  assert.ok(h.store.get(LOCK).until - Date.now() > 100_000);
  h.store.set(LOCK, { owner: "other", until: Date.now() + 10_000 });
  h.sync.renew();
  assert.equal(h.store.get(LOCK).owner, "other");
  h.sync.release();
  assert.equal(h.store.get(LOCK).owner, "other");
});

test("the folder watch lists folders with no new project and forces a read for a new one", async () => {
  let reads = 0;
  const entry = { folder: "/home/test/repo", top: "/home/test/repo", main: "/home/test/repo", remote: "git@github.com:example-org/example-repo.git" };
  let answer = [null, undefined];
  const h = harness({
    read: async () => {
      reads += 1;
      return board({ projects: [{ key: "github.com/example-org/example-repo" }] });
    },
    folders: () => ["/home/test/notes", "/home/test/repo"],
    probeNew: async () => answer,
  });
  h.store.set(BOARD, board());
  h.sync.watchFolders(h.cx);
  await h.settle();
  assert.deepEqual(h.readBoard().folders, ["/home/test/notes"]);
  assert.equal(reads, 0);
  answer = [entry];
  h.sync.watchFolders(h.cx);
  await h.settle();
  assert.equal(reads, 1);
  // Another forced read is dropped once the board holds the project that asked for it.
  h.sync.watchFolders(h.cx);
  await h.settle();
  assert.equal(reads, 1);
});
