// Pure rules for the task pane: how a task read turns into what the pane
// shows, which status choices and actions it offers for each status, and the
// tsk changes its forms and fields write.

import { parseError, parseTask } from "./model.js";
import { STATUS_LABELS } from "./board.js";
import { statusOf } from "./flows.js";

/**
 * @typedef {import("./model.js").TaskDetail} TaskDetail
 * @typedef {import("./model.js").TskError} TskError
 * @typedef {{kind: string, [key: string]: any}} StatusChange
 *   The same shapes `statusArgs` in tsk.js accepts.
 * @typedef {{kind: "ok", task: TaskDetail} | {kind: "missing"} | {kind: "error", message: string}} DetailState
 * @typedef {"block"|"requestReview"|"startQuiet"|"answer"|"sendBack"|"approve"|"markDone"|"reply"|"archive"} Action
 * @typedef {{status: string, label: string, current: boolean, enabled: boolean}} StatusChoice
 * @typedef {{code: string, number: number, change: StatusChange}} Refusal
 * @typedef {import("./tsk.js").EditInput} EditInput
 */

/** The states the status control offers. Blocked and review need a form. */
export const STATUS_CHOICES = ["open", "ready", "started", "done"];

/** The name each review check state shows under. */
export const CHECK_LABELS = { open: "Open", passed: "Passed", failed: "Failed", unknown: "Unknown" };

const START = { kind: "start", dispatch: true, again: false, force: false };
const START_QUIET = { kind: "start", dispatch: false, again: false, force: false };
const DONE = { kind: "done", clean: false };

/**
 * Whether a tsk error says the task does not exist: `tsk list <n>` exits 2
 * with "unknown task", and writes refuse with the `unknown-task` code.
 * @param {TskError} error
 */
function isMissing(error) {
  if (error.kind === "refused") return error.code === "unknown-task";
  return error.kind === "usage" && /\bunknown task\b/.test(error.message);
}

const ARCHIVE_KINDS = new Set(["archived", "unarchived", "restored"]);

/**
 * Whether the task's latest archive or unarchive entry is an archive.
 * `tsk list <n>` still prints an archived task, so its activity tells.
 * @param {TaskDetail} task
 */
function isArchived(task) {
  let latest = null;
  for (const entry of task.activity) {
    if (!ARCHIVE_KINDS.has(entry.kind) || !Array.isArray(entry.at)) continue;
    const later = latest === null || entry.at[0] > latest.at[0] || (entry.at[0] === latest.at[0] && entry.at[1] > latest.at[1]);
    if (later) latest = entry;
  }
  return latest?.kind === "archived";
}

/**
 * What the pane shows for one `tsk list <n> --json` run: the exec result
 * `{ code, stdout, stderr }`, or `{ error }` when tsk could not run. An
 * archived task counts as missing.
 * @param {{code?: number, stdout?: string, stderr?: string, error?: {message: string}}} loadResult
 * @returns {DetailState}
 */
export function detailState(loadResult) {
  if (loadResult.error) return { kind: "error", message: loadResult.error.message };
  if (loadResult.code !== 0) {
    const error = parseError(loadResult.stderr ?? "", loadResult.code ?? null);
    return isMissing(error) ? { kind: "missing" } : { kind: "error", message: error.message };
  }
  const task = parseTask(loadResult.stdout ?? "");
  if (task === null) return { kind: "error", message: "tsk printed a task this board cannot read." };
  return isArchived(task) ? { kind: "missing" } : { kind: "ok", task };
}

/**
 * The status control's choices. A blocked, review or unknown status shows as
 * the current one but cannot be picked.
 * @param {{status: string}} task
 * @returns {StatusChoice[]}
 */
export function statusChoices(task) {
  const choices = STATUS_CHOICES.map((status) => ({ status, label: STATUS_LABELS[status], current: task.status === status, enabled: true }));
  if (STATUS_CHOICES.includes(task.status)) return choices;
  return [...choices, { status: task.status, label: STATUS_LABELS[task.status] ?? task.status, current: true, enabled: false }];
}

/**
 * What picking `status` in the status dropdown writes: the change and the
 * label its error names, or null for the current status, a disabled one or
 * one that is not in `choices`.
 * @param {StatusChoice[]} choices
 * @param {string} status
 * @returns {?{change: StatusChange, label: string}}
 */
export function pickedChange(choices, status) {
  const choice = choices.find((c) => c.status === status);
  if (!choice || choice.current || !choice.enabled) return null;
  const change = changeFor(choice.status);
  if (!change) return null;
  return { change, label: choice.status === "done" ? "Mark Done" : `Mark ${choice.label}` };
}

/**
 * A status pick that the status popup left in `shared`, when it is for this
 * pane (`owner`) and newer than `since`. The pane consumes every such pick;
 * `run` is true only when it is for the task the pane shows (`number`), so a
 * pick for a task no longer shown never runs later.
 * @param {unknown} value
 * @param {{owner: string, number: ?number, since: number}} pane
 * @returns {?{status: string, at: number, run: boolean}}
 */
export function statusPick(value, pane) {
  if (!value || typeof value !== "object") return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  if (typeof v.status !== "string" || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  if (!Number.isInteger(v.number) || v.owner !== pane.owner || v.at <= pane.since) return null;
  return { status: v.status, at: v.at, run: v.number === pane.number };
}

/**
 * The status choices the status popup was given in its props. Choices
 * without a status or label are dropped; a missing flag is false.
 * @param {unknown} value
 * @returns {StatusChoice[]}
 */
export function normalizeChoices(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c) => c && typeof c === "object" && typeof c.status === "string" && typeof c.label === "string")
    .map((c) => ({ status: c.status, label: c.label, current: c.current === true, enabled: c.enabled === true }));
}

/**
 * The actions the pane offers for a task, in the order it shows them: the
 * changes that need more input, the open block or review card's actions, then
 * the bottom bar. A done task has no Mark Done.
 * @param {{status: string, assignee: ?string}} task
 * @returns {Action[]}
 */
export function actionsFor(task) {
  /** @type {Action[]} */
  const actions = ["block", "requestReview"];
  if (task.assignee !== null && task.assignee !== undefined) actions.push("startQuiet");
  switch (task.status) {
    case "blocked":
      actions.push("answer");
      break;
    case "review":
      actions.push("sendBack", "approve");
      break;
    default:
      break;
  }
  if (task.status !== "done") actions.push("markDone");
  if (task.status === "blocked" || task.status === "review") actions.push("reply");
  actions.push("archive");
  return actions;
}

/**
 * The status change a status choice or an action writes, or null when it
 * writes something else.
 * @param {string} name
 * @returns {StatusChange | null}
 */
export function changeFor(name) {
  switch (name) {
    case "open":
      return { kind: "open" };
    case "ready":
      return { kind: "ready" };
    case "started":
      return { ...START };
    case "startQuiet":
      return { ...START_QUIET };
    case "done":
    case "markDone":
    case "approve":
      return { ...DONE };
    default:
      return null;
  }
}

/**
 * The follow-up a refused status change offers on the task it refused:
 * a relaunch when the agent is gone, and a forced start when a task it runs
 * after is not done.
 * @param {?Refusal} refusal
 * @param {number} number the task the pane shows
 * @returns {{label: string, change: StatusChange} | null}
 */
export function refusalOffer(refusal, number) {
  if (!refusal || refusal.number !== number) return null;
  switch (refusal.code) {
    case "agent-gone":
      return { label: "Relaunch", change: { kind: "start", dispatch: true, again: true, force: false } };
    case "after-not-done":
      return refusal.change.kind === "start" ? { label: "Start Anyway", change: { ...refusal.change, force: true } } : null;
    default:
      return null;
  }
}

/**
 * The non-empty trimmed lines of a text, each kept once in order of first appearance.
 * @param {string} text
 * @returns {string[]}
 */
export function lines(text) {
  const trimmed = String(text ?? "")
    .split("\n")
    .map((l) => l.trim());
  return [...new Set(trimmed.filter((l) => l !== ""))];
}

/** @param {string} text @returns {string | null} */
function optional(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The change the block form writes. `options` has one option per line.
 * @param {{why: string, needs: string, options: string}} form
 * @returns {StatusChange}
 */
export function blockChange(form) {
  return { kind: "blocked", why: optional(form.why), needs: optional(form.needs), options: lines(form.options), on: null };
}

/**
 * The change the review form writes. `checks` has one check per line.
 * @param {{done: string, checks: string, next: string}} form
 * @returns {StatusChange}
 */
export function reviewChange(form) {
  return { kind: "review", done: optional(form.done), checks: lines(form.checks), next: optional(form.next), on: null };
}

/**
 * The edit the assignee field writes: an empty field unassigns. Null when the
 * value is the current assignee.
 * @param {{assignee: ?string}} task
 * @param {string} value
 * @returns {{assignee: string} | {unassign: true} | null}
 */
export function assigneeEdit(task, value) {
  const name = String(value ?? "").trim();
  if (name === (task.assignee ?? "")) return null;
  return name === "" ? { unassign: true } : { assignee: name };
}

/**
 * What leaving the title, notes or assignee field saves. `baseline` is the
 * field's text at the last time tsk's value was put in it: a field still at
 * its baseline saves nothing, so tsk's newer value is never overwritten with
 * the old text. An edited field writes when it differs from tsk's value; an
 * emptied title goes back to tsk's title.
 * @param {"title"|"notes"|"assignee"} field
 * @param {string} value the field's text
 * @param {string} baseline
 * @param {{title: string, notes?: ?string, assignee: ?string}} task tsk's latest read
 * @returns {{kind: "none"} | {kind: "reset"} | {kind: "write", input: EditInput}}
 */
export function fieldSave(field, value, baseline, task) {
  const none = { kind: "none" };
  if (value === baseline) return none;
  switch (field) {
    case "title": {
      const title = value.trim();
      if (title === "") return { kind: "reset" };
      return title === task.title ? none : { kind: "write", input: { title } };
    }
    case "notes":
      return value === (task.notes ?? "") ? none : { kind: "write", input: { notes: value } };
    case "assignee": {
      const input = assigneeEdit(task, value);
      return input === null ? none : { kind: "write", input };
    }
    default:
      return none;
  }
}

/**
 * A task number typed as `T7`, `t7` or `7`, or null.
 * @param {string} text
 * @returns {number | null}
 */
export function taskRef(text) {
  const match = /^[Tt]?(\d+)$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? number : null;
}

/**
 * The runs-after list with `number` added, or null when the task is itself or
 * already in the list.
 * @param {{number: number, after: {task: number}[]}} task
 * @param {number} number
 * @returns {number[] | null}
 */
export function addAfter(task, number) {
  const current = task.after.map((a) => a.task);
  if (number === task.number || current.includes(number)) return null;
  return [...current, number];
}

/** Steps are addressed by their short id; the full id is accepted too. */
function stepIs(step, id) {
  return step.shortId === id || step.id === id;
}

/**
 * A copy of the task with a write applied, shown until tsk is read again.
 * Covers status changes, edits of title, notes and assignee, and step
 * toggles, renames and removals. Other writes leave the task as it is.
 * @param {TaskDetail} task
 * @param {{kind: "status", change: StatusChange} | {kind: "edit", input: Record<string, any>} | {kind: "step", op: Record<string, any>}} write
 * @returns {TaskDetail}
 */
export function patchDetail(task, write) {
  switch (write.kind) {
    case "status":
      return { ...task, status: /** @type {any} */ (statusOf(write.change)) };
    case "edit": {
      const input = write.input;
      const next = { ...task };
      if (input.title != null) next.title = input.title;
      if (input.notes != null) next.notes = input.notes;
      if (input.unassign) next.assignee = null;
      else if (input.assignee != null) next.assignee = input.assignee;
      return next;
    }
    case "step": {
      const op = write.op;
      switch (op.kind) {
        case "toggle":
          return { ...task, steps: task.steps.map((s) => (stepIs(s, op.id) ? { ...s, done: !s.done } : s)) };
        case "rename":
          return { ...task, steps: task.steps.map((s) => (stepIs(s, op.id) ? { ...s, text: op.text } : s)) };
        case "remove":
          return { ...task, steps: task.steps.filter((s) => !stepIs(s, op.id)) };
        default:
          return task;
      }
    }
    default:
      return task;
  }
}
