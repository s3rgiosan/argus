import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionsFor,
  addAfter,
  addAfterError,
  threadTitle,
  assigneeEdit,
  blockChange,
  changeFor,
  detailState,
  fieldSave,
  lines,
  normalizeChoices,
  patchDetail,
  pickedChange,
  refusalOffer,
  reviewChange,
  statusChoices,
  statusPick,
  taskRef,
} from "../mods/argus-tsk/detail.js";

const task = (over = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  number: 2,
  title: "Example task",
  status: "open",
  assignee: null,
  dispatch: null,
  after: [],
  notes: null,
  steps: [],
  activity: [],
  ...over,
});
const blockOn = (on) => ({ why: "Waiting", needs: null, options: [], on, by: "tester", at: [1700000000, 0], edited: false, replies: [], answered: false });
const reviewOn = (on) => ({ round: 1, done: "Finished the work", checks: [], next: null, on, by: "tester", at: [1700000000, 0], edited: false, feedback: [], answered: false });
const json = (t) => JSON.stringify([{ id: t.id, number: t.number, title: t.title, status: t.status, after: [], before: [], steps: [], activity: [] }]);

// detailState

const withActivity = (kinds) =>
  JSON.stringify([
    {
      id: "00000000-0000-4000-8000-000000000003",
      number: 3,
      title: "Example task",
      status: "open",
      after: [],
      before: [],
      steps: [],
      // tsk lists activity newest first.
      activity: kinds.map((kind, i) => ({ at: [1700000000 + kinds.length - i, 0], by: "you", kind, detail: null })),
    },
  ]);

test("detailState treats an archived task as missing", () => {
  assert.deepEqual(detailState({ code: 0, stdout: withActivity(["archived", "created"]), stderr: "" }), { kind: "missing" });
});

test("detailState shows a task archived and then unarchived or restored", () => {
  assert.equal(detailState({ code: 0, stdout: withActivity(["unarchived", "archived", "created"]), stderr: "" }).kind, "ok");
  assert.equal(detailState({ code: 0, stdout: withActivity(["restored", "archived", "created"]), stderr: "" }).kind, "ok");
});

test("detailState reads the archive state by time, whatever the activity order", () => {
  const archivedLast = JSON.parse(withActivity(["archived", "unarchived", "created"]));
  archivedLast[0].activity[0].at = [1700000009, 0];
  archivedLast[0].activity[1].at = [1700000005, 0];
  assert.deepEqual(detailState({ code: 0, stdout: JSON.stringify(archivedLast), stderr: "" }), { kind: "missing" });
  const reversed = JSON.parse(withActivity(["unarchived", "archived", "created"]));
  reversed[0].activity.reverse();
  assert.equal(detailState({ code: 0, stdout: JSON.stringify(reversed), stderr: "" }).kind, "ok");
});

test("detailState reads a task from a successful run", () => {
  const state = detailState({ code: 0, stdout: json(task({ number: 5, title: "Five" })), stderr: "" });
  assert.equal(state.kind, "ok");
  assert.equal(state.task.number, 5);
  assert.equal(state.task.title, "Five");
});

test("detailState maps tsk's unknown task usage error to missing", () => {
  const state = detailState({ code: 2, stdout: "", stderr: "tsk list: unknown task\nusage: tsk list [<task>] [--json]\n" });
  assert.deepEqual(state, { kind: "missing" });
});

test("detailState maps an unknown-task refusal to missing", () => {
  const state = detailState({ code: 1, stdout: "", stderr: "tsk edit: unknown-task: T9 is not on the board\n" });
  assert.deepEqual(state, { kind: "missing" });
});

test("detailState reports other failures with their message", () => {
  assert.deepEqual(detailState({ code: 3, stdout: "", stderr: "store is locked" }), { kind: "error", message: "store is locked" });
  assert.deepEqual(detailState({ error: { kind: "missing", message: "tsk not found" } }), { kind: "error", message: "tsk not found" });
});

test("detailState reports output it cannot read as an error", () => {
  assert.equal(detailState({ code: 0, stdout: "not json", stderr: "" }).kind, "error");
});

// statusChoices

test("lists the states with the current one selected", () => {
  const choices = statusChoices(task({ status: "ready" }));
  assert.deepEqual(
    choices.map((c) => c.label),
    ["Open", "Ready", "Started", "Done"],
  );
  assert.deepEqual(
    choices.filter((c) => c.current).map((c) => c.label),
    ["Ready"],
  );
  assert.ok(choices.every((c) => c.enabled));
});

test("shows a blocked task's state without offering it as a choice", () => {
  const choices = statusChoices(task({ status: "blocked", block: blockOn("you") }));
  const current = choices.find((c) => c.current);
  assert.deepEqual(current, { status: "blocked", label: "Blocked", current: true, enabled: false });
  assert.equal(choices.length, 5);
});

test("shows a status it does not know as Unknown, without offering it as a choice", () => {
  const current = statusChoices(task({ status: "unknown" })).find((c) => c.current);
  assert.deepEqual(current, { status: "unknown", label: "Unknown", current: true, enabled: false });
});

// actionsFor

test("offers the changes that need more input, and starting without an agent for an assigned task", () => {
  assert.deepEqual(actionsFor(task({ status: "ready", assignee: "agent-a" })), ["block", "requestReview", "startQuiet", "markDone", "archive"]);
});

test("offers starting without an agent only for an assigned task", () => {
  assert.deepEqual(actionsFor(task({ status: "ready" })), ["block", "requestReview", "markDone", "archive"]);
});

test("offers no reply on a task with nothing open", () => {
  for (const status of ["open", "ready", "started", "done"]) {
    const actions = actionsFor(task({ status }));
    assert.ok(!actions.includes("reply"), status);
    assert.ok(!actions.includes("answer"), status);
    assert.ok(!actions.includes("sendBack"), status);
    assert.ok(!actions.includes("approve"), status);
  }
});

test("offers a reply and an answer on a blocked task", () => {
  assert.deepEqual(actionsFor(task({ status: "blocked", block: blockOn("you") })), ["block", "requestReview", "answer", "markDone", "reply", "archive"]);
});

test("offers send back, approve and a reply on a task in review", () => {
  assert.deepEqual(actionsFor(task({ status: "review", review: reviewOn("you") })), ["block", "requestReview", "sendBack", "approve", "markDone", "reply", "archive"]);
});

test("offers mark done on every status but done, and archive on every status", () => {
  assert.ok(!actionsFor(task({ status: "done" })).includes("markDone"));
  assert.ok(actionsFor(task({ status: "done" })).includes("archive"));
  for (const status of ["open", "ready", "started", "blocked", "review", "unknown"]) {
    const actions = actionsFor(task({ status }));
    assert.ok(actions.includes("markDone"), status);
    assert.ok(actions.includes("archive"), status);
  }
});

// changeFor

test("maps each choice and action to its status change", () => {
  assert.deepEqual(changeFor("open"), { kind: "open" });
  assert.deepEqual(changeFor("ready"), { kind: "ready" });
  assert.deepEqual(changeFor("started"), { kind: "start", dispatch: true, again: false, force: false });
  assert.deepEqual(changeFor("startQuiet"), { kind: "start", dispatch: false, again: false, force: false });
  assert.deepEqual(changeFor("done"), { kind: "done", clean: false });
  assert.deepEqual(changeFor("markDone"), { kind: "done", clean: false });
  assert.deepEqual(changeFor("approve"), { kind: "done", clean: false });
  assert.equal(changeFor("archive"), null);
});

// refusalOffer

test("offers a relaunch after an agent-gone refusal", () => {
  const offer = refusalOffer({ code: "agent-gone", number: 2, change: { kind: "start", dispatch: true, again: false, force: false } }, 2);
  assert.deepEqual(offer, { label: "Relaunch", change: { kind: "start", dispatch: true, again: true, force: false } });
});

test("offers start anyway after an after-not-done refusal of a start", () => {
  const original = { kind: "start", dispatch: false, again: false, force: false };
  assert.deepEqual(refusalOffer({ code: "after-not-done", number: 2, change: original }, 2), { label: "Start Anyway", change: { ...original, force: true } });
  assert.equal(refusalOffer({ code: "after-not-done", number: 2, change: { kind: "ready" } }, 2), null);
});

test("offers nothing for another task's refusal or another code", () => {
  assert.equal(refusalOffer({ code: "agent-gone", number: 3, change: { kind: "ready" } }, 2), null);
  assert.equal(refusalOffer({ code: "unknown", number: 2, change: { kind: "ready" } }, 2), null);
  assert.equal(refusalOffer(null, 2), null);
});

// Block and review forms

test("lines keeps each non-empty trimmed line once, in order", () => {
  assert.deepEqual(lines("Ship\n Hold \nShip\n\nHold"), ["Ship", "Hold"]);
});

test("a block sends trimmed values and each option once", () => {
  assert.deepEqual(blockChange({ why: "  Needs a decision  ", needs: "", options: "Ship\n Hold \nShip\n\nHold" }), {
    kind: "blocked",
    why: "Needs a decision",
    needs: null,
    options: ["Ship", "Hold"],
    on: null,
  });
});

test("a review request sends trimmed values and each check once", () => {
  assert.deepEqual(reviewChange({ done: " All finished ", checks: "Looks right\nLooks right", next: " " }), {
    kind: "review",
    done: "All finished",
    checks: ["Looks right"],
    next: null,
    on: null,
  });
});

// Assignee and runs after

test("assigneeEdit assigns, unassigns, and skips an unchanged value", () => {
  assert.deepEqual(assigneeEdit(task({ assignee: null }), " agent-a "), { assignee: "agent-a" });
  assert.deepEqual(assigneeEdit(task({ assignee: "agent-a" }), "  "), { unassign: true });
  assert.equal(assigneeEdit(task({ assignee: "agent-a" }), "agent-a"), null);
  assert.equal(assigneeEdit(task({ assignee: null }), ""), null);
});

test("taskRef reads a task number with or without its T", () => {
  assert.equal(taskRef("T7"), 7);
  assert.equal(taskRef(" t12 "), 12);
  assert.equal(taskRef("7"), 7);
  assert.equal(taskRef("T0"), null);
  assert.equal(taskRef("seven"), null);
  assert.equal(taskRef(""), null);
});

test("addAfter writes the runs-after list with the new task", () => {
  assert.deepEqual(addAfter(task({ number: 2 }), 7), [7]);
  assert.deepEqual(addAfter(task({ number: 2, after: [{ task: 5, done: false }] }), 7), [5, 7]);
  assert.equal(addAfter(task({ number: 2, after: [{ task: 7, done: true }] }), 7), null);
  assert.equal(addAfter(task({ number: 2 }), 2), null);
});

test("addAfterError names why a task cannot be added", () => {
  assert.equal(addAfterError(task({ number: 2 }), 2), "A task cannot run after itself.");
  assert.equal(addAfterError(task({ number: 2, after: [{ task: 7, done: true }] }), 7), "T7 already runs before this task.");
  assert.equal(addAfterError(task({ number: 2 }), null), "Type the number of another task, such as T7.");
});

test("threadTitle reads In Review for a review with or without a round", () => {
  assert.equal(threadTitle({ status: "review", review: { round: 2 } }), "In Review · Round 2");
  assert.equal(threadTitle({ status: "review" }), "In Review");
  assert.equal(threadTitle({ status: "blocked" }), "Blocked");
});

// patchDetail

test("patchDetail maps each status change to a status without mutating", () => {
  const d = task({ status: "ready" });
  assert.equal(patchDetail(d, { kind: "status", change: { kind: "done", clean: false } }).status, "done");
  assert.equal(patchDetail(d, { kind: "status", change: { kind: "open" } }).status, "open");
  assert.equal(patchDetail(d, { kind: "status", change: { kind: "start", dispatch: false, again: false, force: false } }).status, "started");
  assert.equal(patchDetail(d, { kind: "status", change: { kind: "blocked", why: null, needs: null, options: [], on: null } }).status, "blocked");
  assert.equal(patchDetail(d, { kind: "status", change: { kind: "review", done: null, checks: [], next: null, on: null } }).status, "review");
  assert.equal(d.status, "ready");
});

test("patchDetail applies edits to title, notes and assignee", () => {
  const d = task({ assignee: "agent-a" });
  assert.deepEqual(
    (({ title, notes, assignee }) => ({ title, notes, assignee }))(patchDetail(d, { kind: "edit", input: { title: "New", notes: "n", assignee: "agent-b" } })),
    { title: "New", notes: "n", assignee: "agent-b" },
  );
  const cleared = patchDetail(d, { kind: "edit", input: { unassign: true } });
  assert.equal(cleared.assignee, null);
  assert.equal(cleared.title, "Example task");
  assert.equal(patchDetail(task({ notes: "old" }), { kind: "edit", input: { notes: "" } }).notes, "");
});

test("patchDetail patches steps for toggle, rename and remove", () => {
  const steps = [
    { id: "a-full", shortId: "a", text: "one", done: false },
    { id: "b-full", shortId: "b", text: "two", done: false },
  ];
  const d = task({ steps });
  assert.equal(patchDetail(d, { kind: "step", op: { kind: "toggle", id: "a" } }).steps[0].done, true);
  assert.equal(patchDetail(d, { kind: "step", op: { kind: "rename", id: "b", text: "x" } }).steps[1].text, "x");
  assert.deepEqual(
    patchDetail(d, { kind: "step", op: { kind: "remove", id: "a-full" } }).steps.map((s) => s.shortId),
    ["b"],
  );
  assert.equal(d.steps[0].done, false);
});

test("patchDetail leaves steps unchanged for add and move", () => {
  const d = task({ steps: [{ id: "a", shortId: "a", text: "one", done: false }] });
  assert.deepEqual(patchDetail(d, { kind: "step", op: { kind: "add", text: "n" } }).steps, d.steps);
  assert.deepEqual(patchDetail(d, { kind: "step", op: { kind: "move", id: "a", place: { kind: "last" } } }).steps, d.steps);
});

// status dropdown

test("pickedChange: a pick of another enabled status writes its change", () => {
  const choices = statusChoices(task({ status: "open" }));
  assert.deepEqual(pickedChange(choices, "ready"), { change: { kind: "ready" }, label: "Mark Ready" });
  assert.deepEqual(pickedChange(choices, "started"), { change: changeFor("started"), label: "Mark Started" });
  assert.deepEqual(pickedChange(choices, "done"), { change: changeFor("done"), label: "Mark Done" });
});
test("pickedChange: the current, a disabled or an unknown status writes nothing", () => {
  const choices = statusChoices(task({ status: "blocked", block: blockOn("you") }));
  assert.equal(pickedChange(statusChoices(task({ status: "open" })), "open"), null);
  assert.equal(pickedChange(choices, "blocked"), null);
  assert.equal(pickedChange(choices, "paused"), null);
});

test("statusPick: takes a new pick for this pane and the shown task", () => {
  const value = { owner: "pane-1", number: 2, status: "ready", at: 200 };
  assert.deepEqual(statusPick(value, { owner: "pane-1", number: 2, since: 100 }), { status: "ready", at: 200, run: true });
});
test("statusPick: a new pick for another task, or while none is shown, is consumed and not run", () => {
  const value = { owner: "pane-1", number: 2, status: "ready", at: 200 };
  assert.deepEqual(statusPick(value, { owner: "pane-1", number: 3, since: 100 }), { status: "ready", at: 200, run: false });
  assert.deepEqual(statusPick(value, { owner: "pane-1", number: null, since: 100 }), { status: "ready", at: 200, run: false });
});
test("statusPick: skips a pick already handled or for another pane", () => {
  const value = { owner: "pane-1", number: 2, status: "ready", at: 200 };
  assert.equal(statusPick(value, { owner: "pane-1", number: 2, since: 200 }), null);
  assert.equal(statusPick(value, { owner: "pane-2", number: 2, since: 100 }), null);
});
test("statusPick: skips malformed values", () => {
  const ctx = { owner: "pane-1", number: 2, since: 0 };
  assert.equal(statusPick(null, ctx), null);
  assert.equal(statusPick("ready", ctx), null);
  assert.equal(statusPick({ owner: "pane-1", number: 2, at: 5 }, ctx), null);
  assert.equal(statusPick({ owner: "pane-1", number: 2, status: "ready" }, ctx), null);
  assert.equal(statusPick({ owner: "pane-1", number: "2", status: "ready", at: 5 }, ctx), null);
});

test("normalizeChoices: keeps well-formed choices from popup props", () => {
  const choices = statusChoices(task({ status: "review", review: reviewOn("you") }));
  assert.deepEqual(normalizeChoices(choices), choices);
  assert.deepEqual(
    normalizeChoices([{ status: "open", label: "Open" }, { label: "No status" }, 4, { status: "done", label: "Done", current: true, enabled: false }]),
    [
      { status: "open", label: "Open", current: false, enabled: false },
      { status: "done", label: "Done", current: true, enabled: false },
    ],
  );
  assert.deepEqual(normalizeChoices(undefined), []);
});

// fieldSave
test("fieldSave: a field left as it was at the last sync saves nothing, even when tsk changed since", () => {
  const t = task({ title: "Changed by an agent", notes: "New notes", assignee: "agent" });
  assert.deepEqual(fieldSave("title", "Example task", "Example task", t), { kind: "none" });
  assert.deepEqual(fieldSave("notes", "Old notes", "Old notes", t), { kind: "none" });
  assert.deepEqual(fieldSave("assignee", "", "", t), { kind: "none" });
});
test("fieldSave: an edited title writes the trimmed text; empty resets; tsk's own text saves nothing", () => {
  const t = task({ title: "Example task" });
  assert.deepEqual(fieldSave("title", "  New title ", "Example task", t), { kind: "write", input: { title: "New title" } });
  assert.deepEqual(fieldSave("title", "  ", "Example task", t), { kind: "reset" });
  assert.deepEqual(fieldSave("title", "Example task ", "Example", t), { kind: "none" });
});
test("fieldSave: edited notes write as typed, including empty to clear", () => {
  const t = task({ notes: "Some notes" });
  assert.deepEqual(fieldSave("notes", "Other notes", "Some notes", t), { kind: "write", input: { notes: "Other notes" } });
  assert.deepEqual(fieldSave("notes", "", "Some notes", t), { kind: "write", input: { notes: "" } });
  assert.deepEqual(fieldSave("notes", "Some notes", "Old", t), { kind: "none" });
});
test("fieldSave: an edited assignee assigns or unassigns", () => {
  const t = task({ assignee: "ana" });
  assert.deepEqual(fieldSave("assignee", "bob", "ana", t), { kind: "write", input: { assignee: "bob" } });
  assert.deepEqual(fieldSave("assignee", "", "ana", t), { kind: "write", input: { unassign: true } });
  assert.deepEqual(fieldSave("assignee", "ana", "old", t), { kind: "none" });
});
