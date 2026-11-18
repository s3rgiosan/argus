import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRows, parseTask, parseError } from "../mods/argus-tsk/model.js";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("rows fixture parses to 3 rows with expected statuses", () => {
  const rows = parseRows(fixture("tsk-rows.json"));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.status), ["open", "blocked", "review"]);
  assert.equal(rows[0].project, null);
  assert.equal(rows[0].block, undefined);
  assert.deepEqual(rows[0].before, [2]);
  assert.equal(rows[1].assigneeKind, "human");
  assert.deepEqual(rows[1].after, [{ task: 1, done: false }]);
  assert.equal(rows[1].block.on, "human");
  assert.deepEqual(rows[1].block.options, ["A", "B"]);
  assert.equal(rows[2].review.on, "human");
});

test("detail fixture has blocked-style fields, steps and past entries", () => {
  const d = parseTask(fixture("tsk-task.json"));
  assert.equal(d.number, 3);
  assert.equal(d.notes, "Example notes");
  assert.equal(d.steps.length, 2);
  assert.equal(d.steps[1].shortId, "s2");
  assert.equal(d.steps[0].done, true);
  assert.equal(d.pastBlocks.length, 1);
  assert.equal(d.pastBlocks[0].closedBy, "human");
  assert.deepEqual(d.pastBlocks[0].closedAt, [1690000100, 0]);
  assert.equal(d.pastReviews.length, 1);
  assert.equal(d.pastReviews[0].resolution, "changes");
  assert.equal(d.activity.length, 2);
  assert.equal(d.activity[1].by, null);
  assert.equal(d.dispatch, null);
});

test("detail fixture has a review with 2 checks", () => {
  const d = parseTask(fixture("tsk-task.json"));
  assert.equal(d.review.checks.length, 2);
  assert.deepEqual(d.review.checks.map((c) => c.state), ["passed", "failed"]);
  assert.equal(d.review.round, 2);
  assert.equal(d.review.feedback[0].text, "Looks ok");
});

test("parseTask accepts a bare object", () => {
  const [first] = JSON.parse(fixture("tsk-task.json"));
  assert.equal(parseTask(JSON.stringify(first)).number, 3);
});

test("an unknown status and check state parse as unknown", () => {
  const text = JSON.stringify([
    {
      id: "x", number: 1, title: "T", status: "paused", project: null, thread: null,
      assignee: null, assignee_kind: null, base: null, after: [], before: [],
      review: {
        round: 1, done: null, checks: [{ text: "c", state: "skipped" }], next: null,
        on: "human", by: "bot", at: [1, 0], edited: false, feedback: [], answered: false,
      },
    },
  ]);
  const [row] = parseRows(text);
  assert.equal(row.status, "unknown");
  assert.equal(row.review.checks[0].state, "unknown");
});

test("a block and review without optional fields get defaults", () => {
  const [row] = parseRows(
    JSON.stringify([
      {
        id: "x", number: 1, title: "T", status: "blocked", project: null, thread: null,
        assignee: null, assignee_kind: null, base: null, after: [], before: [],
        block: { on: "human", by: "bot", at: [1, 0] },
        review: { on: "human", by: "bot", at: [1, 0] },
      },
    ]),
  );
  assert.deepEqual(row.block.options, []);
  assert.deepEqual(row.block.replies, []);
  assert.equal(row.block.edited, false);
  assert.equal(row.block.answered, false);
  assert.equal(row.block.why, null);
  assert.equal(row.block.closedAt, null);
  assert.deepEqual(row.review.checks, []);
  assert.deepEqual(row.review.feedback, []);
  assert.equal(row.review.round, 0);
  assert.equal(row.review.edited, false);
  assert.equal(row.review.resolution, null);
});

test("a row missing a required field is rejected", () => {
  assert.deepEqual(parseRows('[{"id":"x","number":1}]'), []);
  assert.equal(parseTask('[{"id":"x","number":1}]'), null);
});

test("unknown fields are ignored", () => {
  const rows = JSON.parse(fixture("tsk-rows.json"));
  rows[0].new_field = 1;
  const parsed = parseRows(JSON.stringify(rows));
  assert.equal(parsed.length, 3);
  assert.equal("new_field" in parsed[0], false);
});

test("garbage input gives [] and null", () => {
  assert.deepEqual(parseRows("not json"), []);
  assert.deepEqual(parseRows(""), []);
  assert.deepEqual(parseRows('{"a":1}'), []);
  assert.equal(parseTask("not json"), null);
  assert.equal(parseTask("[]"), null);
});

test("parseError maps exit codes", () => {
  assert.deepEqual(parseError("tsk add: empty-title: title is empty", 1), {
    kind: "refused", code: "empty-title", message: "title is empty",
  });
  assert.deepEqual(parseError("something odd\n", 1), {
    kind: "refused", code: "unknown", message: "something odd",
  });
  assert.deepEqual(parseError("bad flag\n", 2), { kind: "usage", message: "bad flag" });
  assert.deepEqual(parseError("disk", 3), { kind: "store", message: "disk" });
  assert.deepEqual(parseError("boom", 9), { kind: "unexpected", exit: 9, message: "boom" });
  assert.deepEqual(parseError("boom", null), { kind: "unexpected", exit: null, message: "boom" });
});

test("project_title parses into projectTitle on rows and details", () => {
  const rows = JSON.parse(fixture("tsk-rows.json"));
  rows[0].project = "/home/test/sites/example/wp-content";
  rows[0].project_title = "Example Site";
  const parsed = parseRows(JSON.stringify(rows));
  assert.equal(parsed[0].project, "/home/test/sites/example/wp-content");
  assert.equal(parsed[0].projectTitle, "Example Site");
  assert.equal(parsed[1].projectTitle, null);

  const [first] = JSON.parse(fixture("tsk-task.json"));
  first.project_title = "Example Site";
  assert.equal(parseTask(JSON.stringify([first])).projectTitle, "Example Site");
  delete first.project_title;
  assert.equal(parseTask(JSON.stringify([first])).projectTitle, null);
});

test("an empty or non-string project_title is no title", () => {
  const rows = JSON.parse(fixture("tsk-rows.json"));
  rows[0].project_title = "";
  rows[1].project_title = 4;
  const parsed = parseRows(JSON.stringify(rows));
  assert.equal(parsed[0].projectTitle, null);
  assert.equal(parsed[1].projectTitle, null);
});
