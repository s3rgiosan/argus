import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatAgo, formatMoney, planName } from "../mods/argus-claude-usage/format.js";

test("formatDuration", () => {
  assert.equal(formatDuration(30_000), "<1m");
  assert.equal(formatDuration(12 * 60_000), "12m");
  assert.equal(formatDuration((3 * 60 + 12) * 60_000), "3h 12m");
  assert.equal(formatDuration((2 * 24 + 5) * 3_600_000 + 59 * 60_000), "2d 5h");
  assert.equal(formatDuration(-5), "0m");
});

test("formatAgo", () => {
  assert.equal(formatAgo(10_000), "less than a minute ago");
  assert.equal(formatAgo(60_000), "1 minute ago");
  assert.equal(formatAgo(5 * 60_000), "5 minutes ago");
  assert.equal(formatAgo(3_600_000), "1 hour ago");
  assert.equal(formatAgo(3 * 3_600_000), "3 hours ago");
});

test("formatMoney", () => {
  assert.equal(formatMoney({ amount_minor: 0, currency: "USD", exponent: 2 }), "0.00 USD");
  assert.equal(formatMoney({ amount_minor: 2000, currency: "USD", exponent: 2 }), "20.00 USD");
  assert.equal(formatMoney({ amount_minor: -150, currency: "EUR", exponent: 2 }), "-1.50 EUR");
  assert.equal(formatMoney({ amount_minor: 5, currency: "JPY", exponent: 0 }), "5 JPY");
  assert.equal(formatMoney(null), null);
});

test("planName", () => {
  assert.equal(planName("max"), "Max");
  assert.equal(planName("team"), "Team");
  assert.equal(planName(""), null);
  assert.equal(planName(null), null);
});
