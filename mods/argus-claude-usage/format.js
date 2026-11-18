// Text helpers for the usage panel. No Herdr imports, so Node can test them.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a time span as its two largest units: "2d 5h", "3h 12m", "12m".
 * Each unit is floored. A span under a minute is "<1m"; zero or less is "0m".
 *
 * @param {number} ms Time span in milliseconds.
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!(ms > 0)) return "0m";
  if (ms < MINUTE) return "<1m";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Formats how long ago something happened, for the "Updated …" line.
 *
 * @param {number} ms Milliseconds since the event.
 * @returns {string}
 */
export function formatAgo(ms) {
  if (!(ms >= MINUTE)) return "less than a minute ago";
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  const hours = Math.floor(ms / HOUR);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

/**
 * Formats an amount given in the currency's minor units: "20.00 USD".
 *
 * @param {{ amount_minor: number, currency: string, exponent: number } | null | undefined} money
 * @returns {string | null} Null when a field is missing or invalid.
 */
export function formatMoney(money) {
  if (!money || !Number.isInteger(money.amount_minor) || !Number.isInteger(money.exponent)) return null;
  const currency = typeof money.currency === "string" ? money.currency.trim() : "";
  if (!currency) return null;
  const exponent = Math.min(Math.max(money.exponent, 0), 6);
  const sign = money.amount_minor < 0 ? "-" : "";
  const amount = Math.abs(money.amount_minor);
  if (exponent === 0) return `${sign}${amount} ${currency}`;
  const scale = 10 ** exponent;
  const fraction = String(amount % scale).padStart(exponent, "0");
  return `${sign}${Math.floor(amount / scale)}.${fraction} ${currency}`;
}

/**
 * Turns Claude's subscription type into a plan name: "max" becomes "Max".
 *
 * @param {string | null | undefined} subscriptionType
 * @returns {string | null}
 */
export function planName(subscriptionType) {
  const name = typeof subscriptionType === "string" ? subscriptionType.trim() : "";
  if (!name) return null;
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
