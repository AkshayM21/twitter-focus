(function initTwitterFocusCore(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.TwitterFocusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function createCore() {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MIN_LIMIT_MINUTES = 1;
  const MAX_LIMIT_MINUTES = 120;

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: "twitterFocus.settings.v1",
    USAGE: "twitterFocus.usage.v1",
    GATE: "twitterFocus.gate.v1"
  });

  const MESSAGE_TYPES = Object.freeze({
    GET_SNAPSHOT: "GET_SNAPSHOT",
    START_SESSION: "START_SESSION",
    PAUSE_SESSION: "PAUSE_SESSION",
    ACTIVITY_BEGIN: "ACTIVITY_BEGIN",
    ACTIVITY_PULSE: "ACTIVITY_PULSE",
    ACTIVITY_END: "ACTIVITY_END",
    UPDATE_SETTINGS: "UPDATE_SETTINGS",
    STATE_CHANGED: "STATE_CHANGED"
  });

  const MODES = Object.freeze({
    INTENTIONAL_SESSION: "intentional_session",
    ALWAYS_BLOCK: "always_block"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    mode: MODES.INTENTIONAL_SESSION,
    dailyLimitMinutes: 15,
    resetPolicy: "local_calendar_day"
  });

  const ALLOWED_HOSTS = new Set([
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com"
  ]);

  function localDayKey(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function nextLocalDayKey(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value == null ? Date.now() : value);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return localDayKey(date);
  }

  function isHomeUrl(input) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      return url.protocol === "https:" &&
        ALLOWED_HOSTS.has(url.hostname.toLowerCase()) &&
        (url.pathname === "/home" || url.pathname === "/home/");
    } catch (_error) {
      return false;
    }
  }

  function isFocusedHomeTab(tab, browserWindow) {
    return !!tab &&
      typeof tab.id === "number" &&
      tab.active === true &&
      isHomeUrl(tab.url) &&
      browserWindow?.focused === true;
  }

  function normalizeSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const mode = Object.values(MODES).includes(source.mode)
      ? source.mode
      : DEFAULT_SETTINGS.mode;
    const candidateLimit = Number(source.dailyLimitMinutes);
    const dailyLimitMinutes = Number.isInteger(candidateLimit) &&
      candidateLimit >= MIN_LIMIT_MINUTES &&
      candidateLimit <= MAX_LIMIT_MINUTES
      ? candidateLimit
      : DEFAULT_SETTINGS.dailyLimitMinutes;

    return {
      schemaVersion: SCHEMA_VERSION,
      mode,
      dailyLimitMinutes,
      resetPolicy: "local_calendar_day"
    };
  }

  function normalizeSettingsRecord(value) {
    const source = value && typeof value === "object" ? value : {};
    const active = normalizeSettings(source.active || source);
    let pending = null;

    if (source.pending && typeof source.pending === "object" &&
        /^\d{4}-\d{2}-\d{2}$/.test(source.pending.effectiveDayKey || "")) {
      pending = {
        settings: normalizeSettings(source.pending.settings),
        effectiveDayKey: source.pending.effectiveDayKey
      };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      active,
      pending
    };
  }

  function validateSettingsPatch(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("Settings patch must be an object.");
    }

    const allowedKeys = new Set(["mode", "dailyLimitMinutes"]);
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.has(key)) {
        throw new TypeError(`Unsupported setting: ${key}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "mode") &&
        !Object.values(MODES).includes(patch.mode)) {
      throw new RangeError("mode must be intentional_session or always_block.");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "dailyLimitMinutes")) {
      if (!Number.isInteger(patch.dailyLimitMinutes) ||
          patch.dailyLimitMinutes < MIN_LIMIT_MINUTES ||
          patch.dailyLimitMinutes > MAX_LIMIT_MINUTES) {
        throw new RangeError(`dailyLimitMinutes must be an integer from ${MIN_LIMIT_MINUTES} to ${MAX_LIMIT_MINUTES}.`);
      }
    }

    return patch;
  }

  function planSettingsUpdate(recordValue, patchValue, todayValue) {
    const record = normalizeSettingsRecord(recordValue);
    const patch = validateSettingsPatch(patchValue);
    const today = typeof todayValue === "string" ? todayValue : localDayKey(todayValue);
    const desiredBase = record.pending ? record.pending.settings : record.active;
    const desired = normalizeSettings({ ...desiredBase, ...patch });

    const active = { ...record.active };

    if (desired.mode === MODES.ALWAYS_BLOCK || desired.mode === active.mode) {
      active.mode = desired.mode;
    }

    if (desired.dailyLimitMinutes <= active.dailyLimitMinutes) {
      active.dailyLimitMinutes = desired.dailyLimitMinutes;
    }

    const isFullyApplied = active.mode === desired.mode &&
      active.dailyLimitMinutes === desired.dailyLimitMinutes;
    const priorEffectiveDay = record.pending && record.pending.effectiveDayKey > today
      ? record.pending.effectiveDayKey
      : null;

    return {
      schemaVersion: SCHEMA_VERSION,
      active: normalizeSettings(active),
      pending: isFullyApplied
        ? null
        : {
            settings: desired,
            effectiveDayKey: priorEffectiveDay || nextLocalDayKey(new Date(`${today}T12:00:00`))
          }
    };
  }

  function normalizeUsage(value, todayValue) {
    const today = typeof todayValue === "string" ? todayValue : localDayKey(todayValue);
    const source = value && typeof value === "object" ? value : {};
    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(source.dayKey || "")
      ? source.dayKey
      : today;
    const usedMs = Number.isFinite(source.usedMs) && source.usedMs >= 0
      ? Math.floor(source.usedMs)
      : 0;
    const revision = Number.isInteger(source.revision) && source.revision >= 0
      ? source.revision
      : 0;
    const updatedAtEpochMs = Number.isFinite(source.updatedAtEpochMs)
      ? source.updatedAtEpochMs
      : 0;

    return {
      schemaVersion: SCHEMA_VERSION,
      dayKey,
      usedMs,
      revision,
      updatedAtEpochMs
    };
  }

  function normalizeGate(value, todayValue) {
    const today = typeof todayValue === "string" ? todayValue : localDayKey(todayValue);
    const source = value && typeof value === "object" ? value : {};
    const hasValidDayKey = /^\d{4}-\d{2}-\d{2}$/.test(source.dayKey || "");
    return {
      schemaVersion: SCHEMA_VERSION,
      dayKey: hasValidDayKey ? source.dayKey : today,
      unlocked: hasValidDayKey && source.unlocked === true
    };
  }

  function makeSnapshot(settingsRecordValue, usageValue, gateValue) {
    const settingsRecord = normalizeSettingsRecord(settingsRecordValue);
    const usage = normalizeUsage(usageValue, usageValue && usageValue.dayKey);
    const gate = normalizeGate(gateValue, usage.dayKey);
    const settings = settingsRecord.active;
    const limitMs = settings.dailyLimitMinutes * 60 * 1000;
    const usedMs = Math.min(Math.max(0, usage.usedMs), limitMs);
    const remainingMs = Math.max(0, limitMs - usedMs);

    let status = "locked";
    if (settings.mode === MODES.ALWAYS_BLOCK) {
      status = "always_block";
    } else if (remainingMs === 0) {
      status = "exhausted";
    } else if (gate.dayKey === usage.dayKey && gate.unlocked) {
      status = "unlocked";
    }

    return {
      revision: usage.revision,
      dayKey: usage.dayKey,
      mode: settings.mode,
      dailyLimitMinutes: settings.dailyLimitMinutes,
      limitMs,
      usedMs,
      remainingMs,
      status,
      pendingSettings: settingsRecord.pending ? { ...settingsRecord.pending.settings } : null,
      pendingEffectiveDayKey: settingsRecord.pending
        ? settingsRecord.pending.effectiveDayKey
        : null
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    MIN_LIMIT_MINUTES,
    MAX_LIMIT_MINUTES,
    STORAGE_KEYS,
    MESSAGE_TYPES,
    MODES,
    DEFAULT_SETTINGS,
    localDayKey,
    nextLocalDayKey,
    isHomeUrl,
    isFocusedHomeTab,
    normalizeSettings,
    normalizeSettingsRecord,
    validateSettingsPatch,
    planSettingsUpdate,
    normalizeUsage,
    normalizeGate,
    makeSnapshot
  });
});
