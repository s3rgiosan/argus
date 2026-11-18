// Pure parsers for `tsk` output. JSON keys are snake_case in `tsk`; the objects
// built here use camelCase. Bad input yields `[]` / `null`, never a throw.

/**
 * @typedef {[number, number]} Timestamp `[seconds, nanos]` since the Unix epoch.
 * @typedef {"open"|"ready"|"started"|"blocked"|"review"|"done"|"unknown"} Status
 * @typedef {"open"|"passed"|"failed"|"unknown"} CheckState
 * @typedef {{task: number, done: boolean}} AfterLink
 * @typedef {{at: Timestamp, by: string, text: string, edited: boolean, sent: boolean}} Reply
 * @typedef {{why: ?string, needs: ?string, options: string[], on: string, by: string,
 *   at: Timestamp, edited: boolean, replies: Reply[], answered: boolean,
 *   closedAt: ?Timestamp, closedBy: ?string}} Block
 * @typedef {{text: string, state: CheckState}} Check
 * @typedef {{round: number, done: ?string, checks: Check[], next: ?string, on: string,
 *   by: string, at: Timestamp, edited: boolean, feedback: Reply[], answered: boolean,
 *   closedAt: ?Timestamp, closedBy: ?string, resolution: ?string}} Review
 * @typedef {{id: string, number: number, title: string, status: Status,
 *   project: ?string, projectTitle: ?string, thread: ?string, assignee: ?string,
 *   assigneeKind: ?string, base: ?string, after: AfterLink[], before: number[],
 *   archived: ?string, group: ?string, block?: Block, review?: Review}} TaskRow
 *   `projectTitle` is the project's title, null when it has none. `block` and
 *   `review` are present only on blocked and review tasks.
 * @typedef {{id: string, shortId: string, done: boolean, text: string}} Step
 * @typedef {{at: Timestamp, by: ?string, kind: string, detail: *}} Activity
 * @typedef {TaskRow & {notes: ?string, steps: Step[], dispatch: *,
 *   pastBlocks: Block[], pastReviews: Review[], activity: Activity[]}} TaskDetail
 * @typedef {{kind: "refused", code: string, message: string}
 *   | {kind: "usage"|"store", message: string}
 *   | {kind: "unexpected", exit: ?number, message: string}} TskError
 */

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : null);
const bool = (v) => v === true;
const list = (v) => (Array.isArray(v) ? v : []);
const timestamp = (v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") ? v : null;

/** @returns {Status} */
function status(v) {
  switch (v) {
    case "open":
    case "ready":
    case "started":
    case "blocked":
    case "review":
    case "done":
      return v;
    default:
      return "unknown";
  }
}

/** @returns {CheckState} */
function checkState(v) {
  switch (v) {
    case "open":
    case "passed":
    case "failed":
      return v;
    default:
      return "unknown";
  }
}

function reply(r) {
  if (!isObject(r)) return null;
  return {
    at: timestamp(r.at) ?? [0, 0],
    by: str(r.by) ?? "",
    text: str(r.text) ?? "",
    edited: bool(r.edited),
    sent: bool(r.sent),
  };
}

const replies = (v) => list(v).map(reply).filter(Boolean);

function block(b) {
  if (!isObject(b) || str(b.on) === null) return null;
  return {
    why: str(b.why),
    needs: str(b.needs),
    options: list(b.options).filter((o) => typeof o === "string"),
    on: b.on,
    by: str(b.by) ?? "",
    at: timestamp(b.at) ?? [0, 0],
    edited: bool(b.edited),
    replies: replies(b.replies),
    answered: bool(b.answered),
    closedAt: timestamp(b.closed_at),
    closedBy: str(b.closed_by),
  };
}

function review(r) {
  if (!isObject(r) || str(r.on) === null) return null;
  return {
    round: typeof r.round === "number" ? r.round : 0,
    done: str(r.done),
    checks: list(r.checks)
      .filter(isObject)
      .map((c) => ({ text: str(c.text) ?? "", state: checkState(c.state) })),
    next: str(r.next),
    on: r.on,
    by: str(r.by) ?? "",
    at: timestamp(r.at) ?? [0, 0],
    edited: bool(r.edited),
    feedback: replies(r.feedback),
    answered: bool(r.answered),
    closedAt: timestamp(r.closed_at),
    closedBy: str(r.closed_by),
    resolution: str(r.resolution),
  };
}

function row(r) {
  if (!isObject(r)) return null;
  if (typeof r.id !== "string" || typeof r.number !== "number" || typeof r.title !== "string") {
    return null;
  }
  if (typeof r.status !== "string") return null;
  const out = {
    id: r.id,
    number: r.number,
    title: r.title,
    status: status(r.status),
    project: str(r.project),
    projectTitle: str(r.project_title) || null,
    thread: str(r.thread),
    assignee: str(r.assignee),
    assigneeKind: str(r.assignee_kind),
    base: str(r.base),
    after: list(r.after)
      .filter(isObject)
      .map((a) => ({ task: a.task, done: bool(a.done) }))
      .filter((a) => typeof a.task === "number"),
    before: list(r.before).filter((n) => typeof n === "number"),
    archived: str(r.archived),
    group: str(r.group),
  };
  const b = block(r.block);
  if (b) out.block = b;
  const rv = review(r.review);
  if (rv) out.review = rv;
  return out;
}

function detail(d) {
  const base = row(d);
  if (!base) return null;
  if (!Array.isArray(d.steps) || !Array.isArray(d.activity)) return null;
  return {
    ...base,
    notes: str(d.notes),
    steps: d.steps.filter(isObject).map((s) => ({
      id: str(s.id) ?? "",
      shortId: str(s.short_id) ?? "",
      done: bool(s.done),
      text: str(s.text) ?? "",
    })),
    dispatch: d.dispatch ?? null,
    pastBlocks: list(d.past_blocks).map(block).filter(Boolean),
    pastReviews: list(d.past_reviews).map(review).filter(Boolean),
    activity: d.activity.filter(isObject).map((a) => ({
      at: timestamp(a.at) ?? [0, 0],
      by: str(a.by),
      kind: str(a.kind) ?? "",
      detail: a.detail ?? null,
    })),
  };
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse the output of `tsk list --json`.
 * @param {string} text
 * @returns {TaskRow[]} Empty when the text is not a JSON array; invalid rows are skipped.
 */
export function parseRows(text) {
  const data = json(text);
  if (!Array.isArray(data)) return [];
  return data.map(row).filter(Boolean);
}

/**
 * Parse the output of `tsk list <number> --json` (an array holding one task, or a bare object).
 * @param {string} text
 * @returns {TaskDetail | null}
 */
export function parseTask(text) {
  const data = json(text);
  const first = Array.isArray(data) ? data[0] : data;
  return detail(first);
}

/**
 * Classify a failed `tsk` run. Exit 1 is a refusal whose first stderr line reads
 * `tsk <command>: <code>: <message>`; 2 is a usage error; 3 is a store error.
 * @param {string} stderr
 * @param {?number} code exit code, null when the process had none
 * @returns {TskError}
 */
export function parseError(stderr, code) {
  const text = String(stderr ?? "").trim();
  switch (code) {
    case 1: {
      const first = String(stderr ?? "").split("\n")[0];
      if (first.startsWith("tsk ")) {
        const parts = first.slice(4).split(": ");
        const [cmd, errCode] = parts;
        if (parts.length >= 3 && cmd && errCode && !/\s/.test(errCode)) {
          return { kind: "refused", code: errCode, message: parts.slice(2).join(": ").trim() };
        }
      }
      return { kind: "refused", code: "unknown", message: text };
    }
    case 2:
      return { kind: "usage", message: text };
    case 3:
      return { kind: "store", message: text };
    default:
      return { kind: "unexpected", exit: code ?? null, message: text };
  }
}
