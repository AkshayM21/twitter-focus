"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isFocusedHomeTab, isHomeUrl } = require("../src/shared/core.js");

test("restricts the exact Home route on supported hosts", () => {
  const restricted = [
    "https://x.com/home",
    "https://x.com/home/",
    "https://x.com/home?lang=en",
    "https://x.com/home#following",
    "https://www.x.com/home",
    "https://twitter.com/home",
    "https://twitter.com/home/?source=nav",
    "https://www.twitter.com/home"
  ];

  for (const url of restricted) {
    assert.equal(isHomeUrl(url), true, url);
  }
});

test("allows every non-Home route, including useful and unknown routes", () => {
  const allowed = [
    "https://x.com/",
    "https://x.com/homework",
    "https://x.com/home/timeline",
    "https://x.com/Home",
    "https://x.com/someone/status/1234567890",
    "https://x.com/someone",
    "https://x.com/messages",
    "https://x.com/messages/123",
    "https://x.com/search?q=focus",
    "https://x.com/notifications",
    "https://x.com/i/bookmarks",
    "https://x.com/i/lists/123",
    "https://x.com/compose/post",
    "https://x.com/a/future/route",
    "https://twitter.com/someone/status/1234567890"
  ];

  for (const url of allowed) {
    assert.equal(isHomeUrl(url), false, url);
  }
});

test("rejects lookalike hosts, insecure URLs, and malformed input", () => {
  const allowed = [
    "http://x.com/home",
    "http://twitter.com/home",
    "https://mobile.x.com/home",
    "https://x.com.evil.example/home",
    "https://notx.com/home",
    "ftp://x.com/home",
    "not a URL",
    "",
    null,
    undefined,
    {},
    42
  ];

  for (const value of allowed) {
    assert.equal(isHomeUrl(value), false, String(value));
  }
});

test("accepts URL objects without mutating them", () => {
  const url = new URL("https://x.com/home?tab=for-you");
  const before = url.href;
  assert.equal(isHomeUrl(url), true);
  assert.equal(url.href, before);
});

test("focused Home validation uses the current tab and window state", () => {
  const tab = { id: 9, url: "https://x.com/home?from=messages", active: true };
  assert.equal(isFocusedHomeTab(tab, { focused: true }), true);
  assert.equal(isFocusedHomeTab({ ...tab, active: false }, { focused: true }), false);
  assert.equal(isFocusedHomeTab({ ...tab, url: "https://x.com/messages" }, { focused: true }), false);
  assert.equal(isFocusedHomeTab(tab, { focused: false }), false);
  assert.equal(isFocusedHomeTab(null, { focused: true }), false);
});
