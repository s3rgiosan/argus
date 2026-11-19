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

/**
 * The refusal for an empty body, or null when the body is fine for `kind`.
 * @param {ActionKind} kind
 * @param {string} body
 * @returns {string|null}
 */
export function bodyError(kind, body) {
  return NEEDS_BODY.has(kind) && String(body ?? "").trim() === "" ? NO_BODY : null;
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
 * @param {{kind: ActionKind, detail: Detail, body: string, method?: MergeMethod|null}} input
 * A second command in `then` runs only after the first one succeeds.
 * @returns {{name: "gh"|"glab", args: string[], then?: string[]} | {error: string}}
 */
export function actionCommand({ kind, detail, body, method = null }) {
  if (!["approve", "request_changes", "comment", "merge"].includes(kind)) throw new Error(`unknown action: ${kind}`);
  const refusal = bodyError(kind, body);
  if (refusal !== null) return { error: refusal };
  const { pr, headSha } = detail;
  const number = String(pr.number);
  const pinned = kind === "merge" || (kind === "approve" && pr.provider === "gitlab");
  if (pinned && headSha === null) return { error: NO_SHA };

  if (pr.provider === "gitlab") {
    const repo = ["-R", `https://${pr.host}/${pr.repo}`];
    switch (kind) {
      case "approve":
        return { name: "glab", args: ["mr", "approve", number, ...repo, "--sha", String(headSha)] };
      case "request_changes":
        // glab publishes only pending comments, so the body goes in as one first.
        return {
          name: "glab",
          args: ["mr", "note", "draft", "create", number, ...repo, `--message=${body}`],
          then: ["mr", "note", "draft", "publish", number, ...repo, "--reviewer-state=requested_changes", "--yes"],
        };
      case "comment":
        return { name: "glab", args: ["mr", "note", "create", number, ...repo, `--message=${body}`, "--resolvable=false"] };
      default:
        return {
          name: "glab",
          args: ["mr", "merge", number, ...repo, "--yes", "--auto-merge=false", "--sha", String(headSha), ...(detail.squash ? ["--squash"] : [])],
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
      if (method === null) return { error: NO_METHOD };
      return { name: "gh", args: ["pr", "merge", number, "--repo", pr.repo, `--${method}`, "--match-head-commit", String(headSha)] };
  }
}

/**
 * The merge confirm text: the pull request, its base branch and how it merges.
 * @param {Detail} detail
 * @param {MergeMethod|null} method GitHub's method; unused on GitLab.
 * @returns {string}
 */
export function mergePrompt(detail, method) {
  const { pr } = detail;
  let how;
  if (pr.provider === "gitlab") {
    how = detail.squash ? "squash" : "the project's merge method";
  } else {
    switch (method) {
      case "squash":
        how = "squash";
        break;
      case "rebase":
        how = "rebase";
        break;
      default:
        how = "a merge commit";
    }
  }
  return `Merge #${pr.number} into ${pr.baseRef} with ${how}?`;
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
