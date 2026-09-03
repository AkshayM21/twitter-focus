"use strict";

const MESSAGE_TYPES = {
  GET_SNAPSHOT: "GET_SNAPSHOT",
  START_SESSION: "START_SESSION",
  PAUSE_SESSION: "PAUSE_SESSION",
  OPEN_OPTIONS_PAGE: "OPEN_OPTIONS_PAGE",
};

const HOME_URL = "https://x.com/home";

const elements = {
  root: document.querySelector("main"),
  settingsButton: document.querySelector("#settings-button"),
  stateLabel: document.querySelector("#session-heading"),
  remainingTime: document.querySelector("#remaining-time"),
  timeCaption: document.querySelector("#time-caption"),
  summary: document.querySelector("#session-summary"),
  primaryAction: document.querySelector("#primary-action"),
  actionError: document.querySelector("#action-error"),
  countingNote: document.querySelector("#counting-note"),
  announcer: document.querySelector("#announcer"),
};

let snapshot = null;
let isWorking = false;
let pollTimer = null;
let lastAnnouncedStatus = null;

function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function humanMinutes(milliseconds) {
  const minutes = Math.max(0, Math.ceil(Number(milliseconds || 0) / 60000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function normalizeError(error) {
  if (!error) return "Twitter Focus could not update the session. Try again.";
  if (typeof error === "string") return error;
  return error.message || "Twitter Focus could not update the session. Try again.";
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response || response.ok !== true) {
    const message = normalizeError(response?.error);
    const failure = new Error(message);
    failure.snapshot = response?.snapshot;
    throw failure;
  }
  return response.snapshot;
}

function announceStatus(status, message) {
  if (lastAnnouncedStatus === status) return;
  lastAnnouncedStatus = status;
  elements.announcer.textContent = message;
}

function showPrimary(label, action) {
  elements.primaryAction.hidden = false;
  elements.primaryAction.textContent = label;
  elements.primaryAction.dataset.action = action;
}

function hidePrimary() {
  elements.primaryAction.hidden = true;
  elements.primaryAction.textContent = "";
  delete elements.primaryAction.dataset.action;
}

function render(nextSnapshot) {
  snapshot = nextSnapshot;
  const status = snapshot?.status || "locked";
  const remainingMs = Math.max(0, Number(snapshot?.remainingMs || 0));
  const dailyLimitMinutes = Number(
    snapshot?.dailyLimitMinutes ?? Math.round(Number(snapshot?.limitMs || 0) / 60000),
  );

  elements.root.setAttribute("aria-busy", "false");
  elements.actionError.hidden = true;
  elements.primaryAction.disabled = isWorking;
  elements.remainingTime.hidden = false;
  elements.timeCaption.hidden = false;
  elements.countingNote.textContent = "Time counts only while Home is visible and focused.";

  if (status === "always_block" || snapshot?.mode === "always_block") {
    elements.stateLabel.textContent = "Home paused";
    elements.remainingTime.hidden = true;
    elements.timeCaption.hidden = true;
    elements.summary.textContent =
      "Home remains off. Individual tweets, replies, profiles, search, and messages still work.";
    elements.countingNote.textContent = "Always paused is on in Settings.";
    hidePrimary();
    announceStatus(status, "Home remains paused.");
    return;
  }

  if (status === "exhausted" || remainingMs <= 0) {
    elements.stateLabel.textContent = "Home paused";
    elements.remainingTime.hidden = true;
    elements.timeCaption.textContent = "Available again tomorrow at midnight";
    elements.summary.textContent =
      "Today’s Home time is complete. Direct tweets and the rest of Twitter still work.";
    hidePrimary();
    announceStatus("exhausted", "Today’s Home time is complete.");
    return;
  }

  const formattedRemaining = formatClock(remainingMs);
  elements.remainingTime.textContent = formattedRemaining;
  elements.remainingTime.setAttribute("aria-label", `${formattedRemaining} remaining Home time`);

  if (status === "unlocked") {
    elements.stateLabel.textContent = "Session active";
    elements.timeCaption.textContent = "remaining today";
    elements.summary.textContent =
      "The Home feed is available. Its timer pauses whenever Home is not visible and focused.";
    showPrimary("Pause Home", "pause");
    announceStatus(status, `Home session active with ${humanMinutes(remainingMs)} remaining.`);
    return;
  }

  elements.stateLabel.textContent = "Home paused";
  elements.timeCaption.textContent = "available today";
  elements.summary.textContent =
    "Start deliberately when you want the feed. Direct tweets and the rest of Twitter remain available.";
  const hasUsedTime = Number(snapshot?.usedMs || 0) > 0;
  showPrimary(
    hasUsedTime
      ? "Resume Home"
      : `Start ${dailyLimitMinutes || Math.ceil(remainingMs / 60000)}-minute session`,
    "start",
  );
  announceStatus(status, `Home is paused with ${humanMinutes(remainingMs)} available today.`);
}

function renderLoadError(error) {
  elements.root.setAttribute("aria-busy", "false");
  elements.stateLabel.textContent = "Home paused for now";
  elements.remainingTime.hidden = true;
  elements.timeCaption.hidden = true;
  elements.summary.textContent = "We couldn’t restore your session status.";
  elements.actionError.textContent = normalizeError(error);
  elements.actionError.hidden = false;
  showPrimary("Try again", "retry");
  announceStatus("error", "Home is paused because the session status could not be restored.");
}

async function openSettings() {
  elements.settingsButton.disabled = true;
  elements.actionError.hidden = true;
  try {
    await send(MESSAGE_TYPES.OPEN_OPTIONS_PAGE);
    window.close();
  } catch (error) {
    window.clearInterval(pollTimer);
    pollTimer = null;
    elements.actionError.textContent = normalizeError(error);
    elements.actionError.hidden = false;
    announceStatus("settings-error", "Settings could not be opened.");
  } finally {
    elements.settingsButton.disabled = false;
  }
}

async function loadSnapshot({ silent = false } = {}) {
  try {
    const nextSnapshot = await send(MESSAGE_TYPES.GET_SNAPSHOT);
    render(nextSnapshot);
  } catch (error) {
    if (!silent || !snapshot) renderLoadError(error);
  }
}

async function openHomeIfNeeded() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeUrl = activeTab?.url ? new URL(activeTab.url) : null;
    const isHome =
      activeUrl &&
      activeUrl.protocol === "https:" &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(activeUrl.hostname) &&
      (activeUrl.pathname === "/home" || activeUrl.pathname === "/home/");
    if (!isHome) await chrome.tabs.create({ url: HOME_URL });
  } catch {
    await chrome.tabs.create({ url: HOME_URL });
  }
}

async function handlePrimaryAction() {
  if (isWorking) return;
  const action = elements.primaryAction.dataset.action;
  isWorking = true;
  elements.primaryAction.disabled = true;
  elements.actionError.hidden = true;

  try {
    if (action === "retry") {
      await loadSnapshot();
      return;
    }

    if (action === "pause") {
      const nextSnapshot = await send(MESSAGE_TYPES.PAUSE_SESSION);
      render(nextSnapshot);
      return;
    }

    if (action === "start") {
      const nextSnapshot = await send(MESSAGE_TYPES.START_SESSION);
      render(nextSnapshot);
      await openHomeIfNeeded();
      window.close();
    }
  } catch (error) {
    if (error.snapshot) render(error.snapshot);
    elements.actionError.textContent = normalizeError(error);
    elements.actionError.hidden = false;
  } finally {
    isWorking = false;
    elements.primaryAction.disabled = false;
  }
}

elements.primaryAction.addEventListener("click", handlePrimaryAction);
elements.settingsButton.addEventListener("click", openSettings);

loadSnapshot();
pollTimer = window.setInterval(() => loadSnapshot({ silent: true }), 1000);
window.addEventListener("unload", () => window.clearInterval(pollTimer), { once: true });
