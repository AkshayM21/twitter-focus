"use strict";

const MESSAGE_TYPES = {
  GET_SNAPSHOT: "GET_SNAPSHOT",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
};

const elements = {
  root: document.querySelector("main"),
  form: document.querySelector("#settings-form"),
  modeInputs: Array.from(document.querySelectorAll('input[name="mode"]')),
  dailyLimit: document.querySelector("#daily-limit"),
  pendingNotice: document.querySelector("#pending-notice"),
  pendingTitle: document.querySelector("#pending-title"),
  pendingDescription: document.querySelector("#pending-description"),
  saveStatus: document.querySelector("#save-status"),
  loadError: document.querySelector("#load-error"),
};

let snapshot = null;
let saveTimer = null;
let saveSequence = 0;
let formRevision = 0;

function normalizeError(error) {
  if (!error) return "The settings could not be saved. Try again.";
  if (typeof error === "string") return error;
  return error.message || "The settings could not be saved. Try again.";
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response || response.ok !== true) {
    const failure = new Error(normalizeError(response?.error));
    failure.snapshot = response?.snapshot;
    throw failure;
  }
  return response.snapshot;
}

function modeLabel(mode) {
  return mode === "always_block" ? "Always paused" : "Intentional session";
}

function formatEffectiveDate(dayKey) {
  if (!dayKey) return "at the next calendar-day reset";
  const parts = String(dayKey).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return "at the next calendar-day reset";
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return `on ${new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
  }).format(date)}`;
}

function readFormPatch() {
  const checkedMode = elements.modeInputs.find((input) => input.checked);
  return {
    mode: checkedMode?.value || "intentional_session",
    dailyLimitMinutes: Number(elements.dailyLimit.value),
  };
}

function fillForm(nextSnapshot) {
  const pending = nextSnapshot?.pendingSettings || {};
  const displayedMode = pending.mode ?? nextSnapshot?.mode ?? "intentional_session";
  const displayedLimit = Number(
    pending.dailyLimitMinutes ??
      nextSnapshot?.dailyLimitMinutes ??
      Math.round(Number(nextSnapshot?.limitMs || 900000) / 60000),
  );

  const modeInput = elements.modeInputs.find((input) => input.value === displayedMode);
  if (modeInput) modeInput.checked = true;

  const existingCustomOption = elements.dailyLimit.querySelector("option[data-custom]");
  const supportedLimit = Array.from(elements.dailyLimit.options).some(
    (option) => Number(option.value) === displayedLimit,
  );
  if (!supportedLimit && Number.isInteger(displayedLimit) && displayedLimit >= 1 && displayedLimit <= 120) {
    existingCustomOption?.remove();
    const customOption = document.createElement("option");
    customOption.value = String(displayedLimit);
    customOption.textContent = `${displayedLimit} minutes`;
    customOption.dataset.custom = "true";
    elements.dailyLimit.append(customOption);
  } else if (supportedLimit && existingCustomOption && Number(existingCustomOption.value) !== displayedLimit) {
    existingCustomOption.remove();
  }
  elements.dailyLimit.value = String(displayedLimit);
  updateChoiceRows();
}

function updateChoiceRows() {
  for (const input of elements.modeInputs) {
    input.closest(".choice-row")?.classList.toggle("is-selected", input.checked);
  }
}

function describePending(nextSnapshot) {
  const pending = nextSnapshot?.pendingSettings;
  if (!pending || Object.keys(pending).length === 0) {
    elements.pendingNotice.hidden = true;
    return;
  }

  const parts = [];
  if (pending.mode) parts.push(modeLabel(pending.mode));
  if (pending.dailyLimitMinutes != null) {
    parts.push(`${pending.dailyLimitMinutes} minutes per day`);
  }

  elements.pendingTitle.textContent = "A more permissive change is scheduled.";
  elements.pendingDescription.textContent = `${parts.join(" · ")} begins ${formatEffectiveDate(
    nextSnapshot.pendingEffectiveDayKey,
  )}.`;
  elements.pendingNotice.hidden = false;
}

function render(nextSnapshot, { fill = true } = {}) {
  snapshot = nextSnapshot;
  if (fill) fillForm(nextSnapshot);
  describePending(nextSnapshot);
  elements.root.setAttribute("aria-busy", "false");
  elements.form.removeAttribute("aria-disabled");
  elements.loadError.hidden = true;
}

function setFormDisabled(disabled) {
  for (const input of [...elements.modeInputs, elements.dailyLimit]) {
    input.disabled = disabled;
  }
  if (disabled) elements.form.setAttribute("aria-disabled", "true");
  else elements.form.removeAttribute("aria-disabled");
}

async function loadSettings() {
  setFormDisabled(true);
  let loaded = false;
  try {
    const nextSnapshot = await send(MESSAGE_TYPES.GET_SNAPSHOT);
    render(nextSnapshot);
    elements.saveStatus.textContent = "Settings save automatically.";
    loaded = true;
  } catch (error) {
    elements.root.setAttribute("aria-busy", "false");
    elements.loadError.textContent = normalizeError(error);
    elements.loadError.hidden = false;
    elements.saveStatus.textContent = "Settings are unavailable.";
  } finally {
    // Do not expose controls until there is an authoritative snapshot to edit.
    setFormDisabled(!loaded);
  }
}

async function saveSettings(revision = formRevision) {
  const sequence = ++saveSequence;
  const patch = readFormPatch();
  elements.saveStatus.textContent = "Saving…";
  elements.loadError.hidden = true;

  try {
    const nextSnapshot = await send(MESSAGE_TYPES.UPDATE_SETTINGS, { patch });
    // A newer change owns the form. Do not let this response overwrite it;
    // its debounced save will send the current values shortly.
    if (sequence !== saveSequence || revision !== formRevision) return;
    render(nextSnapshot);
    elements.saveStatus.textContent = nextSnapshot?.pendingSettings
      ? "Saved. Scheduled changes begin at the next reset."
      : "Saved.";
  } catch (error) {
    if (sequence !== saveSequence || revision !== formRevision) return;
    if (error.snapshot) {
      render(error.snapshot);
    } else if (snapshot) {
      fillForm(snapshot);
    }
    elements.loadError.textContent = normalizeError(error);
    elements.loadError.hidden = false;
    elements.saveStatus.textContent = "Couldn’t save.";
  }
}

function scheduleSave() {
  formRevision += 1;
  updateChoiceRows();
  window.clearTimeout(saveTimer);
  const revision = formRevision;
  saveTimer = window.setTimeout(() => saveSettings(revision), 180);
}

elements.form.addEventListener("change", scheduleSave);
loadSettings();
