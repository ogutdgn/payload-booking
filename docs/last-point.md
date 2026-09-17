# Last point

Last updated: 2026-09-16

## Shipped on `main`

- **Repo and packaging** (`f7bf6c8`) — scaffolded from Payload's plugin template, renamed to
  `@ogutdgn/payload-booking`, MIT, five export entries, peer dependencies rather than
  bundled copies.
- **Core logic** (`aeafffc`) — slot generation, lock keys, tokens, calendar files, the label
  formatter. Pure: no Payload imports, no I/O, no clock.
- **Data model** (`4eb8bf3`, `2e408d8`) — appointments, bookable locations, closed dates and
  the settings global, with the uniqueness constraint, the status guard, the closed-dates
  guard and idempotent seeding.
- **Endpoints** (`aed02b6`) — eight of them, the guard chain, the seat loop, and the four
  emails sent after the write commits.
- **Admin** (`3407a51`) — status buttons, Upcoming and Past nav links, the today widget, the
  weekday preview and row labels.
- **Booking UI** (`41f6af9`) — `BookingForm` and `CancelView`, plus the two host pages in the
  test bench.
- **Release readiness** (`930306f`) — CI on both databases and two timezones, the packaged
  install check, README and changelog.
- **Hooks and overrides** (`b66c5cc`) — `useBookingFlow` and `useCancelFlow` so a host can
  write any layout on the plugin's behaviour, and an `overrides` option for the admin that
  refuses to start if it would weaken a guarantee.

- **First host integration** (`afc5a2b`) — an optional customer field left empty no
  longer refuses the booking. A select the visitor never touched posts an empty string,
  which the appointments collection rejected against its own option list. Found while
  wiring the plugin into the Vera site, where it made the whole form unbookable. The
  test bench now declares an optional `purpose` select, so the integration suite covers
  custom customer fields.

Branch `main`, clean, one commit ahead of the `v0.1.0` tag and not pushed. Published
version `0.1.0`; the fix above is unreleased.

## Code touchpoints

`src/core` pure logic · `src/payload` collections, globals, hooks, overrides ·
`src/server` endpoints, guards, emails · `src/admin` admin components · `src/react` hooks
and the two components built on them · `dev` the test bench, two reference host pages, and
a wizard layout that proves the hooks are not tied to our markup.

## Verification

143 unit tests under four timezones, 82 integration tests green on PostgreSQL
including a ten-way booking race. CI green on every job. A booking was made and cancelled
end to end in a real browser, and a cancellation was run from the admin button. The packed
tarball installs into a fresh Payload project with one copy of each peer dependency and all
five entry points resolving.

Not yet run: the three Playwright specs in `dev/e2e`. They need `npx playwright install
chromium`, which stalled locally. The flows they cover were verified by hand.

See [CHANGELOG.md](../CHANGELOG.md) for what the release contains.
