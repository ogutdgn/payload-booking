# Last point

Last updated: 2026-09-16

## Shipped on `main`

- **Repo and packaging** (`f7bf6c8`) — scaffolded from Payload's plugin template, renamed to
  `@ogutdgn/payload-booking`, MIT, five export entries, peer dependencies rather than
  bundled copies.
- **Core logic** (`aeafffc`) — slot generation, lock keys, tokens, calendar files, the label
  formatter. Pure: no Payload imports, no I/O, no clock.
- **Data model** (`4eb8bf3`, `2e408d8`) — appointments, bookable locations, closed dates and
  the settings global, with the uniqueness constraint, the status guard, the blackout guard
  and idempotent seeding.
- **Endpoints** (`aed02b6`) — eight of them, the guard chain, the seat loop, and the four
  emails sent after the write commits.
- **Admin** (`3407a51`) — status buttons, Upcoming and Past nav links, the today widget, the
  weekday preview and row labels.
- **Booking UI** (`41f6af9`) — `BookingForm`, `AvailabilityPicker`, `CancelView`, plus the
  two host pages in the test bench.
- **Release readiness** (`930306f`) — CI on both databases and two timezones, the packaged
  install check, README and changelog.

Branch `main`, clean. Version `0.1.0`, **not published**.

## Code touchpoints

`src/core` pure logic · `src/payload` collections, globals, hooks · `src/server` endpoints,
guards, emails · `src/admin` admin components · `src/react` booking UI · `dev` the test
bench and the reference host pages.

## Verification

129 unit tests under four timezones, 72 integration tests green on PostgreSQL and MongoDB
including a ten-way booking race. Typecheck, lint and build clean. A booking was made and
cancelled end to end in a real browser. The packed tarball installs into a fresh Payload
project with one copy of each peer dependency and all five entry points resolving.

See [CHANGELOG.md](../CHANGELOG.md) for what the release contains.
