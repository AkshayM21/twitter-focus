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
