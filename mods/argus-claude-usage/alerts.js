// The toasts for accounts near a limit. No Herdr imports, so Node can test
// them.

import { formatDuration } from "./format.js";
import { accountTitle } from "./title.js";

const ALERT_KINDS = ["session", "weekly"];

/**
 * The toasts to post for session and weekly windows at or past the
 * threshold. Each window alerts once until it resets.
 *
 * @param {{ folder: string, label: string }[]} profiles
 * @param {Record<string, { reply?: { state: string, windows: { kind: string, label: string, used: number, resetsAt: number | null }[] } }>} byFolder
 * @param {Record<string, number>} sent Alert keys already posted, mapped to the window's reset time.
 * @param {{ threshold: number, names: Record<string, string>, home: string, now: number }} options
 * @returns {{ alerts: { title: string, body: string }[], sent: Record<string, number> }}
 */
export function dueAlerts(profiles, byFolder, sent, { threshold, names, home, now }) {
  const next = Object.fromEntries(Object.entries(sent ?? {}).filter(([, resetsAt]) => resetsAt > now));
  const alerts = [];

  for (const profile of profiles) {
    const reply = byFolder?.[profile.folder]?.reply;
    if (reply?.state !== "ok") continue;

    for (const window of reply.windows) {
      if (!ALERT_KINDS.includes(window.kind) || window.used < threshold) continue;
      if (window.resetsAt === null || window.resetsAt <= now) continue;

      // Claude reports the same reset with a different fraction of a second
      // on each fetch, so the window is keyed by its minute.
      const key = `${profile.folder}|${window.kind}|${Math.round(window.resetsAt / 60_000)}`;
      if (key in next) continue;
      next[key] = window.resetsAt;

      const name = accountTitle(profile, names, home);
      alerts.push({
        title: `Claude ${name}: ${window.label.toLowerCase()} at ${Math.round(window.used)}%`,
        body: `Resets in ${formatDuration(window.resetsAt - now)}`,
      });
    }
  }

  return { alerts, sent: next };
}
