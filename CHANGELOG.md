# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Booking**

- A slot can never be sold twice. Each slot-holding appointment carries a unique lock key
  that the database enforces, so two people submitting the same second get one
  confirmation and one "someone just took that time". Verified by a race test on
  PostgreSQL and MongoDB.
- Public endpoints under `/api/booking`: availability, locations, anti-bot token, book,
  appointment lookup by token, cancel by token, and two staff-only status endpoints.
- Anti-abuse in layers: a honeypot, a signed time-trap token fetched per page load,
  optional challenge support (Cloudflare Turnstile or similar), and caps per email and per
  IP counted from stored rows so they survive a cold start.

**Data**

- Four entities: appointments, bookable locations, closed dates, and a booking settings
  global covering timezone, appointment length, capacity, notice, cancellation cutoff,
  booking window, weekly opening times, address, phone and notification addresses.
- Times are computed server-side in the business timezone. Slot generation handles both
  daylight-saving transitions: a wall-clock time that does not exist is dropped rather
  than silently moved, and day arithmetic stays on the calendar.
- Overlapping start times, sessions crossing midnight and duplicate times are refused when
  the owner saves, with a message naming the offending pair.
- Closing a day that already has appointments is refused, naming how many and when.

**Admin**

- Status is a read-only badge with Cancel, Mark completed and Mark no-show buttons. Every
  status change goes through an endpoint, so the emails and the audit trail cannot be
  skipped. A change made any other way is refused with a readable message.
- "Today and tomorrow" on the dashboard, and Upcoming and Past links that open Payload's
  own list pre-filtered.
- Appointment times render in the business timezone everywhere, regardless of where the
  admin user is.

**Emails**

- Four events, sent after the write commits, through the host's own Payload email adapter.
- The confirmation carries a proper calendar invitation; a business cancellation carries a
  matching cancellation, so the event leaves the customer's calendar.
- Default templates escape everything and always send a plain-text alternative. Any event
  can be replaced per-host.

**Frontend**

- `BookingForm` and `CancelView`, exported from `./react`. Headless, accessible, with a
  class-name map and replaceable copy.
- A slot taken mid-form greys out and availability refreshes without losing a single field
  the visitor typed.

**Customisation**

- `useBookingFlow` and `useCancelFlow`: the behaviour behind a booking page and a
  cancellation page, with no markup. Write any layout you like on top and still get fresh
  availability, the anti-bot token with its retry, and recovery when a slot is taken
  mid-form without losing what the visitor typed. Built from three smaller hooks you can
  use separately.
- `overrides`: rename admin screens, add your own fields, change the list columns, swap a
  component. Merged on top of what the plugin built, with your hooks running after ours.
  An override that removes a guarantee, such as the unique lock key or the status guard,
  refuses to start rather than silently weakening it.

**Packaging**

- Five entry points, compiled output only, peer dependencies rather than bundled copies of
  Payload or React.
- CI runs typecheck, lint, unit tests under two timezones, integration tests on both
  databases, and a packaged-install check.

[Unreleased]: https://github.com/ogutdgn/payload-booking/commits/main
