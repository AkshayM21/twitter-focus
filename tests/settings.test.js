"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SETTINGS,
  MAX_LIMIT_MINUTES,
  MESSAGE_TYPES,
  MIN_LIMIT_MINUTES,
  MODES,
  STORAGE_KEYS,
  normalizeSettings,
  normalizeSettingsRecord,
  planSettingsUpdate,
  validateSettingsPatch
} = require("../src/shared/core.js");

test("ships the intentional 15-minute local-calendar default", () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    schemaVersion: 1,
    mode: MODES.INTENTIONAL_SESSION,
    dailyLimitMinutes: 15,
    resetPolicy: "local_calendar_day"
  });
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
});

test("normalizes persisted settings without accepting extra controls", () => {
  assert.deepEqual(normalizeSettings({
    mode: "unknown",
    dailyLimitMinutes: "60",
    resetPolicy: "rolling",
    override: true,
    resetUsage: true
  }), {
    schemaVersion: 1,
    mode: MODES.INTENTIONAL_SESSION,
    dailyLimitMinutes: 60,
    resetPolicy: "local_calendar_day"
  });

  assert.deepEqual(normalizeSettings({
    mode: MODES.ALWAYS_BLOCK,
    dailyLimitMinutes: MAX_LIMIT_MINUTES
  }), {
    schemaVersion: 1,
    mode: MODES.ALWAYS_BLOCK,
    dailyLimitMinutes: MAX_LIMIT_MINUTES,
    resetPolicy: "local_calendar_day"
  });
});

test("accepts only supported settings patch fields and bounds", () => {
  assert.deepEqual(validateSettingsPatch({}), {});
  assert.deepEqual(validateSettingsPatch({
    mode: MODES.INTENTIONAL_SESSION,
    dailyLimitMinutes: MIN_LIMIT_MINUTES
  }), {
    mode: MODES.INTENTIONAL_SESSION,
    dailyLimitMinutes: MIN_LIMIT_MINUTES
  });
  assert.doesNotThrow(() => validateSettingsPatch({ dailyLimitMinutes: MAX_LIMIT_MINUTES }));

  for (const patch of [null, [], "settings", 10]) {
    assert.throws(() => validateSettingsPatch(patch), TypeError);
  }
  for (const value of [0, -1, 1.5, String(MIN_LIMIT_MINUTES), MAX_LIMIT_MINUTES + 1, NaN]) {
    assert.throws(() => validateSettingsPatch({ dailyLimitMinutes: value }), RangeError);
  }
  assert.throws(() => validateSettingsPatch({ mode: "off" }), RangeError);
});

test("does not expose override or usage-reset settings or protocol messages", () => {
  for (const forbidden of [
    { override: true },
    { overrideBehavior: "allow" },
    { resetUsage: true },
    { usedMs: 0 },
    { dayKey: "2099-01-01" }
  ]) {
    assert.throws(() => validateSettingsPatch(forbidden), TypeError);
  }

  const protocolNames = [
    ...Object.keys(MESSAGE_TYPES),
    ...Object.values(MESSAGE_TYPES),
    ...Object.keys(STORAGE_KEYS),
    ...Object.values(STORAGE_KEYS)
  ].join(" ").toLowerCase();
  assert.doesNotMatch(protocolNames, /override|reset[ _-]?usage|usage[ _-]?reset/);
});

test("applies stricter settings immediately", () => {
  const current = normalizeSettingsRecord({
    active: { mode: MODES.INTENTIONAL_SESSION, dailyLimitMinutes: 15 }
  });

  const lowerLimit = planSettingsUpdate(current, { dailyLimitMinutes: 10 }, "2026-09-01");
  assert.equal(lowerLimit.active.dailyLimitMinutes, 10);
  assert.equal(lowerLimit.pending, null);

  const alwaysBlock = planSettingsUpdate(current, { mode: MODES.ALWAYS_BLOCK }, "2026-09-01");
  assert.equal(alwaysBlock.active.mode, MODES.ALWAYS_BLOCK);
  assert.equal(alwaysBlock.pending, null);
});

test("defers allowance increases and relaxation of always-block until the next day", () => {
  const current = normalizeSettingsRecord({
    active: { mode: MODES.INTENTIONAL_SESSION, dailyLimitMinutes: 15 }
  });
  const increase = planSettingsUpdate(current, { dailyLimitMinutes: 30 }, "2026-09-01");
  assert.equal(increase.active.dailyLimitMinutes, 15);
  assert.equal(increase.pending.settings.dailyLimitMinutes, 30);
  assert.equal(increase.pending.effectiveDayKey, "2026-09-02");

  const blocked = normalizeSettingsRecord({
    active: { mode: MODES.ALWAYS_BLOCK, dailyLimitMinutes: 15 }
  });
  const relax = planSettingsUpdate(blocked, { mode: MODES.INTENTIONAL_SESSION }, "2026-09-01");
  assert.equal(relax.active.mode, MODES.ALWAYS_BLOCK);
  assert.equal(relax.pending.settings.mode, MODES.INTENTIONAL_SESSION);
  assert.equal(relax.pending.effectiveDayKey, "2026-09-02");
});

test("subsequent edits update an existing pending plan without moving its day", () => {
  const record = {
    active: normalizeSettings({ dailyLimitMinutes: 15 }),
    pending: {
      settings: normalizeSettings({ dailyLimitMinutes: 30 }),
      effectiveDayKey: "2026-09-05"
    }
  };

  const updated = planSettingsUpdate(record, { dailyLimitMinutes: 45 }, "2026-09-01");
  assert.equal(updated.active.dailyLimitMinutes, 15);
  assert.equal(updated.pending.settings.dailyLimitMinutes, 45);
  assert.equal(updated.pending.effectiveDayKey, "2026-09-05");
});
