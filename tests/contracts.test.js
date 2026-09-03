"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOST_PATTERNS = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("manifest exposes only the documented permission surface", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.equal(manifest.minimum_chrome_version, "111");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, HOST_PATTERNS);
  assert.deepEqual(manifest.content_scripts[0].matches, HOST_PATTERNS);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, HOST_PATTERNS);
});

test("README and privacy policy disclose every granted host pattern", () => {
  for (const file of ["README.md", "PRIVACY.md"]) {
    const document = read(file);
    for (const hostPattern of HOST_PATTERNS) {
      assert.ok(document.includes(hostPattern), `${file} omits ${hostPattern}`);
    }
  }
});

test("extension protocol has no override or usage-reset control surface", () => {
  const protocolSource = [
    "src/shared/core.js",
    "src/background/service-worker.js",
    "src/content/content.js",
    "src/popup/popup.js",
    "src/options/options.js"
  ].map(read).join("\n");

  assert.doesNotMatch(
    protocolSource,
    /\boverride\b|reset[ _-]?usage|usage[ _-]?reset/i
  );
});

test("active Home has persistent pause controls and completion recovery", () => {
  const contentSource = read("src/content/content.js");
  const contentStyles = read("src/content/content.css");

  assert.match(contentSource, /className = "session-dock"/);
  assert.match(contentSource, /aria-label="Pause Home session"/);
  assert.match(contentSource, /scrollIntoView\(\{ block: "start", behavior: "auto" \}\)/);
  assert.match(contentSource, /code === "NOT_FOREGROUND_HOME" && snapshot\?\.status === "unlocked"/);
  assert.match(contentStyles, /:host \.session-dock \{[\s\S]*position: fixed;/);
});

test("foreground Home checks do not trust stale SPA sender URLs", () => {
  const workerSource = read("src/background/service-worker.js");
  const foregroundCheck = workerSource.slice(
    workerSource.indexOf("async function senderIsFocusedHome"),
    workerSource.indexOf("function bumpRevision"),
  );

  assert.doesNotMatch(foregroundCheck, /senderUrl|sender\.url|sender\.tab\.url/);
  assert.match(foregroundCheck, /chrome\.tabs\.get\(sender\.tab\.id\)/);
});

test("the blocker icon has stable presentation before async styles load", () => {
  const contentSource = read("src/content/content.js");

  assert.match(contentSource, /MINIMAL_SHADOW_CSS[^\n]+\.mark\{display:block;width:48px;height:48px/);
  assert.match(
    contentSource,
    /<svg class="mark"[^>]+width="48" height="48" fill="none" stroke="currentColor"/,
  );
  assert.match(contentSource, /class="mark-dot"[^>]+fill="currentColor" stroke="currentColor"/);
});
