import { test } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../mods/argus-tsk/timing.js";

/** A clock that runs its timers only when `advance` moves time past them. */
function fakeClock() {
  let now = 0;
  let timers = [];
  const clock = (context, ms, handler) => {
    const timer = { at: now + ms, handler, context, cancelled: false };
    timers.push(timer);
    return {
      cancel() {
        timer.cancelled = true;
      },
    };
  };
  clock.advance = (ms) => {
    now += ms;
    const due = timers.filter((t) => !t.cancelled && t.at <= now);
    timers = timers.filter((t) => !t.cancelled && t.at > now);
    for (const t of due) t.handler(`${t.context}-later`);
  };
  return clock;
}

test("three calls within 300 ms run once, after the last call", () => {
  const clock = fakeClock();
  const calls = [];
  const reload = debounce((cx) => calls.push(cx), 300, clock);

  reload("a");
  clock.advance(100);
  reload("b");
  clock.advance(100);
  reload("c");
  clock.advance(299);
  assert.deepEqual(calls, []);
  clock.advance(1);
  assert.deepEqual(calls, ["c-later"]);
});

test("calls further apart than the delay each run", () => {
  const clock = fakeClock();
  let count = 0;
  const reload = debounce(() => count++, 300, clock);

  reload("a");
  clock.advance(300);
  reload("b");
  clock.advance(300);
  assert.equal(count, 2);
});

test("cancel drops a pending call", () => {
  const clock = fakeClock();
  let count = 0;
  const reload = debounce(() => count++, 300, clock);

  reload("a");
  reload.cancel();
  clock.advance(1000);
  assert.equal(count, 0);
});
