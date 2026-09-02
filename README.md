# Twitter Focus

Twitter Focus is a small Chrome extension that removes the distracting Home timeline from X/Twitter while leaving the useful parts of the site alone. Direct tweet links, replies, related tweets, profiles, search, notifications, bookmarks, lists, DMs, composing, and the right-hand sidebar continue to work normally.

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

1. Download or clone this repository.
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

## Limitations

- X can change its routes or DOM structure. The extension fails closed on Home when it cannot safely identify the timeline, but live-site smoke testing is still required for releases.
- Chrome extensions do not cover X's mobile apps or other browsers unless separately ported.
- Usage is local to a Chrome profile and is not synchronized across devices or profiles.
- Incognito windows are governed by Chrome's per-extension Incognito permission and can provide an unprotected path if the extension is not enabled there.
- A user can bypass this focus aid by disabling it, uninstalling it, changing local extension storage, using another profile, or manipulating the system clock.
- Without a trusted network clock, large manual clock or timezone changes can move the perceived calendar boundary. The extension never sends a network request merely to police the clock.
- After installing or updating an unpacked extension, existing X/Twitter tabs may need to be reloaded.

## Manual release checklist

Before publishing a release, test the packaged build in a clean Chrome profile:

- [ ] A fresh `/home` load is blocked before the feed becomes visible.
- [ ] Both **For You** and **Following** are blocked before a session and unlocked during one.
- [ ] A deliberate session shares one daily allowance across reloads, duplicate tabs, and multiple windows.
- [ ] Time counts only on a visible, focused Home tab.
- [ ] Background tabs, unfocused windows, sleep, tweets, DMs, profiles, and other routes do not consume time.
- [ ] At zero, every Home tab blocks and no override or usage-reset control exists.
- [ ] The next local day starts locked with a fresh allowance.
- [ ] Direct tweet links work from a cold browser launch.
- [ ] Replies, related tweets, profiles, DMs, search, notifications, bookmarks, lists, compose, and the right-hand sidebar are unchanged.
- [ ] Hard navigation, X's in-app navigation, Back/Forward, redirects, and restored tabs all enforce the same route policy.
- [ ] Narrow and wide layouts, zoom, light/dark mode, keyboard navigation, and reduced motion remain usable.
- [ ] Logged-out behavior is safe and comprehensible.
- [ ] Repeated X rerenders do not duplicate the blocker or create visible feed flashes.
- [ ] Browser restart and forced service-worker suspension preserve used time.
- [ ] The final manifest contains only the documented permissions and packaged local code/assets.
- [ ] Tests pass from a clean checkout.

## License

[MIT](LICENSE)
