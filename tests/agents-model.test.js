import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SNOOZES,
  advance,
  boardItems,
  buildSections,
  cleanTitle,
  duration,
  OLDER_MS,
  holdActive,
  normalizeHolds,
  normalizeTrack,
  pruneHolds,
  reopenHold,
  snoozeHold,
  snoozeUntil,
  untilLabel,
  wakeLabel,
} from "../mods/argus-agents/model.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// 2030-01-02 10:00 local time, a Wednesday.
const NOW = new Date(2030, 0, 2, 10, 0, 0, 0).getTime();

const program = { key: "example", name: "Example Agent", icon: null, tint: false, tile: null, color: null, shell: false, agent: true };

const agent = (over = {}) => ({
  address: "t1",
  pane: "p1",
  space: "s1",
  space_name: "example-repo",
  tab: "tab1",
  tab_index: 1,
  tab_name: "1",
  status: "idle",
  app: "example",
  program,
  title: "Example title",
  seq: 1,
  pinned: false,
  focused: false,
  ...over,
});

const item = (over = {}) => ({ address: "t1", status: "idle", raw: null, turn: null, ...over });

test("advance stamps a first-seen agent and keeps an unchanged one", () => {
  const first = advance({}, [item({ status: "blocked" })], NOW);
  assert.equal(first.changed, true);
  assert.deepEqual(first.track.t1, { s: "waiting", at: NOW, gen: 0, turn: null });
  const again = advance(first.track, [item({ status: "blocked" })], NOW + MIN);
  assert.equal(again.changed, false);
  assert.equal(again.track, first.track);
});

test("a done agent is finished on first sight; an idle one is idle", () => {
  assert.equal(advance({}, [item({ status: "done" })], NOW).track.t1.s, "finished");
  assert.equal(advance({}, [item({ status: "idle" })], NOW).track.t1.s, "idle");
});

test("working then idle is finished, and stays finished after done turns idle", () => {
  let track = advance({}, [item({ status: "working" })], NOW).track;
  track = advance(track, [item({ status: "idle" })], NOW + MIN).track;
  assert.deepEqual(track.t1, { s: "finished", at: NOW + MIN, gen: 1, turn: null });
  const done = advance({}, [item({ status: "done" })], NOW).track;
  const looked = advance(done, [item({ status: "idle" })], NOW + MIN);
  assert.equal(looked.changed, false);
  assert.equal(looked.track.t1.s, "finished");
  assert.equal(looked.track.t1.at, NOW);
});

test("a finish while the pane is focused is idle, and stays idle", () => {
  let track = advance({}, [item({ status: "working", focused: true })], NOW).track;
  track = advance(track, [item({ status: "idle", focused: true })], NOW + MIN).track;
  assert.equal(track.t1.s, "idle");
  assert.equal(track.t1.gen, 1);
  // Focus lost later: still idle.
  const away = advance(track, [item({ status: "idle", focused: false })], NOW + 2 * MIN);
  assert.equal(away.changed, false);
  // Herdr says "done" only when you were not looking, so a focused "done" is finished.
  const done = advance({ t1: { s: "working", at: NOW, gen: 0, turn: null } }, [item({ status: "done", focused: true })], NOW + MIN).track;
  assert.equal(done.t1.s, "finished");
});

test("a finish while the pane is not focused is finished, and stays finished after focus", () => {
  let track = advance({}, [item({ status: "working" })], NOW).track;
  track = advance(track, [item({ status: "idle" })], NOW + MIN).track;
  assert.equal(track.t1.s, "finished");
  const focus = advance(track, [item({ status: "idle", focused: true })], NOW + 2 * MIN);
  assert.equal(focus.changed, false);
  assert.equal(focus.track.t1.s, "finished");
  assert.equal(focus.track.t1.at, NOW + MIN);
});

test("working again ends finished; blocked then idle is idle", () => {
  let track = advance({}, [item({ status: "done" })], NOW).track;
  track = advance(track, [item({ status: "working" })], NOW + MIN).track;
  assert.equal(track.t1.s, "working");
  assert.equal(track.t1.gen, 1);
  track = advance(track, [item({ status: "blocked" })], NOW + 2 * MIN).track;
  track = advance(track, [item({ status: "idle" })], NOW + 3 * MIN).track;
  assert.equal(track.t1.s, "idle");
  assert.equal(track.t1.gen, 3);
});

test("a raw error word is failed, whatever the agent status says", () => {
  const { track } = advance({}, [item({ status: "blocked", raw: "error" })], NOW);
  assert.equal(track.t1.s, "failed");
  const after = advance(track, [item({ status: "idle", raw: "idle" })], NOW + MIN).track;
  assert.equal(after.t1.s, "idle");
});

test("a turn that went up counts as a new finish, even with no working seen", () => {
  let track = advance({}, [item({ status: "idle", turn: 3 })], NOW).track;
  assert.equal(track.t1.s, "idle");
  track = advance(track, [item({ status: "idle", turn: 4 })], NOW + MIN).track;
  assert.deepEqual(track.t1, { s: "finished", at: NOW + MIN, gen: 1, turn: 4 });
  // A second missed working phase is new news: gen and time move.
  track = advance(track, [item({ status: "idle", turn: 5 })], NOW + 2 * MIN).track;
  assert.deepEqual(track.t1, { s: "finished", at: NOW + 2 * MIN, gen: 2, turn: 5 });
  // While working, a turn change alone is stored without a new gen.
  track = advance(track, [item({ status: "working", turn: 5 })], NOW + 3 * MIN).track;
  const working = advance(track, [item({ status: "working", turn: 6 })], NOW + 4 * MIN).track;
  assert.equal(working.t1.gen, track.t1.gen);
  assert.equal(working.t1.turn, 6);
});

test("advance drops agents gone for more than 7 days and keeps newer ones", () => {
  const track = { old: { s: "idle", at: NOW - 8 * DAY, gen: 0, turn: null }, recent: { s: "finished", at: NOW - DAY, gen: 2, turn: null } };
  const next = advance(track, [], NOW);
  assert.equal(next.changed, true);
  assert.deepEqual(Object.keys(next.track), ["recent"]);
});

test("an agent unchanged for 8 days but seen now keeps its entry when missing for one tick", () => {
  let track = { t1: { s: "finished", at: NOW - 8 * DAY, gen: 3, turn: null } };
  track = advance(track, [item({ status: "idle" })], NOW).track;
  assert.equal(track.t1.s, "finished");
  const gone = advance(track, [], NOW + 1000);
  assert.equal(gone.track.t1.s, "finished");
  assert.equal(gone.track.t1.gen, 3);
});

test("advance drops an entry 7 days after the agent was last seen, not after its last change", () => {
  let track = advance({}, [item({ status: "done" })], NOW).track;
  for (let t = 1; t <= 10; t++) track = advance(track, [item({ status: "idle" })], NOW + t * DAY).track;
  assert.equal(advance(track, [], NOW + 16 * DAY).track.t1 !== undefined, true);
  assert.equal(advance(track, [], NOW + 10 * DAY + 7 * DAY + HOUR + 1).track.t1, undefined);
});

test("advance moves the last-seen time at most once an hour, so a steady agent does not write each tick", () => {
  const track = advance({}, [item({ status: "blocked" })], NOW).track;
  assert.equal(advance(track, [item({ status: "blocked" })], NOW + 30 * MIN).changed, false);
  const later = advance(track, [item({ status: "blocked" })], NOW + HOUR + MIN);
  assert.equal(later.changed, true);
  assert.equal(later.track.t1.seen, NOW + HOUR + MIN);
  assert.equal(advance(later.track, [item({ status: "blocked" })], NOW + HOUR + 2 * MIN).changed, false);
});

test("normalizeTrack keeps a numeric seen field", () => {
  assert.deepEqual(normalizeTrack({ a: { s: "idle", at: 5, gen: 0, turn: null, seen: 9 }, b: { s: "idle", at: 5, gen: 0, turn: null, seen: "x" } }), {
    a: { s: "idle", at: 5, gen: 0, turn: null, seen: 9 },
    b: { s: "idle", at: 5, gen: 0, turn: null },
  });
});

test("a raised turn after finished is a new finish: idle while watched, else finished", () => {
  const finished = { t1: { s: "finished", at: NOW, gen: 1, turn: 3 } };
  const watched = advance(finished, [item({ status: "idle", turn: 4, focused: true })], NOW + MIN).track;
  assert.equal(watched.t1.s, "idle");
  const away = advance(finished, [item({ status: "idle", turn: 4, focused: false })], NOW + MIN);
  assert.equal(away.track.t1.s, "finished");
  assert.equal(away.track.t1.gen, 2);
  assert.equal(advance(finished, [item({ status: "idle", turn: 3, focused: true })], NOW + MIN).track.t1.s, "finished");
});

test("normalizeTrack and normalizeHolds keep only well-formed entries", () => {
  assert.deepEqual(normalizeTrack(null), {});
  assert.deepEqual(normalizeTrack([1]), {});
  assert.deepEqual(normalizeTrack({ a: { s: "finished", at: 5, gen: 1, turn: 2 }, b: { s: "nope", at: 1, gen: 0 }, c: "x", __proto__x: 1 }), {
    a: { s: "finished", at: 5, gen: 1, turn: 2 },
  });
  assert.deepEqual(normalizeHolds({ a: { until: null, gen: 1 }, b: { until: 9, gen: 0 }, c: { until: "x", gen: 0 }, d: { gen: -1, until: null } }), {
    a: { until: null, gen: 1 },
    b: { until: 9, gen: 0 },
  });
});

test("tomorrow morning is 09:00 today before 09:00, else 09:00 the next day", () => {
  assert.equal(snoozeUntil("tomorrow", new Date(2030, 0, 2, 0, 30).getTime()), new Date(2030, 0, 2, 9, 0).getTime());
  assert.equal(snoozeUntil("tomorrow", new Date(2030, 0, 2, 8, 59).getTime()), new Date(2030, 0, 2, 9, 0).getTime());
  assert.equal(snoozeUntil("tomorrow", new Date(2030, 0, 2, 9, 0).getTime()), new Date(2030, 0, 3, 9, 0).getTime());
});

test("snoozeUntil gives the preset times", () => {
  assert.equal(snoozeUntil("hour", NOW), NOW + HOUR);
  assert.equal(snoozeUntil("hours", NOW), NOW + 3 * HOUR);
  assert.equal(snoozeUntil("tomorrow", NOW), new Date(2030, 0, 3, 9, 0, 0, 0).getTime());
  assert.equal(snoozeUntil("change", NOW), null);
  assert.equal(snoozeUntil("other", NOW), undefined);
  assert.deepEqual(
    SNOOZES.map((s) => s.id),
    ["hour", "hours", "tomorrow", "change"],
  );
});

test("a hold is active until the time passes or the agent changes", () => {
  const entry = { s: "finished", at: NOW, gen: 2, turn: null };
  assert.equal(holdActive({ until: null, gen: 2 }, entry, NOW), true);
  assert.equal(holdActive({ until: NOW + MIN, gen: 2 }, entry, NOW), true);
  assert.equal(holdActive({ until: NOW, gen: 2 }, entry, NOW), false);
  assert.equal(holdActive({ until: null, gen: 1 }, entry, NOW), false);
  assert.equal(holdActive(undefined, entry, NOW), false);
  assert.equal(holdActive({ until: null, gen: 2 }, undefined, NOW), false);
});

test("snoozeHold stores the agent's gen; reopenHold removes the hold", () => {
  const track = { t1: { s: "waiting", at: NOW, gen: 4, turn: null } };
  const holds = snoozeHold({}, track, "t1", "hour", NOW);
  assert.deepEqual(holds, { t1: { until: NOW + HOUR, gen: 4 } });
  assert.equal(snoozeHold({}, track, "t9", "hour", NOW), null);
  assert.equal(snoozeHold({}, track, "t1", "other", NOW), null);
  assert.deepEqual(reopenHold(holds, "t1"), {});
  assert.equal(reopenHold(holds, "t9"), null);
});

test("pruneHolds drops ended holds and keeps live ones", () => {
  const track = { a: { s: "finished", at: NOW, gen: 1, turn: null }, b: { s: "waiting", at: NOW, gen: 3, turn: null }, c: { s: "failed", at: NOW, gen: 0, turn: null } };
  const holds = { a: { until: null, gen: 1 }, b: { until: null, gen: 2 }, c: { until: NOW - 1, gen: 0 }, gone: { until: null, gen: 0 } };
  const next = pruneHolds(holds, track, NOW);
  assert.equal(next.changed, true);
  assert.deepEqual(next.holds, { a: { until: null, gen: 1 } });
  const same = pruneHolds(next.holds, track, NOW);
  assert.equal(same.changed, false);
});

test("boardItems names rows by space and tab, or by the agent's title", () => {
  const rows = boardItems(
    [agent(), agent({ address: "t2", pane: "p2", tab_name: "fix login", title: "✦ Working" }), agent({ address: "t3", pane: "p3", title: "⠋ - Example task" })],
    [{ address: "t1", state: "live", status: "idle", turn: 2 }],
    [],
  );
  assert.deepEqual(
    rows.map((r) => [r.address, r.space, r.detail, r.pane, r.peek, r.raw, r.turn]),
    [
      ["t1", "example-repo", "Example title", "p1", false, "idle", 2],
      ["t2", "example-repo", "fix login", "p2", false, null, null],
      ["t3", "example-repo", "Example task", "p3", false, null, null],
    ],
  );
});

test("boardItems adds failed terminals that have no pane, in Herdr's spaces only", () => {
  const rows = boardItems(
    [agent()],
    [
      { address: "t5", state: "live", status: "error", parent: "t1", name: "helper", labels: {} },
      { address: "t6", state: "live", status: "error", labels: { "herdr.space": "s2" }, template: "reviewer" },
      { address: "t7", state: "live", status: "error", labels: {} },
      { address: "t8", state: "finished", status: "error", labels: { "herdr.space": "s2" } },
      { address: "t9", state: "live", status: "idle", parent: "t1" },
    ],
    [{ id: "s2", name: "other-repo" }],
  );
  assert.deepEqual(
    rows.map((r) => [r.address, r.space, r.detail, r.peek, r.status, r.raw]),
    [
      ["t1", "example-repo", "Example title", false, "idle", null],
      ["t5", "example-repo", "helper", true, "idle", "error"],
      ["t6", "other-repo", "reviewer", true, "idle", "error"],
    ],
  );
});

test("buildSections groups, sorts newest first with pinned on top, and shelves snoozed rows", () => {
  const items = [
    { address: "a", status: "blocked", pinned: false },
    { address: "b", status: "blocked", pinned: true },
    { address: "c", status: "done", pinned: false },
    { address: "d", status: "done", pinned: false },
    { address: "e", status: "working", pinned: false },
    { address: "f", status: "idle", pinned: false },
    { address: "g", status: "idle", pinned: false },
  ];
  const track = {
    a: { s: "waiting", at: NOW - MIN, gen: 0, turn: null },
    b: { s: "waiting", at: NOW - HOUR, gen: 0, turn: null },
    c: { s: "finished", at: NOW - 2 * MIN, gen: 1, turn: null },
    d: { s: "finished", at: NOW - 3 * MIN, gen: 1, turn: null },
    e: { s: "working", at: NOW, gen: 0, turn: null },
    f: { s: "idle", at: NOW, gen: 0, turn: null },
    g: { s: "failed", at: NOW, gen: 0, turn: null },
  };
  const holds = { d: { until: null, gen: 1 }, a: { until: NOW - 1, gen: 0 } };
  const s = buildSections(items, track, holds, NOW);
  assert.deepEqual(s.waiting.map((r) => r.address), ["b", "a"]);
  assert.deepEqual(s.failed.map((r) => r.address), ["g"]);
  assert.deepEqual(s.finished.map((r) => r.address), ["c"]);
  assert.deepEqual(s.snoozed.map((r) => [r.address, r.kind, r.until]), [["d", "finished", null]]);
  assert.deepEqual(s.working.map((r) => r.address), ["e"]);
  assert.deepEqual(s.idle.map((r) => r.address), ["f"]);
  assert.deepEqual(s.older, []);
  assert.equal(s.waiting[0].since, NOW - HOUR);
});

test("buildSections moves finished rows older than OLDER_MS to older, and keeps the boundary in finished", () => {
  const items = ["a", "b", "c"].map((address) => ({ address, status: "idle", pinned: false }));
  const track = {
    a: { s: "finished", at: NOW - OLDER_MS, gen: 1, turn: null },
    b: { s: "finished", at: NOW - OLDER_MS - 1, gen: 1, turn: null },
    c: { s: "finished", at: NOW - 5 * HOUR, gen: 1, turn: null },
  };
  const s = buildSections(items, track, {}, NOW);
  assert.deepEqual(s.finished.map((r) => r.address), ["a"]);
  assert.deepEqual(s.older.map((r) => r.address), ["b", "c"]);
});

test("a snoozed older row goes to snoozed, and returns to older on reopen", () => {
  const items = [{ address: "a", status: "idle", pinned: false }];
  const track = { a: { s: "finished", at: NOW - 3 * HOUR, gen: 2, turn: null } };
  const held = buildSections(items, track, { a: { until: null, gen: 2 } }, NOW);
  assert.deepEqual(held.snoozed.map((r) => [r.address, r.kind]), [["a", "finished"]]);
  assert.deepEqual(held.older, []);
  const reopened = buildSections(items, track, {}, NOW);
  assert.deepEqual(reopened.older.map((r) => r.address), ["a"]);
});

test("untilLabel names the wake time", () => {
  assert.equal(untilLabel(null, NOW), "Until it changes");
  assert.equal(untilLabel(NOW + 8 * HOUR + 5 * MIN, NOW), "Until 18:05");
  assert.equal(untilLabel(new Date(2030, 0, 3, 9, 0).getTime(), NOW), "Until Thu 09:00");
});

test("wakeLabel gives the menu's wake time, or null", () => {
  assert.equal(wakeLabel(snoozeUntil("hour", NOW), NOW), "11:00");
  assert.equal(wakeLabel(snoozeUntil("tomorrow", NOW), NOW), "Thu 09:00");
  assert.equal(wakeLabel(snoozeUntil("change", NOW), NOW), null);
});

test("duration uses the largest unit", () => {
  assert.equal(duration(30_000), "<1m");
  assert.equal(duration(5 * MIN), "5m");
  assert.equal(duration(2 * HOUR + 5 * MIN), "2h");
  assert.equal(duration(3 * DAY), "3d");
  assert.equal(duration(-5), "<1m");
});

test("cleanTitle drops a leading status glyph and keeps brackets", () => {
  assert.equal(cleanTitle("✦  Working"), "Working");
  assert.equal(cleanTitle("[ ! ] Example"), "Example");
  assert.equal(cleanTitle("[web] login"), "[web] login");
  assert.equal(cleanTitle(null), "");
});
