# Twitter Focus

Twitter Focus is a Chrome extension that puts the X/Twitter Home feed behind an intentional daily session—while leaving direct tweets, replies, profiles, search, notifications, bookmarks, and DMs available.

By default, Home is paused until you deliberately start a 15-minute session. Only time spent actively viewing the Home feed counts.

The default policy is intentionally simple:

- The Home timeline starts blocked each day.
- You may deliberately start a feed session with a total allowance of 15 minutes per local calendar day.
- Time counts only while `/home` is visible and focused.
- Leaving Home, switching tabs, minimizing Chrome, or moving focus to another window pauses the timer.
- At zero, Home remains blocked until the next local calendar day.
- There is no override and no usage-reset control.
- Both **For You** and **Following** are covered because both live on `/home`.

This is a focus aid, not a security boundary. You can still disable or uninstall the extension, use another browser/profile/device, or edit extension storage with developer tools.

## Install from source

1. Download or clone this repository. Twitter Focus requires Chrome 111 or newer.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository's root directory.
6. Pin Twitter Focus from Chrome's extensions menu if you want quick access to the session control.

After changing the source, return to `chrome://extensions`, click the extension's reload button, and reload any already-open X/Twitter tabs.

## Behavior

Only these routes are restricted:

- `https://x.com/home`
- `https://www.x.com/home`
- `https://twitter.com/home`
- `https://www.twitter.com/home`

Their trailing-slash, query-string, and fragment variants are restricted too.

Everything else is allowed by default, including future routes that the extension does not recognize. This narrow policy avoids turning the extension into a blanket Twitter blocker.

Starting a session unlocks Home only while daily time remains. Multiple starts do not create multiple allowances; they all draw from the same daily total. The extension pauses accounting whenever Home is not both visible and focused. A normal Manifest V3 service-worker suspension does not lose usage. A browser restart preserves usage and relocks Home, requiring another deliberate start.

At local midnight, the next interaction creates a fresh 15-minute allowance in the locked state. The reset is lazy, so Chrome does not need to be running at midnight. Day length follows local calendar midnights, including daylight-saving transitions.

## Settings

The options page can change the feed allowance and supported focus behavior. Defaults are:

- Mode: intentional session
- Daily allowance: 15 minutes
- Reset: local calendar day
- Override: none
- Usage reset: unavailable

V1 deliberately does not provide an override or a button, command, message, or setting that resets today's usage.

## Architecture

Twitter Focus is a dependency-free Manifest V3 extension:

- A content script classifies the current route, renders an extension-owned blocker on Home, and measures eligible active time.
- A background service worker is the authority for settings, session state, and daily usage. It serializes updates so multiple tabs cannot overwrite one another.
- Persistent state lives in `chrome.storage.local`; correctness does not depend on an always-running worker or an in-memory timer.
- X is a single-page application, so the content script observes URL and DOM changes rather than assuming every navigation reloads the page.
- The UI blocks only the central Home timeline. It does not hide replies, related tweets, or the right-hand sidebar on tweet pages.

The shared core is intentionally DOM-free and covered by Node tests. X-specific selectors are kept at the presentation boundary so site-layout changes are easier to repair.

## Permissions

The extension requests only:

- `storage`, to keep settings, aggregate daily usage, and session state locally.
- Site access for `https://x.com/*`, `https://www.x.com/*`, `https://twitter.com/*`, and `https://www.twitter.com/*`, so the content script can identify Home and place the blocker.

It does not request browsing history, cookies, downloads, notifications, network interception, or access to every website. It includes no analytics, telemetry, advertisements, remote code, or remote assets. See [PRIVACY.md](PRIVACY.md) for the complete data statement.

## Development

Run the test suite with:

```sh
npm test
```

The tests use Node's built-in `node:test` runner and require no test framework. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance, project constraints, and the manual release checklist.

## License

[MIT](LICENSE)
