// Pure builders that turn plain objects into `tsk` argv (the args after `tsk`).
//
// Option values use the `--flag=value` form so values that start with `-` stay
// values. Free text follows `--` after all flags.

/**
 * @typedef {{kind: "desk"} | {kind: "all"} | {kind: "project", project: string}
 *   | {kind: "thread", name: string} | {kind: "assignee", name: string}} Scope
 * @typedef {{shelf: "live"|"done"|"archived",
 *   group: "none"|"project"|"thread"|"assignee",
 *   sort: "recent"|"project"|"thread"|"title"|"assignee"}} ListOptions
 * @typedef {{title: string, notes?: ?string, project?: ?string, thread?: ?string,
 *   assignee?: ?string}} CaptureInput `project` empty captures to the desk.
 * @typedef {{kind: "before", id: string} | {kind: "after", id: string}
 *   | {kind: "first"} | {kind: "last"}} Place
 * @typedef {{kind: "add", text: string, place?: ?Place} | {kind: "toggle", id: string}
 *   | {kind: "rename", id: string, text: string}
 *   | {kind: "move", id: string, place: Place} | {kind: "remove", id: string}} StepOp
 * @typedef {{kind: "open"} | {kind: "ready"}
 *   | {kind: "start", dispatch: boolean, again: boolean, force: boolean}
 *   | {kind: "done", clean: boolean}
 *   | {kind: "blocked", why?: ?string, needs?: ?string, options?: string[], on?: ?string}
 *   | {kind: "review", done?: ?string, checks?: string[], next?: ?string, on?: ?string}} StatusChange
 * @typedef {{title?: ?string, notes?: ?string, assignee?: ?string, unassign?: boolean,
 *   after?: ?number[], on?: ?string}} EditInput `notes: ""` clears the notes,
 *   `unassign` clears the assignee, `after: []` clears the task links.
 */

const task = (number) => `T${number}`;

function pushOpt(args, flag, value) {
  if (value !== undefined && value !== null) args.push(`--${flag}=${value}`);
}

function placeFlag(place) {
  switch (place.kind) {
    case "before":
      return `--before=${place.id}`;
    case "after":
      return `--after=${place.id}`;
    case "first":
      return "--first";
    case "last":
      return "--last";
    default:
      throw new Error(`unknown place kind: ${place.kind}`);
  }
}

/**
 * Args for `tsk list` on a scope and shelf.
 * @param {Scope} scope
 * @param {ListOptions} options
 * @returns {string[]}
 */
export function listArgs(scope, options) {
  const args = ["list"];
  switch (scope.kind) {
    case "desk":
      args.push("--desk");
      break;
    case "all":
      args.push("--all");
      break;
    case "project":
      args.push(`--project=${scope.project}`);
      break;
    case "thread":
      args.push("--all", `--thread=${scope.name}`);
      break;
    case "assignee":
      args.push("--all", `--assignee=${scope.name}`);
      break;
    default:
      throw new Error(`unknown scope kind: ${scope.kind}`);
  }
  if (options.shelf === "done") args.push("--done");
  else if (options.shelf === "archived") args.push("--archived");
  // tsk refuses --group and --sort on the done and archived shelves, and
  // accepts a project group or sort only together with --all.
  if (options.shelf === "live") {
    const spansProjects = scope.kind !== "desk" && scope.kind !== "project";
    if (options.group === "project") {
      if (spansProjects) args.push("--group=project");
    } else if (options.group === "thread" || options.group === "assignee") {
      args.push(`--group=${options.group}`);
    }
    if (options.sort === "project") {
      if (spansProjects) args.push("--sort=project");
    } else if (["thread", "title", "assignee"].includes(options.sort)) {
      args.push(`--sort=${options.sort}`);
    }
  }
  args.push("--json");
  return args;
}

/** @param {number} number @returns {string[]} */
export function taskArgs(number) {
  return ["list", task(number), "--json"];
}

/** @param {CaptureInput} input @returns {string[]} */
export function addArgs(input) {
  const args = ["add", `--title=${input.title}`];
  pushOpt(args, "notes", input.notes);
  if (input.project !== undefined && input.project !== null) {
    args.push(`--project=${input.project}`);
  } else {
    args.push("--desk");
  }
  pushOpt(args, "thread", input.thread);
  pushOpt(args, "assignee", input.assignee);
  args.push("--json");
  return args;
}

/** @param {number} number @param {StatusChange} change @returns {string[]} */
export function statusArgs(number, change) {
  const args = ["status", task(number)];
  switch (change.kind) {
    case "open":
      args.push("open");
      break;
    case "ready":
      args.push("ready");
      break;
    case "start":
      args.push("started");
      if (change.again) args.push("--again");
      else if (!change.dispatch) args.push("--no-dispatch");
      if (change.force) args.push("--force");
      break;
    case "done":
      args.push("done");
      if (change.clean) args.push("--clean");
      break;
    case "blocked":
      args.push("blocked");
      pushOpt(args, "why", change.why);
      pushOpt(args, "needs", change.needs);
      for (const option of change.options ?? []) args.push(`--option=${option}`);
      pushOpt(args, "on", change.on);
      break;
    case "review":
      args.push("review");
      pushOpt(args, "done", change.done);
      for (const check of change.checks ?? []) args.push(`--check=${check}`);
      pushOpt(args, "next", change.next);
      pushOpt(args, "on", change.on);
      break;
    default:
      throw new Error(`unknown status kind: ${change.kind}`);
  }
  return args;
}

/** @param {number} number @param {EditInput} input @returns {string[]} */
export function editArgs(number, input) {
  const args = ["edit", task(number)];
  pushOpt(args, "title", input.title);
  pushOpt(args, "notes", input.notes);
  if (input.unassign) args.push("--unassign");
  else pushOpt(args, "assignee", input.assignee);
  if (Array.isArray(input.after)) {
    if (input.after.length === 0) args.push("--clear-after");
    for (const n of input.after) args.push(`--after=${task(n)}`);
  }
  pushOpt(args, "on", input.on);
  return args;
}

/** @param {number} number @param {StepOp} op @returns {string[]} */
export function stepsArgs(number, op) {
  const args = ["steps", task(number)];
  switch (op.kind) {
    case "add":
      args.push("add");
      if (op.place) args.push(placeFlag(op.place));
      args.push("--", op.text);
      break;
    case "toggle":
      args.push("toggle", op.id);
      break;
    case "rename":
      args.push("rename", op.id, "--", op.text);
      break;
    case "move":
      args.push("move", op.id, placeFlag(op.place));
      break;
    case "remove":
      args.push("remove", op.id);
      break;
    default:
      throw new Error(`unknown step op kind: ${op.kind}`);
  }
  return args;
}

/** @param {number} number @param {string} text @param {boolean} send @returns {string[]} */
export function replyArgs(number, text, send) {
  const args = ["reply", task(number)];
  if (send) args.push("--send");
  args.push("--", text);
  return args;
}

/** @param {number} number @param {boolean} archived @returns {string[]} */
export function archiveArgs(number, archived) {
  return [archived ? "archive" : "unarchive", task(number)];
}

/**
 * Args to title a project, or to clear its title when `title` is null or empty.
 * @param {string} project the project's path
 * @param {?string} title
 * @returns {string[]}
 */
export function projectTitleArgs(project, title) {
  return ["project", "title", project, title ? title : "--clear"];
}

/**
 * Adds `--state-dir <dir>` when `dir` is a non-empty string: before the `--`
 * that starts free text, else at the end. tsk reads everything after `--` as text.
 * @param {string[]} args
 * @param {string} [dir]
 * @returns {string[]}
 */
export function withStateDir(args, dir) {
  if (!dir) return [...args];
  const end = args.indexOf("--");
  const at = end === -1 ? args.length : end;
  return [...args.slice(0, at), "--state-dir", dir, ...args.slice(at)];
}
