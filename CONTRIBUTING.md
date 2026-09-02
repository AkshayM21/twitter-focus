# Contributing

Thanks for helping make Twitter Focus more dependable. The project values a narrow scope, minimal permissions, readable dependency-free code, and behavior that is easy to audit.

## Development setup

1. Fork and clone the repository.
2. Use a supported current Node.js release.
3. Run `npm test`.
4. Load the repository as an unpacked extension from `chrome://extensions` for browser testing.

No build step should be necessary for normal development. If a change introduces a dependency or generated artifact, explain why it is necessary in the pull request.

## Pull requests

- Keep changes focused and describe the user-visible behavior.
- Add or update tests for route, timer, settings, or state-machine changes.
- Preserve the rule that unknown non-Home routes are allowed.
- Do not add an override or usage-reset path without an explicit project-level product decision.
- Do not broaden host permissions or add a Chrome permission without documenting the reason in the README and privacy policy.
- Do not add analytics, telemetry, remote code, remote assets, or data transmission.
- Use DOM-safe APIs such as `textContent`; never interpolate X/Twitter page data into `innerHTML`.
- Keep site-specific selectors isolated and make blocker mounting idempotent.
- Update the manual release checklist when a change introduces a new browser behavior.

## Testing

Run automated tests:

```sh
npm test
```

Then exercise the relevant items in the manual release checklist below. Changes involving timers or persistence should include multi-tab, browser-restart, and service-worker-suspension checks. Changes involving the blocker should include in-app navigation and X rerender checks on both `x.com` and `twitter.com`.

Automated tests should not depend on the live X website. Use pure core tests or deterministic DOM/SPA fixtures; keep the live site for manual release smoke tests.

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

## Privacy and security reports

Do not include private tweets, messages, account information, cookies, tokens, or screenshots containing sensitive material in an issue. Provide a minimal synthetic reproduction. For a report that would make public disclosure unsafe, contact the repository owner privately before opening an issue.

## Commit and review expectations

By contributing, you agree that your contribution is licensed under this repository's MIT License. Maintainers may ask for changes that reduce permissions, simplify state, or strengthen fail-closed behavior on Home before merging.
