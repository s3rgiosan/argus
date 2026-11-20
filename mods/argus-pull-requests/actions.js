// Builds the `gh` and `glab` commands for the review and merge actions of the pull request pane.

/** @typedef {import("./model.js").Pr} Pr */
/** @typedef {import("./model.js").Detail} Detail */
/** @typedef {"approve" | "request_changes" | "comment" | "merge"} ActionKind */
/** @typedef {"merge" | "squash" | "rebase"} MergeMethod */

/** The actions that need a body. */
export const NEEDS_BODY = new Set(["request_changes", "comment"]);

export const NO_METHOD = "This repo allows no merge method for you.";
export const NO_SHA = "Read this pull request again, then retry.";
export const NO_BODY = "Write a comment first.";
export const DRAFT_KEPT = "Your comment is kept as a pending review comment on the merge request.";
export const DRAFT_TEXT =
  "Your earlier comment is still a pending review comment on the merge request. Submit the same text to publish it, or delete it on GitLab first.";
export const DRAFTS_UNREAD = "Could not read your pending review comments on the merge request.";

/** How long the pane keeps the signed-in GitHub login, or a failed read of it. */
export const LOGIN_TTL = 5 * 60 * 1000;

/** How long a running action blocks the same pull request in every copy: three CLI runs of 30 s, and some margin. */
export const RUN_LIMIT = 120 * 1000;

/** Every action the pane offers. */
const KINDS = ["approve", "request_changes", "comment", "merge"];

/** GitHub's merge methods in fallback order, with the repo setting that allows each. */
const GH_METHODS = [
  ["merge", "mergeCommitAllowed"],
  ["squash", "squashMergeAllowed"],
  ["rebase", "rebaseMergeAllowed"],
];

/**
 * Whether the pane offers actions for `pr`: only open pull requests, drafts included.
 * @param {Pr} pr
 * @returns {boolean}
 */
export function canAct(pr) {
  return pr.state === "open";
}

/** Shown when Approve and Request changes are off on your own GitHub pull request. */
export const OWN_PR = "GitHub does not let you approve or request changes on your own pull request.";

/**
 * Whether `login` opened `pr` on GitHub, where the author cannot approve or request changes.
 * @param {Pr} pr
 * @param {string|null} login The signed-in GitHub login, or null when unknown.
 * @returns {boolean}
 */
export function ownPr(pr, login) {
  if (pr.provider !== "github" || !login) return false;
  const author = pr.author.toLowerCase();
  return author === login.toLowerCase();
}

/**
 * The refusal for an empty body, or null when the body is fine for `kind`.
 * @param {ActionKind} kind
 * @param {string} body
 * @returns {string|null}
 */
export function bodyError(kind, body) {
  const text = String(body ?? "").trim();
  return NEEDS_BODY.has(kind) && text === "" ? NO_BODY : null;
}

/**
 * @param {string} repo
 * @returns {string[]}
 */
export function ghMethodArgs(repo) {
  return ["repo", "view", repo, "--json", "viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"];
}

/**
 * The merge method for a repo: the person's default when the repo allows it,
 * else the first allowed of merge, squash and rebase; null when none is allowed
 * or the reply does not parse.
 * @param {string} text `gh repo view` output for `ghMethodArgs`.
 * @returns {MergeMethod|null}
 */
export function pickMergeMethod(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const allowed = GH_METHODS.filter(([, setting]) => raw[setting] === true).map(([method]) => method);
  const preferred = typeof raw.viewerDefaultMergeMethod === "string" ? raw.viewerDefaultMergeMethod.toLowerCase() : "";
  if (allowed.includes(preferred)) return /** @type {MergeMethod} */ (preferred);
  return /** @type {MergeMethod|undefined} */ (allowed[0]) ?? null;
}

/**
 * The command for one action, or the reason it cannot run. Bodies go in as one
 * `--body=` or `--message=` argument, so text that starts with `-` stays a value.
 * Approve on GitLab and Merge on both forges pin the head commit the pane read.
 * A second command in `then` runs only after the first one succeeds. `publishOnly`
 * says a GitLab Request changes already has its comment as a pending draft
 * (`draftPlan`), so only the publish runs.
 * @param {{kind: ActionKind, detail: Detail, body: string, method?: MergeMethod|null, publishOnly?: boolean}} input
 * @returns {{name: "gh"|"glab", args: string[], then?: string[]} | {error: string}}
 */
export function actionCommand({ kind, detail, body, method = null, publishOnly = false }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown action: ${kind}`);
  const { pr, headSha } = detail;
  const gitLab = pr.provider === "gitlab";
  const onlyPublish = publishOnly && gitLab && kind === "request_changes";
  const refusal = bodyError(kind, body);
  if (refusal !== null) return { error: refusal };
  const number = String(pr.number);
  const pinned = kind === "merge" || (kind === "approve" && gitLab);
  if (pinned && (typeof headSha !== "string" || headSha === "")) return { error: NO_SHA };

  if (gitLab) {
    const repo = ["-R", `https://${pr.host}/${pr.repo}`];
    const publish = ["mr", "note", "draft", "publish", number, ...repo, "--reviewer-state=requested_changes", "--yes"];
    if (onlyPublish) return { name: "glab", args: publish };
    // GitLab merges by the project's method, with or without squash only.
    if (kind === "merge" && method === "rebase") return { error: NO_METHOD };
    switch (kind) {
      case "approve":
        return { name: "glab", args: ["mr", "approve", number, ...repo, "--sha", String(headSha)] };
      case "request_changes":
        // glab publishes only pending comments, so the body goes in as one first.
        return {
          name: "glab",
          args: ["mr", "note", "draft", "create", number, ...repo, `--message=${body}`],
          then: publish,
        };
      case "comment":
        return { name: "glab", args: ["mr", "note", "create", number, ...repo, `--message=${body}`, "--resolvable=false"] };
      default:
        return {
          name: "glab",
          args: ["mr", "merge", number, ...repo, "--yes", "--auto-merge=false", "--sha", String(headSha), ...glSquashArgs(method, detail.squash)],
        };
    }
  }

  const review = ["pr", "review", number, "--repo", pr.repo];
  switch (kind) {
    case "approve":
      return { name: "gh", args: [...review, "--approve"] };
    case "request_changes":
      return { name: "gh", args: [...review, "--request-changes", `--body=${body}`] };
    case "comment":
      return { name: "gh", args: [...review, "--comment", `--body=${body}`] };
    default:
      if (!GH_METHODS.some(([known]) => known === method)) return { error: NO_METHOD };
      return { name: "gh", args: ["pr", "merge", number, "--repo", pr.repo, `--${method}`, "--match-head-commit", String(headSha)] };
  }
}

/**
 * The squash flag of a GitLab merge: the picked method's, else the merge request's own setting.
 * @param {MergeMethod|null} method
 * @param {boolean} squash
 * @returns {string[]}
 */
function glSquashArgs(method, squash) {
  if (method === "squash") return ["--squash"];
  if (method === "merge") return ["--squash=false"];
  return squash ? ["--squash"] : [];
}

/**
 * The merge confirm text: the pull request, its base branch and how it merges.
 * GitLab merges send no method flag, so the text names a method only when the merge request squashes.
 * @param {Detail} detail
 * @param {MergeMethod|null} method GitHub's method; unused on GitLab.
 * @returns {string}
 */
export function mergePrompt(detail, method) {
  const { pr } = detail;
  let how = null;
  if (pr.provider === "gitlab") {
    how = detail.squash ? "squash" : null;
  } else {
    switch (method) {
      case "merge":
        how = "a merge commit";
        break;
      case "squash":
        how = "squash";
        break;
      case "rebase":
        how = "rebase";
        break;
      default:
        how = null;
    }
  }
  const target = `Merge #${pr.number} into ${pr.baseRef}`;
  return how === null ? `${target}?` : `${target} with ${how}?`;
}

/**
 * What the pane does after an action ends. It always reads the pull request again,
 * so a refused pin shows the new head. The comment box clears only after its own action succeeds.
 * @param {ActionKind} kind
 * @param {boolean} ok
 * @returns {{reread: boolean, clearComment: boolean}}
 */
export function afterAction(kind, ok) {
  return { reread: true, clearComment: ok && NEEDS_BODY.has(kind) };
}

/**
 * The error text for a failed action; `drafted` adds that the comment this run drafted stays pending.
 * @param {string} error
 * @param {boolean} drafted
 * @returns {string}
 */
export function actionFailure(error, drafted) {
  return drafted ? `${error} ${DRAFT_KEPT}` : error;
}

/**
 * The action state a pull request keeps when the pane moves to another one, or null when
 * nothing is worth keeping. The typed text, a kept draft and a running action stay; the
 * merge confirm, an open menu with the merge methods it read, and an error already shown go.
 * @param {{running: ActionKind|null, error: string|null, confirm: object|null, text: string, draftText: string|null, menu: string|null, methods: object|null}} state
 * @param {string} text The comment box text at the time of the move.
 */
export function leavePr(state, text) {
  const running = state.running !== null;
  const next = { ...state, confirm: null, error: running ? state.error : null, text, menu: null, methods: null };
  const empty = !running && text === "" && next.draftText === null;
  return empty ? null : next;
}

/**
 * The `glab` arguments that list the user's own pending review comments on a merge request.
 * @param {Detail} detail
 * @returns {string[]}
 */
export function draftListArgs(detail) {
  const { pr } = detail;
  return ["mr", "note", "draft", "list", String(pr.number), "-R", `https://${pr.host}/${pr.repo}`, "-F", "json"];
}

/**
 * The refusal when the user has other pending review comments, which a publish would send too.
 * @param {number} count
 * @returns {string}
 */
export function pendingDrafts(count) {
  const comments = count === 1 ? "comment" : "comments";
  return `You have ${count} pending review ${comments} on this merge request. A publish sends all of them. Publish or delete them on GitLab first.`;
}

/**
 * How a GitLab Request changes runs, from the user's pending review comments.
 * With none, the comment is drafted and published. With one, and the pane kept a
 * draft of the same text, only the publish runs. Anything else refuses, so a
 * publish never sends a comment twice or a comment the user did not write here.
 * @param {string} listText `glab mr note draft list -F json` output.
 * @param {string|null} kept The text of the draft this pane left pending, or null.
 * @param {string} body The text in the comment box.
 * @returns {{publishOnly: boolean} | {error: string}}
 */
export function draftPlan(listText, kept, body) {
  let drafts;
  try {
    drafts = JSON.parse(listText);
  } catch {
    return { error: DRAFTS_UNREAD };
  }
  if (!Array.isArray(drafts)) return { error: DRAFTS_UNREAD };
  if (drafts.length === 0) return { publishOnly: false };
  if (kept === null || drafts.length > 1) return { error: pendingDrafts(drafts.length) };
  const same = String(body).trim() === kept.trim();
  return same ? { publishOnly: true } : { error: DRAFT_TEXT };
}

/**
 * The detail a confirmed merge runs with: the head commit the confirm was shown for,
 * so commits pushed after the confirm opened make the merge fail.
 * @param {Detail} detail
 * @param {{headSha: string|null}} confirm
 * @returns {Detail}
 */
export function confirmedDetail(detail, confirm) {
  return { ...detail, headSha: confirm.headSha };
}

/**
 * Whether the comment box clears after an action: only after its own action
 * succeeded, and only while it still holds the text that was sent.
 * @param {{clearComment: boolean}} after
 * @param {string} sent
 * @param {string} current
 * @returns {boolean}
 */
export function clearsComment(after, sent, current) {
  return after.clearComment && current === sent;
}

/**
 * Whether a kept login read is still good: same gh setting and younger than LOGIN_TTL.
 * A failed read (value null) is kept too, so the pane does not ask on every read.
 * @param {{setting: string, value: string|null, at: number}|null} cache
 * @param {string} setting
 * @param {number} now
 * @returns {boolean}
 */
export function loginFresh(cache, setting, now) {
  return cache !== null && cache.setting === setting && now - cache.at < LOGIN_TTL;
}

/**
 * The action running on a pull request in any copy of the mod, or null. An entry
 * older than RUN_LIMIT is from a copy that stopped and counts as done.
 * @param {unknown} map The shared map of PR key to {kind, at}.
 * @param {string} key
 * @param {number} now
 * @returns {ActionKind|null}
 */
export function runningOf(map, key, now) {
  const entry = map && typeof map === "object" ? map[key] : null;
  if (!entry || typeof entry !== "object" || typeof entry.kind !== "string" || typeof entry.at !== "number") return null;
  return now - entry.at < RUN_LIMIT ? entry.kind : null;
}

/**
 * A copy of the shared running map with `key` running `kind` from `now`.
 * @param {unknown} map
 * @param {string} key
 * @param {ActionKind} kind
 * @param {number} now
 * @returns {Record<string, {kind: ActionKind, at: number}>}
 */
export function withRunning(map, key, kind, now) {
  const base = map && typeof map === "object" ? map : {};
  return { ...base, [key]: { kind, at: now } };
}

/**
 * A copy of the shared running map without `key`.
 * @param {unknown} map
 * @param {string} key
 * @returns {Record<string, {kind: ActionKind, at: number}>}
 */
export function withoutRunning(map, key) {
  const { [key]: _done, ...rest } = map && typeof map === "object" ? map : {};
  return rest;
}
