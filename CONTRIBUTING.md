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

Then exercise the relevant items in README's manual release checklist. Changes involving timers or persistence should include multi-tab, browser-restart, and service-worker-suspension checks. Changes involving the blocker should include in-app navigation and X rerender checks on both `x.com` and `twitter.com`.

Automated tests should not depend on the live X website. Use pure core tests or deterministic DOM/SPA fixtures; keep the live site for manual release smoke tests.

## Privacy and security reports

Do not include private tweets, messages, account information, cookies, tokens, or screenshots containing sensitive material in an issue. Provide a minimal synthetic reproduction. For a report that would make public disclosure unsafe, contact the repository owner privately before opening an issue.

## Commit and review expectations

By contributing, you agree that your contribution is licensed under this repository's MIT License. Maintainers may ask for changes that reduce permissions, simplify state, or strengthen fail-closed behavior on Home before merging.
