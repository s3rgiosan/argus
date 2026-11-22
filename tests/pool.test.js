import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, mapPool } from "../lib/pool.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("mapPool keeps the order of the items", async () => {
  const result = await mapPool([30, 1, 10], 2, async (ms, index) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return `${index}:${ms}`;
  });
  assert.deepEqual(result, ["0:30", "1:1", "2:10"]);
});

test("mapPool never runs more than the limit at once and does use the limit", async () => {
  let running = 0;
  let peak = 0;
  await mapPool(Array.from({ length: 10 }, (_, i) => i), 4, async () => {
    running++;
    peak = Math.max(peak, running);
    await tick();
    running--;
  });
  assert.equal(peak, 4);
});

test("mapPool: an empty list, and a limit below 1 counts as 1", async () => {
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
  let running = 0;
  let peak = 0;
  await mapPool([1, 2, 3], 0, async () => {
    running++;
    peak = Math.max(peak, running);
    await tick();
    running--;
  });
  assert.equal(peak, 1);
});

test("mapPool: a rejection rejects the call", async () => {
  await assert.rejects(mapPool([1, 2], 2, async (n) => {
    if (n === 2) throw new Error("boom");
    return n;
  }), { message: "boom" });
});

test("createLimiter runs at most its limit at once, across nested lists, in order", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let most = 0;
  const started = [];
  const task = (name) => () => {
    active += 1;
    most = Math.max(most, active);
    started.push(name);
    return new Promise((resolve) => setTimeout(() => {
      active -= 1;
      resolve(name);
    }, 2));
  };
  const outer = ["a", "b", "c"].map(async (group) => Promise.all([1, 2, 3].map((n) => limit(task(`${group}${n}`)))));
  const results = await Promise.all(outer);
  assert.equal(most, 2);
  assert.deepEqual(results, [["a1", "a2", "a3"], ["b1", "b2", "b3"], ["c1", "c2", "c3"]]);
  assert.deepEqual(started, ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"]);
});

test("createLimiter passes a rejection on and keeps going", async () => {
  const limit = createLimiter(0);
  await assert.rejects(limit(() => Promise.reject(new Error("boom"))), /boom/);
  await assert.rejects(limit(() => { throw new Error("sync"); }), /sync/);
  assert.equal(await limit(async () => 5), 5);
});
