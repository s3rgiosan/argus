// Reads Claude Code's `get_usage` reply and works out each window's pace.
// No Herdr imports, so Node can test it.

import { formatDuration, formatMoney, planName } from "./format.js";
import { compareNames } from "./follow.js";

export const SESSION_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 24 * 3_600_000;

const KIND_ORDER = { session: 0, weekly: 1, scoped: 2 };

/**
 * @typedef {{ kind: "session" | "weekly" | "scoped", label: string, used: number, resetsAt: number | null, lengthMs: number }} Window
 * @typedef {{
 *   state: "ok" | "signed-out" | "no-limits" | "error",
 *   reason: string | null,
 *   plan: string | null,
 *   windows: Window[],
 *   surfaces: { label: string, percent: number }[],
 *   extra: { enabled: boolean, used: string | null, limit: string | null } | null,
 * }} Reply
 */

/**
 * Parses the helper's output: the first line that holds a `control_response`.
 *
 * @param {string} text Raw stdout of usage.sh.
 * @returns {Reply}
 */
export function parseReply(text) {
  const raw = String(text ?? "")
    .split("\n")
    .find((line) => line.includes('"control_response"'));
  if (!raw) return failed("No usage reply");

  // The reply starts at `{"type"`; noise before it on the same line may hold
  // braces too. The first brace is the fallback.
  const message = [raw.indexOf('{"type"'), raw.indexOf("{")]
    .filter((at) => at >= 0)
    .map((at) => tryJson(raw.slice(at)))
    .find((value) => value !== undefined);
  if (message === undefined) return failed("Unreadable usage reply");

  const response = message?.response;
  if (response?.subtype === "error") {
    const detail = typeof response.error === "string" && response.error.trim() ? response.error.trim().slice(0, 120) : "error";
    return failed(`Claude Code: ${detail}`);
  }
  const usage = response?.response;
  if (response?.subtype !== "success" || !isObject(usage)) return failed("Unreadable usage reply");

  const plan = planName(usage.subscription_type);
  if (usage.rate_limits_available === false) return { ...empty("no-limits"), plan };
  if (!isObject(usage.rate_limits)) return { ...empty("signed-out"), plan };

  const limits = usage.rate_limits;
  return {
    state: "ok",
    reason: null,
    plan,
    windows: windowsOf(limits),
    surfaces: surfacesOf(limits.seven_day_breakdown),
    extra: extraOf(limits.spend),
  };
}

/**
 * Compares what is left of a window with how much of its time is left.
 *
 * @param {Window} window
 * @param {number} now Epoch milliseconds.
 * @returns {{ left: number, timeLeft: number, margin: number, standing: "reserve" | "deficit" | "even", outlook: "lasts" | "runs-out" | "ran-out", runsOutInMs: number | null } | null}
 *   Null when the reset time is unknown or already passed.
 */
export function pace(window, now) {
  if (window.resetsAt === null || !(window.resetsAt > now)) return null;

  const left = 100 - window.used;
  const remaining = window.resetsAt - now;
  const timeLeft = (remaining / window.lengthMs) * 100;
  const margin = Math.round(left - timeLeft);
  const standing = margin > 0 ? "reserve" : margin < 0 ? "deficit" : "even";
  const base = { left, timeLeft, margin, standing, runsOutInMs: null };

  if (left <= 0) return { ...base, outlook: "ran-out" };

  const elapsed = window.lengthMs - remaining;
  if (window.used === 0 || elapsed <= 0) return { ...base, outlook: "lasts" };

  const runOut = left / (window.used / elapsed);
  if (runOut < remaining) return { ...base, outlook: "runs-out", runsOutInMs: runOut };
  return { ...base, outlook: "lasts" };
}

/**
 * The pace line under a bar, such as "26% in reserve · Lasts until reset".
 *
 * @param {ReturnType<typeof pace>} p
 * @returns {string} Empty when there is no pace.
 */
export function paceText(p) {
  if (!p) return "";
  if (p.outlook === "ran-out") return "Ran out";

  let standing = "On pace";
  if (p.standing === "reserve") standing = `${p.margin}% in reserve`;
  if (p.standing === "deficit") standing = `${Math.abs(p.margin)}% in deficit`;

  const outlook = p.outlook === "runs-out" ? `Runs out in ${formatDuration(p.runsOutInMs)}` : "Lasts until reset";
  return `${standing} · ${outlook}`;
}

function windowsOf(limits) {
  const list = Array.isArray(limits.limits) ? limits.limits : [];
  let windows = list.map(limitWindow).filter(Boolean);

  if (windows.length === 0) {
    windows = [
      fixedWindow("session", "Session", limits.five_hour, SESSION_MS),
      fixedWindow("weekly", "Weekly", limits.seven_day, WEEK_MS),
    ].filter(Boolean);
  }

  return windows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.kind === "scoped" ? compareNames(a.label, b.label) : 0));
}

function limitWindow(limit) {
  if (!isObject(limit) || !Number.isFinite(limit.percent)) return null;

  switch (limit.kind) {
    case "session":
      return makeWindow("session", "Session", limit.percent, limit.resets_at, SESSION_MS);
    case "weekly_all":
      return makeWindow("weekly", "Weekly", limit.percent, limit.resets_at, WEEK_MS);
    case "weekly_scoped": {
      const name = limit.scope?.model?.display_name;
      if (typeof name !== "string" || !name.trim()) return null;
      return makeWindow("scoped", name.trim(), limit.percent, limit.resets_at, WEEK_MS);
    }
    default:
      return null;
  }
}

function fixedWindow(kind, label, window, lengthMs) {
  if (!isObject(window) || !Number.isFinite(window.utilization)) return null;
  return makeWindow(kind, label, window.utilization, window.resets_at, lengthMs);
}

function makeWindow(kind, label, percent, resetsAt, lengthMs) {
  const time = typeof resetsAt === "string" ? Date.parse(resetsAt) : NaN;
  return {
    kind,
    label,
    used: Math.min(Math.max(percent, 0), 100),
    resetsAt: Number.isFinite(time) ? time : null,
    lengthMs,
  };
}

function surfacesOf(breakdown) {
  const rows = Array.isArray(breakdown?.rows) ? breakdown.rows : [];
  return rows
    .filter((row) => typeof row?.display_name === "string" && row.display_name.trim() && row.percent > 0)
    .map((row) => ({ label: row.display_name.trim(), percent: Math.min(row.percent, 100) }));
}

function extraOf(spend) {
  if (!isObject(spend)) return null;
  return {
    enabled: spend.enabled === true,
    used: formatMoney(spend.used),
    limit: formatMoney(spend.limit),
  };
}

/**
 * The entry to store for one folder after a fetch. A good reply replaces the
 * entry. An error reply keeps a good previous reply that is not older than
 * `maxAge`, and records the error beside it as `lastError`.
 *
 * @param {{ reply?: { state: string }, updatedAt?: number } | undefined} previous
 * @param {{ state: string, reason?: string | null }} reply
 * @param {number} now
 * @param {number} maxAge
 */
export function mergeEntry(previous, reply, now, maxAge) {
  const kept = previous?.reply?.state === "ok" && Number.isFinite(previous.updatedAt) && now - previous.updatedAt <= maxAge;
  if (reply.state !== "error" || !kept) return { reply, updatedAt: now };
  return { reply: previous.reply, updatedAt: previous.updatedAt, lastError: { message: reply.reason ?? "unknown error", at: now } };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function failed(reason) {
  return { ...empty("error"), reason };
}

function empty(state) {
  return { state, reason: null, plan: null, windows: [], surfaces: [], extra: null };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
