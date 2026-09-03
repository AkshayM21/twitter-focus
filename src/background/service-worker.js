"use strict";

importScripts("../shared/core.js");

const Core = self.TwitterFocusCore;
const {
  MESSAGE_TYPES,
  MODES,
  STORAGE_KEYS,
  isFocusedHomeTab,
  localDayKey,
  makeSnapshot,
  normalizeGate,
  normalizeSettingsRecord,
  normalizeUsage,
  planSettingsUpdate
} = Core;

const HOST_PATTERNS = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*"
];
const MAX_PULSE_DELTA_MS = 1500;
const MAX_LEASE_GAP_MS = 2500;

let initialization = null;
let operationQueue = Promise.resolve();
let state = null;

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    await ensureInitialized();
    await ensureCurrentDay();
    await updateActionBadge();
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    await ensureInitialized();
    await ensureCurrentDay();
    await updateActionBadge();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = enqueue(() => handleMessage(message, sender));
  task.then(sendResponse, (error) => {
    sendResponse(failure("INTERNAL_ERROR", error && error.message ? error.message : "Unexpected extension error."));
  });
  return true;
});

function enqueue(operation) {
  const task = operationQueue.then(operation, operation);
  operationQueue = task.catch(() => undefined);
  return task;
}

async function ensureInitialized() {
  if (state) {
    return state;
  }

  if (!initialization) {
    initialization = (async () => {
      const today = localDayKey();
      try {
        await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      } catch (_error) {
        // Gating still works if a compatible browser does not support this call.
      }
      const [localValues, sessionValues] = await Promise.all([
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.USAGE]),
        chrome.storage.session.get(STORAGE_KEYS.GATE)
      ]);

      state = {
        settingsRecord: normalizeSettingsRecord(localValues[STORAGE_KEYS.SETTINGS]),
        usage: normalizeUsage(localValues[STORAGE_KEYS.USAGE], today),
        gate: normalizeGate(sessionValues[STORAGE_KEYS.GATE], today),
        lease: null
      };

      return state;
    })().catch((error) => {
      initialization = null;
      state = null;
      throw error;
    });
  }

  return initialization;
}

async function ensureCurrentDay() {
  const today = localDayKey();
  let localChanged = false;
  let gateChanged = false;
  let settingsApplied = false;
  let usageRolled = false;

  if (state.settingsRecord.pending &&
      state.settingsRecord.pending.effectiveDayKey <= today) {
    state.settingsRecord = {
      schemaVersion: Core.SCHEMA_VERSION,
      active: state.settingsRecord.pending.settings,
      pending: null
    };
    state.lease = null;
    state.gate = { schemaVersion: Core.SCHEMA_VERSION, dayKey: today, unlocked: false };
    localChanged = true;
    gateChanged = true;
    settingsApplied = true;
  }

  if (state.usage.dayKey !== today) {
    state.usage = {
      schemaVersion: Core.SCHEMA_VERSION,
      dayKey: today,
      usedMs: 0,
      revision: state.usage.revision + 1,
      updatedAtEpochMs: Date.now()
    };
    state.lease = null;
    state.gate = { schemaVersion: Core.SCHEMA_VERSION, dayKey: today, unlocked: false };
    localChanged = true;
    gateChanged = true;
    usageRolled = true;
  } else if (state.gate.dayKey !== today) {
    state.gate = { schemaVersion: Core.SCHEMA_VERSION, dayKey: today, unlocked: false };
    state.lease = null;
    gateChanged = true;
  }

  if (settingsApplied && !usageRolled) {
    bumpRevision();
  }

  if (localChanged) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: state.settingsRecord,
      [STORAGE_KEYS.USAGE]: state.usage
    });
  }
  if (gateChanged) {
    await chrome.storage.session.set({ [STORAGE_KEYS.GATE]: state.gate });
  }

  return localChanged || gateChanged;
}

async function handleMessage(message, sender) {
  await ensureInitialized();
  const rolledOver = await ensureCurrentDay();
  if (rolledOver) {
    await broadcastSnapshot();
    await updateActionBadge();
  }

  if (!message || typeof message.type !== "string") {
    return failure("INVALID_MESSAGE", "Message type is required.", snapshot());
  }

  switch (message.type) {
    case MESSAGE_TYPES.GET_SNAPSHOT:
      return success(snapshot());
    case MESSAGE_TYPES.START_SESSION:
      return startSession();
    case MESSAGE_TYPES.PAUSE_SESSION:
      return pauseSession();
    case MESSAGE_TYPES.ACTIVITY_BEGIN:
      return beginActivity(message, sender);
    case MESSAGE_TYPES.ACTIVITY_PULSE:
      return pulseActivity(message, sender);
    case MESSAGE_TYPES.ACTIVITY_END:
      return endActivity(message, sender);
    case MESSAGE_TYPES.UPDATE_SETTINGS:
      return updateSettings(message);
    default:
      return failure("UNKNOWN_MESSAGE", `Unsupported message type: ${message.type}`, snapshot());
  }
}

async function startSession() {
  const current = snapshot();
  if (current.mode === MODES.ALWAYS_BLOCK) {
    return failure("ALWAYS_BLOCK", "Home is configured to remain blocked.", current);
  }
  if (current.remainingMs <= 0) {
    return failure("EXHAUSTED", "Today's Home allowance has been used.", current);
  }

  state.gate = {
    schemaVersion: Core.SCHEMA_VERSION,
    dayKey: current.dayKey,
    unlocked: true
  };
  bumpRevision();
  await persistUsageAndGate();
  await broadcastSnapshot();
  await updateActionBadge();
  return success(snapshot());
}

async function pauseSession() {
  if (state.lease) {
    const now = performance.now();
    if (!invalidateStaleLease(now)) {
      chargeLease(now);
    }
  }
  state.lease = null;
  state.gate = {
    schemaVersion: Core.SCHEMA_VERSION,
    dayKey: state.usage.dayKey,
    unlocked: false
  };
  bumpRevision();
  await persistUsageAndGate();
  await broadcastSnapshot();
  await updateActionBadge();
  return success(snapshot());
}

async function beginActivity(message, sender) {
  const instanceId = typeof message.instanceId === "string" ? message.instanceId.trim() : "";
  if (!instanceId || instanceId.length > 128) {
    return failure("INVALID_INSTANCE", "A valid content instance ID is required.", snapshot());
  }

  const documentId = typeof sender?.documentId === "string" ? sender.documentId : "";
  if (!documentId || documentId.length > 256) {
    return failure("INVALID_DOCUMENT", "A valid content document ID is required.", snapshot());
  }

  const current = snapshot();
  if (current.status !== "unlocked") {
    return failure(current.status === "exhausted" ? "EXHAUSTED" : "LOCKED", "Home is not unlocked.", current);
  }

  if (!(await senderIsFocusedHome(sender))) {
    return failure("NOT_FOREGROUND_HOME", "Activity only counts in the focused Home tab.", current);
  }

  if (state.lease) {
    const now = performance.now();
    if (!invalidateStaleLease(now)) {
      chargeLease(now);
    }
    if (snapshot().remainingMs <= 0) {
      await exhaustSession();
      return failure("EXHAUSTED", "Today's Home allowance has been used.", snapshot());
    }
  }

  const leaseId = createLeaseId();
  state.lease = {
    leaseId,
    tabId: sender.tab.id,
    documentId,
    instanceId,
    lastPulseAt: performance.now()
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.USAGE]: state.usage });
  return { ok: true, snapshot: snapshot(), leaseId };
}

async function pulseActivity(message, sender) {
  if (!leaseMatches(message.leaseId, sender)) {
    return failure("LEASE_INVALID", "The activity lease is no longer active.", snapshot());
  }

  if (!(await senderIsFocusedHome(sender))) {
    state.lease = null;
    return failure("NOT_FOREGROUND_HOME", "Activity only counts in the focused Home tab.", snapshot());
  }

  const now = performance.now();
  if (invalidateStaleLease(now)) {
    return failure("LEASE_INVALID", "The activity lease must be revalidated.", snapshot());
  }
  chargeLease(now);
  const exhausted = snapshot().remainingMs <= 0;
  if (exhausted) {
    await exhaustSession();
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.USAGE]: state.usage });
    await updateActionBadge();
  }

  return success(snapshot());
}

async function endActivity(message, sender) {
  if (!leaseMatches(message.leaseId, sender)) {
    return failure("LEASE_INVALID", "The activity lease is no longer active.", snapshot());
  }

  const now = performance.now();
  invalidateStaleLease(now);
  if (state.lease) {
    chargeLease(now);
  }
  state.lease = null;

  if (snapshot().remainingMs <= 0) {
    await exhaustSession();
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.USAGE]: state.usage });
    await updateActionBadge();
  }

  return success(snapshot());
}

async function updateSettings(message) {
  const patch = message.patch;
  let nextRecord;
  try {
    nextRecord = planSettingsUpdate(state.settingsRecord, patch, state.usage.dayKey);
  } catch (error) {
    return failure("INVALID_SETTINGS", error.message, snapshot());
  }

  if (state.lease) {
    const now = performance.now();
    if (!invalidateStaleLease(now)) {
      chargeLease(now);
    }
  }

  state.settingsRecord = nextRecord;
  const current = snapshot();
  if (current.mode === MODES.ALWAYS_BLOCK || current.remainingMs <= 0) {
    state.lease = null;
    state.gate = {
      schemaVersion: Core.SCHEMA_VERSION,
      dayKey: state.usage.dayKey,
      unlocked: false
    };
  }
  bumpRevision();

  await Promise.all([
    chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: state.settingsRecord,
      [STORAGE_KEYS.USAGE]: state.usage
    }),
    chrome.storage.session.set({ [STORAGE_KEYS.GATE]: state.gate })
  ]);
  await broadcastSnapshot();
  await updateActionBadge();
  return success(snapshot());
}

function chargeLease(now) {
  if (!state.lease) {
    return 0;
  }

  const rawDelta = now - state.lease.lastPulseAt;
  const delta = Math.max(0, Math.min(MAX_PULSE_DELTA_MS, rawDelta));
  state.lease.lastPulseAt = now;

  if (delta > 0) {
    const limitMs = state.settingsRecord.active.dailyLimitMinutes * 60 * 1000;
    state.usage.usedMs = Math.min(limitMs, Math.floor(state.usage.usedMs + delta));
    bumpRevision();
  }

  return delta;
}

function invalidateStaleLease(now) {
  if (!state.lease) {
    return false;
  }

  const rawDelta = now - state.lease.lastPulseAt;
  if (!Number.isFinite(rawDelta) || rawDelta > MAX_LEASE_GAP_MS) {
    state.lease = null;
    return true;
  }

  return false;
}

async function exhaustSession() {
  state.lease = null;
  state.gate = {
    schemaVersion: Core.SCHEMA_VERSION,
    dayKey: state.usage.dayKey,
    unlocked: false
  };
  await persistUsageAndGate();
  await broadcastSnapshot();
  await updateActionBadge();
}

function leaseMatches(leaseId, sender) {
  if (!state.lease || typeof leaseId !== "string" || leaseId !== state.lease.leaseId) {
    return false;
  }
  if (!sender?.tab || sender.tab.id !== state.lease.tabId) {
    return false;
  }
  if (typeof state.lease.documentId !== "string" || sender?.documentId !== state.lease.documentId) {
    return false;
  }
  return true;
}

async function senderIsFocusedHome(sender) {
  if (!sender?.tab || typeof sender.tab.id !== "number") {
    return false;
  }

  try {
    if (!chrome.tabs || typeof chrome.tabs.get !== "function") {
      return false;
    }
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!tab || typeof tab.windowId !== "number") {
      return false;
    }

    if (!chrome.windows || typeof chrome.windows.get !== "function") {
      return false;
    }
    const browserWindow = await chrome.windows.get(tab.windowId);
    return isFocusedHomeTab(tab, browserWindow);
  } catch (_error) {
    return false;
  }
}

function bumpRevision() {
  state.usage.revision += 1;
  state.usage.updatedAtEpochMs = Date.now();
}

async function persistUsageAndGate() {
  await Promise.all([
    chrome.storage.local.set({ [STORAGE_KEYS.USAGE]: state.usage }),
    chrome.storage.session.set({ [STORAGE_KEYS.GATE]: state.gate })
  ]);
}

function snapshot() {
  return makeSnapshot(state.settingsRecord, state.usage, state.gate);
}

function success(currentSnapshot) {
  return { ok: true, snapshot: currentSnapshot };
}

function failure(code, message, currentSnapshot) {
  const response = { ok: false, error: { code, message } };
  if (currentSnapshot) {
    response.snapshot = currentSnapshot;
  }
  return response;
}

function createLeaseId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") {
    return self.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  self.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function broadcastSnapshot() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: HOST_PATTERNS });
  } catch (_error) {
    return;
  }

  const message = { type: MESSAGE_TYPES.STATE_CHANGED, snapshot: snapshot() };
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") {
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (_error) {
      // Tabs without a ready content script are expected during navigation.
    }
  }));
}

async function updateActionBadge() {
  if (!chrome.action || !chrome.action.setBadgeText) {
    return;
  }

  const current = snapshot();
  let text = "";
  if (current.status === "unlocked") {
    text = String(Math.max(1, Math.ceil(current.remainingMs / 60000)));
  } else if (current.status === "exhausted") {
    text = "0";
  }

  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#536471" });
    await chrome.action.setBadgeText({ text });
  } catch (_error) {
    // Badge support is cosmetic and must not affect gating.
  }
}
