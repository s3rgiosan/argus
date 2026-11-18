// Pure block and review flows plus optimistic status updates for the Tasks
// board. The `api` argument is `{ reply(number, text, send), setStatus(number,
// change) }`; both return promises and reject with a parseError-shaped object.

/**
 * @typedef {import("./model.js").TaskRow} TaskRow
 * @typedef {import("./model.js").TaskDetail} TaskDetail
 * @typedef {import("./model.js").Status} Status
 * @typedef {{kind: string}} StatusChange
 *   The same shapes `statusArgs` in tsk.js accepts.
 * @typedef {{ok: true} | {ok: false, replied: boolean, error: {kind: string, message: string}}} FlowResult
 */

const START_QUIET = { kind: "start", dispatch: false, again: false, force: false };
const START_LAUNCH = { kind: "start", dispatch: true, again: false, force: false };

/** Whether an agent session is running for the task. */
function hasAgent(task) {
  return task.assignee != null && task.dispatch != null;
}

function asError(e) {
  if (typeof e === "object" && e !== null && "kind" in e) return e;
  return { kind: "unexpected", exit: null, message: String(e) };
}

async function replyThen(api, task, text, change) {
  try {
    await api.reply(task.number, text, hasAgent(task));
  } catch (e) {
    return { ok: false, replied: false, error: asError(e) };
  }
  try {
    await api.setStatus(task.number, change);
  } catch (e) {
    return { ok: false, replied: true, error: asError(e) };
  }
  return { ok: true };
}

/** What follows an answered block. */
function afterAnswer(task) {
  if (task.assignee == null) return { kind: "ready" };
  return hasAgent(task) ? START_QUIET : START_LAUNCH;
}

/** What follows a review sent back. */
function afterSendBack(task) {
  return task.assignee != null && !hasAgent(task) ? START_LAUNCH : START_QUIET;
}

/**
 * Replies once, then unblocks. A failed status call never repeats the reply.
 * @returns {Promise<FlowResult>}
 */
export function answerBlock(api, task, text) {
  return replyThen(api, task, text, afterAnswer(task));
}

/**
 * Replies once with the feedback, then restarts the task.
 * @returns {Promise<FlowResult>}
 */
export function sendBack(api, task, feedback) {
  return replyThen(api, task, feedback, afterSendBack(task));
}

/**
 * Repeats only the status call after a flow replied but could not change status.
 * @returns {Promise<FlowResult>}
 */
export async function retryStatus(api, task) {
  const change = task.status === "review" ? afterSendBack(task) : afterAnswer(task);
  try {
    await api.setStatus(task.number, change);
  } catch (e) {
    return { ok: false, replied: true, error: asError(e) };
  }
  return { ok: true };
}

/**
 * What a finished flow changes in the pane. Only a flow for the task the pane
 * still shows (`sameTask`) applies: success clears the error and the reply
 * draft; a failure shows the error, and the draft clears when the reply was
 * sent or `clearDraft` asks for it.
 * @param {FlowResult} result
 * @param {boolean} clearDraft
 * @param {boolean} sameTask
 * @returns {{apply: boolean, flowError: ?{replied: boolean, message: string}, clearDraft: boolean}}
 */
export function flowOutcome(result, clearDraft, sameTask) {
  if (!sameTask) return { apply: false, flowError: null, clearDraft: false };
  if (result.ok) return { apply: true, flowError: null, clearDraft: true };
  return { apply: true, flowError: { replied: result.replied, message: result.error.message }, clearDraft: result.replied || clearDraft };
}

/** The status a status change leaves a task in. */
export function statusOf(change) {
  return change.kind === "start" ? "started" : change.kind;
}

/** Returns a copy of `rows` with the status change applied to one task. Inputs are not mutated. */
export function applyOptimistic(rows, number, change) {
  const status = statusOf(change);
  return rows.map((r) => (r.number === number ? { ...r, status } : r));
}
