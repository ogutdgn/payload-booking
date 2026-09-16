# Execution map

Last updated: 2026-09-16

## Next

1. **Run the browser tests.** `npx playwright install chromium`, then `pnpm test:e2e`. The
   three specs in `dev/e2e` are written but have never run; the download stalled locally.
   The flows they cover were verified by hand.
2. **Publish 0.1.0.** `pnpm publish --access public` from the owner's npm account, then tag
   `v0.1.0` and move the changelog's Unreleased section under that version.
3. **Install into the Vera site.** `pnpm build && pnpm pack`, install the tarball there, add
   the two host pages, run `payload generate:importmap`, set `BOOKING_TOKEN_SECRET`.
4. **Screenshots for the README.** The admin walkthrough section is written but has no
   images.

## Blocked

- Publishing needs the owner's npm account (already logged in as `ogutdgn`).
- Turnstile keys, if the Vera site enables the challenge layer. Optional; the other three
  anti-abuse layers work without it.

## Future

Acceptance criteria not yet automated: the five cancel-page states and the business-zone
list rendering are covered by hand rather than by a test.

Post-v1, in rough order of usefulness: admin-side appointment creation, a calendar view of
appointments, reminder emails, several locations in the booking form, rescheduling in
place, partial-day closures, and Google Calendar sync with meeting links. The data model
already carries the seams for locations and appointment types.
