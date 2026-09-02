# Privacy

Twitter Focus does not collect, transmit, sell, share, or monetize user data.

The extension has no analytics, telemetry, crash-reporting service, advertising, remote code, or application server. It makes no network requests of its own. Normal requests made by X/Twitter remain between your browser and X/Twitter and are outside this extension's control.

## Data the extension does not retain, log, or transmit off-device

Twitter Focus does not collect, retain, log, or transmit off-device:

- Tweet, reply, or direct-message contents
- Usernames, display names, profile data, or social graphs
- Tweet or conversation identifiers
- Search terms
- Cookies, authentication tokens, or passwords
- Browser history outside the current X/Twitter page
- The full URLs of individual tweets, profiles, messages, or searches

To decide whether the policy applies, the content script and service worker transiently inspect the current X/Twitter URL, including its path, query string, and fragment. Full URLs are never persisted, logged, synchronized, or transmitted off-device or to a remote service; route handling reduces the location to a local classification such as “Home” or “not Home.”

## Data stored locally

The extension stores only the minimum state needed to apply its focus policy within your Chrome profile.

Persistent `chrome.storage.local` fields are:

- Settings such as mode and daily allowance
- A state/schema version used for safe upgrades
- The current local-day/reset boundary
- Aggregate milliseconds used for that day; remaining time is derived locally from the configured limit

The deliberate session's day and unlocked/locked state use `chrome.storage.session`, which Chrome clears when the browser session ends. The currently active tab lease and its random identifier exist only in background-worker memory and a transient copy in the active content document. They contain no X/Twitter URL, account identifier, or page content. Usage is aggregate time, not a browsing log.

This data stays on the local device. It is not synchronized by the extension and is removed when Chrome removes the extension's local storage, including on uninstall under normal Chrome behavior.

## Permissions

Twitter Focus uses Chrome's `storage` permission solely for the local fields above. Its site access is limited to `https://x.com/*`, `https://www.x.com/*`, `https://twitter.com/*`, and `https://www.twitter.com/*` so it can classify the current route and place the Home blocker. It does not request cookie, history, tabs, web-request, or all-sites access.

## Open-source verification

The complete extension source is available in this repository. Releases must contain only packaged local code and assets; contributors should reject changes that add telemetry, remote code, or data transmission without an explicit public design and corresponding update to this policy.

## Questions

Please open a repository issue for questions about this privacy statement or to report behavior that contradicts it.
