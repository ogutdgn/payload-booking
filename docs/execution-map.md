# Execution map

Last updated: 2026-09-16

## Next

1. **Install into the Vera site.** `pnpm add @ogutdgn/payload-booking`, add the two host
   pages, run `payload generate:importmap`, set `BOOKING_TOKEN_SECRET`, and configure an
   email adapter with a verified sending domain.
2. **Run the browser tests once.** `npx playwright install chromium`, then `pnpm test:e2e`.
   Three specs in `dev/e2e` have never executed; the download stalled locally.
3. **Screenshots for the README.** The admin walkthrough is written but has no images.
4. **Turnstile, when spam appears.** Host-side only: add the widget to the booking page and
   a `verifyChallenge` function. No plugin change needed.

## Blocked

- Nothing. Turnstile needs Cloudflare keys, but it is optional and the other three
  anti-abuse layers work without it.

## Future

Not automated, verified by hand: the five cancel-page states and the business-timezone list
rendering.

Post-v1, in rough order of usefulness: admin-side appointment creation, reminder emails,
several locations in the booking form, rescheduling in place, partial-day closures, and
Google Calendar sync with meeting links. The data model already carries the seams for
locations and appointment types.

Reach 1.0 once the Vera site has run this in production for a while without surprises.
