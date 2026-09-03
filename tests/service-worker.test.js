"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE_SOURCE = fs.readFileSync(path.join(ROOT, "src/shared/core.js"), "utf8");
const WORKER_SOURCE = fs.readFileSync(path.join(ROOT, "src/background/service-worker.js"), "utf8");

function createWorkerHarness({
  currentTab = { id: 7, windowId: 2, active: true, url: "https://x.com/home" },
  windowFocused = true,
} = {}) {
  let messageListener = null;
  const localValues = {};
  const sessionValues = {};
  let context;

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } },
    },
    storage: {
      local: {
        async setAccessLevel() {},
        async get(keys) {
          return Object.fromEntries(keys.filter((key) => key in localValues).map((key) => [key, localValues[key]]));
        },
        async set(values) { Object.assign(localValues, values); },
      },
      session: {
        async get(key) { return key in sessionValues ? { [key]: sessionValues[key] } : {}; },
        async set(values) { Object.assign(sessionValues, values); },
      },
    },
    tabs: {
      async get() { return { ...currentTab }; },
      async query() { return []; },
      async sendMessage() {},
    },
    windows: {
      async get() { return { focused: windowFocused }; },
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
  };

  context = vm.createContext({
    chrome,
    console,
    crypto: crypto.webcrypto,
    Date,
    performance,
    Promise,
    setTimeout,
    clearTimeout,
    URL,
  });
  context.self = context;
  context.globalThis = context;
  context.importScripts = () => vm.runInContext(CORE_SOURCE, context, { filename: "core.js" });
  vm.runInContext(WORKER_SOURCE, context, { filename: "service-worker.js" });

  async function send(message, sender = {}) {
    return new Promise((resolve, reject) => {
      try {
        const keepChannelOpen = messageListener(message, sender, resolve);
        assert.equal(keepChannelOpen, true);
      } catch (error) {
        reject(error);
      }
    });
  }

  return { send };
}

test("activity begins from the current Home tab despite stale SPA sender URLs", async () => {
  const worker = createWorkerHarness();
  await worker.send({ type: "START_SESSION" });

  const response = await worker.send(
    { type: "ACTIVITY_BEGIN", instanceId: "content-instance" },
    {
      documentId: "document-1",
      url: "https://x.com/messages",
      tab: { id: 7, windowId: 2, active: true, url: "https://x.com/messages" },
    },
  );

  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.snapshot.status, "unlocked");
  assert.equal(typeof response.leaseId, "string");
});

test("activity still requires the current tab to be focused Home", async () => {
  for (const options of [
    { currentTab: { id: 7, windowId: 2, active: true, url: "https://x.com/messages" } },
    { currentTab: { id: 7, windowId: 2, active: false, url: "https://x.com/home" } },
    { windowFocused: false },
  ]) {
    const worker = createWorkerHarness(options);
    await worker.send({ type: "START_SESSION" });
    const response = await worker.send(
      { type: "ACTIVITY_BEGIN", instanceId: "content-instance" },
      { documentId: "document-1", tab: { id: 7 } },
    );

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "NOT_FOREGROUND_HOME");
  }
});
