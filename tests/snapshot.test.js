"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MODES,
  makeSnapshot,
  normalizeSettingsRecord
} = require("../src/shared/core.js");

function snapshot({
  mode = MODES.INTENTIONAL_SESSION,
  limitMinutes = 15,
  usedMs = 0,
  usageDay = "2026-09-01",
  gateDay = usageDay,
  unlocked = false,
  revision = 0,
  pending = null
} = {}) {
  return makeSnapshot(
    normalizeSettingsRecord({
      active: { mode, dailyLimitMinutes: limitMinutes },
      pending
    }),
    { dayKey: usageDay, usedMs, revision },
    { dayKey: gateDay, unlocked }
  );
}

test("reports locked, unlocked, exhausted, and always-block states", () => {
  assert.equal(snapshot().status, "locked");
  assert.equal(snapshot({ unlocked: true }).status, "unlocked");
  assert.equal(snapshot({ usedMs: 15 * 60 * 1000, unlocked: true }).status, "exhausted");
  assert.equal(snapshot({ mode: MODES.ALWAYS_BLOCK, unlocked: true }).status, "always_block");
});

test("a gate from another day never unlocks the current usage day", () => {
  const result = snapshot({
    usageDay: "2026-09-02",
    gateDay: "2026-09-01",
    unlocked: true
  });
  assert.equal(result.status, "locked");
});

test("snapshot time invariants hold at and beyond the daily limit", () => {
  const atLimit = snapshot({ usedMs: 900_000 });
  assert.equal(atLimit.limitMs, 900_000);
  assert.equal(atLimit.usedMs, 900_000);
  assert.equal(atLimit.remainingMs, 0);

  const beyondLimit = snapshot({ usedMs: Number.MAX_SAFE_INTEGER, revision: 7 });
  assert.equal(beyondLimit.usedMs, beyondLimit.limitMs);
  assert.equal(beyondLimit.remainingMs, 0);
  assert.equal(beyondLimit.revision, 7);
  assert.equal(beyondLimit.status, "exhausted");
});

test("used and remaining time are nonnegative and sum to the limit", () => {
  for (const usedMs of [-100, 0, 1, 123_456, 899_999, 900_000, 1_000_000]) {
    const result = snapshot({ usedMs });
    assert.ok(result.usedMs >= 0);
    assert.ok(result.remainingMs >= 0);
    assert.ok(result.usedMs <= result.limitMs);
    assert.equal(result.usedMs + result.remainingMs, result.limitMs);
  }
});

test("pending settings are disclosed without changing today's active limit", () => {
  const result = snapshot({
    pending: {
      settings: { mode: MODES.INTENTIONAL_SESSION, dailyLimitMinutes: 30 },
      effectiveDayKey: "2026-09-02"
    }
  });
  assert.equal(result.dailyLimitMinutes, 15);
  assert.equal(result.limitMs, 900_000);
  assert.equal(result.pendingSettings.dailyLimitMinutes, 30);
  assert.equal(result.pendingEffectiveDayKey, "2026-09-02");
});
