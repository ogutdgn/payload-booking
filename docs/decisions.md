# Decisions log

Decisions taken by the owner on the spec, with the reasoning. Newest last. The spec (`PLUGIN_BOOKING_SPEC.md`) is rewritten to match; this file explains why.

## 2026-09-16 — spec review round (D1–D15 from docs/spec-review.md)

| # | Decision | Reason |
|---|---|---|
| D1 | No admin-side appointment creation in v1. Every appointment enters through the public booking page; phone bookings are entered there by staff. Admin creation is a v1.1 item. | One booking path with all checks; ship narrow. Data model unchanged when added later. |
| D2 | `status` is never edited by hand. Shown read-only in the admin; three action buttons (Cancel, Mark completed, Mark no-show) call plugin endpoints. A server-side validator rejects any status change not flagged by a plugin endpoint. No approval step; bookings are auto-confirmed. | One code path for every status change; `admin.readOnly` is UI-only so the validator is the real guard. |
| D3 | Customer name, email, phone are locked after submission for all admin users, and shown read-only. Remedy for a typo is cancel + rebook. | Owner preference: the record shows exactly what the customer typed. |
| D4 | Only `cancelled` releases a slot; `completed` and `no-show` keep the lock key. | Follows from D2; avoids re-opening a live seat by mistake. |
| D5 | Payload `trash` is off. Delete stays a real delete, owner-only, rare. All history is kept forever; list sorted newest-first; sidebar shows "Upcoming" and "Past" links that open the Appointments list pre-filtered; the default unfiltered entry is hidden. | Trashed rows would hold slots invisibly. Filters give the history view without custom list UI. |
| D6 | Email log stays an array on the appointment. Sends run sequentially; the log is written in one update per operation. `versions.maxPerDoc` lowered. | Avoids lost entries and version churn without a fifth collection. |
| D7 | The booking form fetches its anti-bot token from `GET /booking/form-token` on load. `issueFormToken` stays for SSR hosts that opt out of static rendering. `verifyChallenge` hook supported (e.g. Cloudflare Turnstile), off by default; enabling it is a host-only change. | Static rendering would bake one token at deploy. |
| D8 | `slotStart` uses Payload's native date `timezone` option; the settings timezone select uses Payload's `defaultTimezones` list (host-extendable). Custom Cell and `slotTimezone` field dropped. | Native list + edit-page rendering in the business zone; no custom component. |
| D9 | No prefill on "book a new time" links, anywhere. Plain link to the booking page. | Simplest; removes the PII contradiction. |
| D10 | Session starts closer than `slotDurationMinutes` are rejected on save with a plain message; the same check runs when the duration changes. Existing appointments are never modified by settings changes. | Capacity is per start time; overlaps would double-staff the showroom. |
| D11 | Bookable locations collection is readable only by `configure`. Public `GET /booking/resources` returns `{ id, slug, name }` of active locations. v1 UI is single-location; multi-location UI is v1.1 (model already supports it). | Nothing public needs the collection; avoid exposing schedules/capacity. |
| D12 | Confirmation `.ics` is a proper iTIP invitation (ORGANIZER, ATTENDEE, SEQUENCE 0). Business cancel attaches a `METHOD:CANCEL` file. README notes automatic removal is best-effort. | Cheap now, awkward to add later. |
| D13 | Follow the template layout: unit specs beside modules in `src/`, integration specs in `dev/`. Dev app uses Postgres via `DATABASE_URL` by default with a switch to in-memory Mongo for adapter-parity tests. CI runs both. Integration files run serially. | Template already wires `@payload-config` for `dev/`; Postgres available locally. |
| D14 | Stored `slotLocalTime` is 24-hour `HH:mm`. Display goes through one formatter with `locale` and `hour12` options, default `en-US` 12-hour, used everywhere a time is shown. | Sortable storage, host-adjustable display. |
| D15 | Package name `@ogutdgn/payload-booking` (scope owned; name free on npm as of 2026-09-16). | Scoped is the conventional choice for an individual publishing several packages. |

### Parked (not decided, revisit later)

- Calendar-style admin page for appointments (v1.1 candidate; dashboard list is enough for now).
- Admin-side appointment creation (v1.1).
- Multi-location booking UI (v1.1; model ready).
- Online appointments with auto-created Google Meet links: needs appointment types plus Google Calendar integration; combined later item.
- Moving a single appointment to another time (reschedule): later; v1 is cancel + rebook.

## 2026-09-16 — second verification pass (v2.1)

The rewritten spec was re-verified: coverage of all 76 findings and the 15 decisions, plus three fresh lenses (consistency, Payload-API accuracy of the new text, buildability). 24 coverage gaps and 29 new findings were confirmed; 14 were refuted. All were applied. The ones that changed a design choice rather than adding detail:

| Change | Reason |
|---|---|
| Staff cancel and status endpoints are **two steps**: read with `overrideAccess: false` to evaluate the host's `manage` rule, then write with `overrideAccess: true` plus a context flag. | Payload evaluates field-level access whenever `overrideAccess` is false and silently drops denied keys. A one-step write would have stored `status: cancelled` while dropping `cancelledAt`, `cancelledBy` and `cancellationReason`, so the customer email's reason would be empty. |
| `maxActivePerEmail` counts **upcoming confirmed** rows only, not all slot-holding rows. | D4 widened the slot-holding set to include completed and no-show. Reusing that set for the cap would have permanently locked out any customer with three past visits. |
| Admin list filter links use the canonical per-field `and` encoding, built with `qs-esm`. | A flat two-key `where` renders as a single filter chip and silently drops the second constraint when the owner edits it. |
| Admin refresh uses `useRouteCache()` from `@payloadcms/ui`, not `useRouter().refresh()`. | Keeps `next/*` out of the package, so the peer list stays as specified. |
| Admin components are registered in object form with `clientProps` / `serverProps`. | String-registered nav and dashboard components receive only Payload's own props, so plugin options had no way to reach them. |
| `customer.email` gets its 254-character cap from a `validate`, not `maxLength`. | Payload's `email` field type has no `maxLength`; the literal would fail type-checking. |
| Calendar attachments carry a MIME `method` parameter matching the file. | RFC 6047 requires it; a cancellation labelled `method=REQUEST` reads as a new invitation. |
| Appointments list shows `slotStart` as its time column. | The native business-zone rendering only applies to that column; the stored text columns would have bypassed it. |
| `slotLocalDate`, `slotLocalTime` and `title` derive from the row's own stored zone, never the live settings global. | Otherwise a later timezone change would silently re-derive existing rows on the next update, breaking the immutable-snapshot rule. |
