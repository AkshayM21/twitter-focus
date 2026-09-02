"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  localDayKey,
  nextLocalDayKey,
  normalizeGate,
  normalizeUsage
} = require("../src/shared/core.js");

test("localDayKey formats a local calendar date", () => {
  assert.equal(localDayKey(new Date(2026, 0, 2, 23, 59, 59)), "2026-01-02");
  assert.equal(localDayKey(new Date(2026, 10, 9, 0, 0, 0)), "2026-11-09");
});

test("nextLocalDayKey handles month, year, and leap-day boundaries", () => {
  assert.equal(nextLocalDayKey(new Date(2026, 0, 31, 23, 30)), "2026-02-01");
  assert.equal(nextLocalDayKey(new Date(2026, 11, 31, 23, 30)), "2027-01-01");
  assert.equal(nextLocalDayKey(new Date(2028, 1, 28, 23, 30)), "2028-02-29");
  assert.equal(nextLocalDayKey(new Date(2028, 1, 29, 23, 30)), "2028-03-01");
});

test("nextLocalDayKey advances by calendar day rather than 24-hour arithmetic", () => {
  const start = new Date(2026, 2, 7, 23, 30);
  const expected = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  assert.equal(nextLocalDayKey(start), localDayKey(expected));
});

test("usage normalization preserves valid persisted day state", () => {
  const usage = normalizeUsage({
    dayKey: "2026-09-01",
    usedMs: 90_000.9,
    revision: 4,
    updatedAtEpochMs: 1234
  }, "2026-09-02");

  assert.deepEqual(usage, {
    schemaVersion: 1,
    dayKey: "2026-09-01",
    usedMs: 90_000,
    revision: 4,
    updatedAtEpochMs: 1234
  });
});

test("invalid usage and gate data normalize to safe bounded shapes", () => {
  assert.deepEqual(normalizeUsage({
    dayKey: "tomorrow",
    usedMs: -1,
    revision: -2,
    updatedAtEpochMs: Infinity
  }, "2026-09-01"), {
    schemaVersion: 1,
    dayKey: "2026-09-01",
    usedMs: 0,
    revision: 0,
    updatedAtEpochMs: 0
  });

  assert.deepEqual(normalizeGate({ dayKey: "invalid", unlocked: "yes" }, "2026-09-01"), {
    schemaVersion: 1,
    dayKey: "2026-09-01",
    unlocked: false
  });
});
