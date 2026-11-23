// The agents board without Herdr imports, so Node can test it: what each
// agent needs (waiting, failed, finished, working, idle), the tracker that
// remembers it, snooze holds, and the board's sections and labels.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tracker entries of agents that are gone are dropped this long after the agent was last seen. */
export const KEEP_GONE_MS = 7 * DAY;

/**
 * An entry's `seen` time moves only when it is older than this, so a steady
 * agent causes one tracker write an hour and not one a tick. A gone agent is
 * dropped up to this much later than `KEEP_GONE_MS`.
 */
const SEEN_STEP_MS = HOUR;

/** A finished row older than this moves from Finished to the Older fold. */
export const OLDER_MS = HOUR;

/** The categories the tracker stores. */
const KINDS = new Set(["waiting", "failed", "finished", "working", "idle"]);

/** The hour a "Tomorrow morning" snooze ends (today when it is earlier than this hour). */
const MORNING_HOUR = 9;

/** The snooze choices, in menu order. */
export const SNOOZES = [
  { id: "hour", label: "1 hour" },
  { id: "hours", label: "3 hours" },
  { id: "tomorrow", label: "Tomorrow morning" },
  { id: "change", label: "Until it changes" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Drops what an agent puts before its title, as Herdr's agents list does: a
 * status glyph or spinner and the separator after it, a "[ ! ] " or "[ . ] "
 * mark, and the status marks ✋ and ⏳. A title that starts with a bracket, a
 * quote or another emoji keeps it.
 *
 * @param {unknown} title
 */
export function cleanTitle(title) {
  const text = typeof title === "string" ? title : "";
  return text
    .replace(/^(?:\[ [!.] \] |[✋⏳]\uFE0F?(?=\s)|(?!(?:\p{Emoji}\uFE0F|[#*]\u20E3))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "")
    .trim();
}

/** Time in its largest unit: "<1m", "5m", "2h", "3d". */
export function duration(ms) {
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * The board's rows from Herdr's live data: every agent, then each live
 * terminal whose raw status is "error" and that has no pane, when it belongs
 * to a Herdr space (through its parent agent or its `herdr.space` label).
 *
 * @param {object[]} agents `agents()`
 * @param {object[]} terminals `terminals()`
 * @param {{ id: string, name: string }[]} spaces `spaces()`
 */
export function boardItems(agents, terminals, spaces) {
  const raw = new Map();
  for (const terminal of terminals ?? []) {
    if (typeof terminal?.address === "string") raw.set(terminal.address, terminal);
  }
  const rows = [];
  const listed = new Map();
  for (const a of agents ?? []) {
    const terminal = raw.get(a.address);
    const tab = typeof a.tab_name === "string" ? a.tab_name : "";
    const auto = tab === "" || /^\d+$/.test(tab);
    const detail = auto ? cleanTitle(a.title) || a.program?.name || "" : tab;
    const row = {
      address: a.address,
      pane: a.pane,
      peek: false,
      space: a.space_name ?? "",
      detail,
      program: a.program ?? null,
      pinned: Boolean(a.pinned),
      focused: Boolean(a.focused),
      status: a.status,
      raw: rawWord(terminal),
      turn: turnOf(terminal),
    };
    rows.push(row);
    listed.set(a.address, row);
  }
  const spaceNames = new Map((spaces ?? []).map((s) => [s.id, s.name]));
  for (const terminal of terminals ?? []) {
    if (terminal?.state !== "live" || terminal.status !== "error" || listed.has(terminal.address)) continue;
    const parent = listed.get(terminal.parent);
    const spaceId = terminal.labels?.["herdr.space"];
    const space = parent ? parent.space : spaceNames.get(spaceId);
    if (typeof space !== "string") continue;
    rows.push({
      address: terminal.address,
      pane: null,
      peek: true,
      space,
      detail: terminal.name || terminal.template || terminal.program?.name || terminal.address,
      program: terminal.program ?? null,
      pinned: false,
      focused: false,
      status: "idle",
      raw: "error",
      turn: turnOf(terminal),
    });
  }
  return rows;
}

function rawWord(terminal) {
  return typeof terminal?.status === "string" ? terminal.status : null;
}

function turnOf(terminal) {
  const turn = terminal?.turn;
  return typeof turn === "number" && Number.isFinite(turn) ? turn : null;
}

/**
 * The category of an agent now, from its status, its raw terminal word and
 * the tracker's last entry. Idle after work, or after its turn count went
 * up, is finished. A finish while the agent's pane is the focused pane (the
 * person watched it) is idle: `row.focused` is read at the moment of the
 * change, and a finished entry stays finished after a later focus.
 */
function kindOf(row, prev) {
  if (row.raw === "error") return "failed";
  switch (row.status) {
    case "blocked":
      return "waiting";
    case "working":
      return "working";
    case "done":
      // Herdr says "done" only when you were not looking, also when another app is in front.
      return "finished";
    case "idle": {
      if (prev?.s === "working" || turnWentUp(row, prev)) return row.focused ? "idle" : "finished";
      if (prev?.s === "finished") return "finished";
      return "idle";
    }
    default:
      return "idle";
  }
}

function turnWentUp(row, prev) {
  return Boolean(prev) && row.turn !== null && typeof prev.turn === "number" && row.turn > prev.turn;
}

/**
 * The tracker after one look at `rows`. An entry is `{ s, at, gen, turn, seen? }`:
 * `s` the category, `at` when it last changed, `gen` a count of changes,
 * `turn` the terminal's turn count and `seen` when the agent was last seen
 * (kept to the hour; `at` when absent). An entry of a missing agent is
 * dropped `KEEP_GONE_MS` after it was last seen. A raised turn outside working counts as
 * a change too, because a whole working phase came and went.
 *
 * @param {Record<string, object>} track
 * @param {{ address: string, status: string, raw: string | null, turn: number | null, focused?: boolean }[]} rows
 * @param {number} now
 * @returns {{ track: Record<string, object>, changed: boolean }}
 */
export function advance(track, rows, now) {
  let changed = false;
  const next = { ...track };
  const seen = new Set();
  for (const row of rows) {
    seen.add(row.address);
    const prev = track[row.address];
    const s = kindOf(row, prev);
    if (!prev) {
      next[row.address] = { s, at: now, gen: 0, turn: row.turn };
      changed = true;
    } else if (prev.s !== s || (s !== "working" && turnWentUp(row, prev))) {
      next[row.address] = { s, at: now, gen: prev.gen + 1, turn: row.turn };
      changed = true;
    } else {
      const turnMoved = row.turn !== null && row.turn !== prev.turn;
      if (turnMoved || now - (prev.seen ?? prev.at) >= SEEN_STEP_MS) {
        next[row.address] = { ...prev, turn: turnMoved ? row.turn : prev.turn, seen: now };
        changed = true;
      }
    }
  }
  for (const [address, entry] of Object.entries(track)) {
    if (seen.has(address) || now - (entry.seen ?? entry.at) <= KEEP_GONE_MS) continue;
    delete next[address];
    changed = true;
  }
  return changed ? { track: next, changed } : { track, changed };
}

const own = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isInteger(value) && value >= 0;

/** The tracker from shared state, with bad entries left out. */
export function normalizeTrack(value) {
  const track = {};
  if (!own(value)) return track;
  for (const [address, entry] of Object.entries(value)) {
    if (!own(entry) || !KINDS.has(entry.s) || typeof entry.at !== "number" || !count(entry.gen)) continue;
    track[address] = { s: entry.s, at: entry.at, gen: entry.gen, turn: typeof entry.turn === "number" ? entry.turn : null };
    if (typeof entry.seen === "number") track[address].seen = entry.seen;
  }
  return track;
}

/** The holds from shared state, with bad entries left out. */
export function normalizeHolds(value) {
  const holds = {};
  if (!own(value)) return holds;
  for (const [address, hold] of Object.entries(value)) {
    if (!own(hold) || !count(hold.gen)) continue;
    if (hold.until !== null && typeof hold.until !== "number") continue;
    holds[address] = { until: hold.until, gen: hold.gen };
  }
  return holds;
}

/**
 * When a snooze ends: a time in ms, null for "until the agent changes", or
 * undefined for an unknown choice.
 *
 * @param {string} id One of `SNOOZES`.
 * @param {number} now
 */
export function snoozeUntil(id, now) {
  switch (id) {
    case "hour":
      return now + HOUR;
    case "hours":
      return now + 3 * HOUR;
    case "tomorrow": {
      const date = new Date(now);
      if (date.getHours() >= MORNING_HOUR) date.setDate(date.getDate() + 1);
      date.setHours(MORNING_HOUR, 0, 0, 0);
      return date.getTime();
    }
    case "change":
      return null;
    default:
      return undefined;
  }
}

/** True while `hold` covers the agent: same change count and its time not past. */
export function holdActive(hold, entry, now) {
  if (!hold || !entry || hold.gen !== entry.gen) return false;
  return hold.until === null || hold.until > now;
}

/**
 * The holds with a new snooze for `address`, or null when the agent has no
 * tracker entry or the choice is unknown.
 */
export function snoozeHold(holds, track, address, id, now) {
  const entry = track[address];
  const until = snoozeUntil(id, now);
  if (!entry || until === undefined) return null;
  return { ...holds, [address]: { until, gen: entry.gen } };
}

/** The holds without `address`, or null when it has none. */
export function reopenHold(holds, address) {
  if (!Object.prototype.hasOwnProperty.call(holds, address)) return null;
  const next = { ...holds };
  delete next[address];
  return next;
}

/** The holds without the ones that ended (time past, agent changed or gone). */
export function pruneHolds(holds, track, now) {
  const next = {};
  let changed = false;
  for (const [address, hold] of Object.entries(holds)) {
    if (holdActive(hold, track[address], now)) next[address] = hold;
    else changed = true;
  }
  return changed ? { holds: next, changed } : { holds, changed };
}

/**
 * The board's sections. Each row gets `kind`, `since` (when its state
 * started) and, when snoozed, `until`. Sections list pinned rows first, then
 * the newest change first. `finished` holds the finished rows that are not
 * older than `OLDER_MS`; `older` holds the rest. A snoozed row goes to
 * `snoozed`, whatever its age. Working and idle rows take no snooze.
 */
export function buildSections(rows, track, holds, now) {
  const sections = { waiting: [], failed: [], finished: [], working: [], idle: [], older: [], snoozed: [] };
  for (const row of rows) {
    const entry = track[row.address];
    if (!entry) continue;
    const shown = { ...row, kind: entry.s, since: entry.at };
    if (entry.s === "working" || entry.s === "idle") {
      sections[entry.s].push(shown);
      continue;
    }
    const hold = holds[row.address];
    if (holdActive(hold, entry, now)) sections.snoozed.push({ ...shown, until: hold.until });
    else if (entry.s === "finished" && now - entry.at > OLDER_MS) sections.older.push(shown);
    else sections[entry.s].push(shown);
  }
  const order = (x, y) => Number(y.pinned) - Number(x.pinned) || y.since - x.since;
  for (const list of Object.values(sections)) list.sort(order);
  return sections;
}

const pad = (n) => String(n).padStart(2, "0");

/** The wake time: "18:00" today, "Mon 09:00" on another day, or null for no time. */
export function wakeLabel(until, now) {
  if (until === null) return null;
  const date = new Date(until);
  const today = new Date(now);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? clock : `${WEEKDAYS[date.getDay()]} ${clock}`;
}

/** "Until 18:00", "Until Mon 09:00", or "Until it changes". */
export function untilLabel(until, now) {
  const wake = wakeLabel(until, now);
  return wake === null ? "Until it changes" : `Until ${wake}`;
}
