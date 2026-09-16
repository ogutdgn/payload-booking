# Payload Booking Plugin — Build Specification

**For:** the agent building this plugin in its own repository.
**Author of this spec:** the Vera Kitchen Bath & Closets build, September 15, 2026.
**Status:** every decision below is made. Build to it. Where a choice is still genuinely open, it is listed in §21 with the default you must implement.

Read this whole document before writing code. It is self-contained: you do not need
the Vera repository or any earlier conversation.

---

## 0. What this is, in one paragraph

An appointment booking plugin for **Payload CMS 3.x**. A visitor picks a real time
slot on a public site, the appointment appears in the Payload dashboard, both sides
get email, either side can cancel, and **the same slot can never be sold twice** —
enforced by a database uniqueness constraint, not by application logic. Version 1
serves a single bookable resource (one showroom). The data model is designed so that
many resources (staff, rooms) and many appointment types can be switched on later
without a rewrite.

The first consumer is a real client site. It will `pnpm link` this package locally,
prove it, then install the published npm version.

---

## 1. Why this exists (so you make the right trade-offs)

We audited the existing options before deciding to build:

- `payload-appointments-plugin` (100 stars): the published npm release **does not
  import** (tarball ships `dist/`, `exports` points at `src/`); **no LICENSE file**;
  exact runtime pins on `@payloadcms/ui` that duplicate Payload's admin on newer
  versions; double-booking check is a read-then-write with no constraint;
  `appointments.create` is public with no field-level access; no business
  notification email; no exported booking UI. Its opening-hours model and DST
  handling are good — borrow those ideas.
- `payload-reserve`: MIT, alive, but a hardcoded 15-minute step and unverified
  double-booking safety.

**Our differentiators, in priority order:** (1) verified database uniqueness for
slots, (2) a release that installs cleanly, (3) `peerDependencies` not pins,
(4) a LICENSE file, (5) an exported booking component, (6) narrow scope done
properly. Every decision below serves that list.

---

## 2. Non-negotiables

1. **Never double-book.** A confirmed appointment for a slot is unique at the
   database level. Two visitors submitting the same slot in the same second → one
   201, one 409. This must be covered by an automated test that actually races.
2. **Cancel is a status change, never a delete.** Audit trail, slot release,
   emails and any future calendar sync all work from one code path.
3. **Everything in America/Chicago (or whatever the host configures) is computed
   server-side.** The browser never computes availability, never formats an
   instant, and never decides a timezone. It receives labels and echoes opaque
   ISO strings.
4. **No plugin literal is host-specific.** No hardcoded hours, timezone, capacity,
   email address, route path, or brand name anywhere in the package. All of it
   arrives through `bookingPlugin(options)` or the `booking-settings` global.
5. **Public writes go only through the plugin's guarded endpoints.** Payload's own
   REST `create` on `appointments` is closed (`access.create: () => false`).
6. **No prices, no payments, no deposits.** Not now, not as a "later" field.
7. **Works on Postgres and MongoDB** using only Payload field/index config.

---

## 3. Payload compatibility rules

These are what make it "compatible with Payload". All five are mandatory.

1. **Public APIs only.** `Config`, `CollectionConfig`, `GlobalConfig`, field
   configs, collection/global hooks, root `endpoints`, `admin.components`, the
   Local API (`payload.find/create/update/count/findGlobal/sendEmail`). Nothing
   imported from Payload internals.
2. **`peerDependencies`**, with ranges, never exact pins:
   ```json
   "peerDependencies": {
     "payload": "^3.37.0",
     "next": "^15.0.0 || ^16.0.0",
     "react": "^18.0.0 || ^19.0.0",
     "react-dom": "^18.0.0 || ^19.0.0"
   }
   ```
   `@payloadcms/ui` and `@payloadcms/next` are **peerDependencies too**, if the
   admin components need them. They are never in `dependencies`.
3. **Ship compiled output.** `dist/` in the tarball, `exports` pointing at `dist/`,
   `types` alongside. ESM (`"type": "module"`). A `prepublishOnly` script builds.
   Verify with `pnpm pack` + install into a fresh `create-payload-app -t blank`
   project before every release (§17).
4. **Database-agnostic.** No raw SQL, no migrations shipped by the plugin, no
   adapter assumptions. The uniqueness guarantee is a Payload `unique: true` text
   field (§8), which both adapters honour.
5. **Admin components referenced by package path.** Payload 3 resolves admin
   components through an import map from string paths such as
   `'<package>/client#BookingDashboardWidget'`. Export them from a `./client`
   entry, document that the host runs `payload generate:importmap`, and never
   import server code from a client entry.

Target: Payload **3.89.x** at time of writing. Test against the latest 3.x on
every release. Do not target the 4.0 canary.

---

## 4. Repository setup

- **Scaffold:** `pnpm create payload-app -t plugin` (Payload's official plugin
  template). It gives a package build plus a `dev/` Next app that mounts the
  plugin — that dev app is your test bench. Keep it.
- **Package name:** decide with the owner. Suggested: `@ogutdgn/payload-booking`
  (scoped, so the name is guaranteed) — the owner confirms.
- **License:** MIT. A real `LICENSE` file at the repo root, plus `"license": "MIT"`
  in `package.json`. This is not optional and it is the first commit.
- **Files:** `README.md` (install, config, routes to add, screenshots), `CHANGELOG.md`
  (keep-a-changelog format), `LICENSE`, `.github/workflows/ci.yml` (typecheck,
  lint, unit, integration on Postgres), `.npmignore` or `files` whitelist.
- **Layout:**
  ```
  src/
    index.ts                 # export { bookingPlugin } and public types
    client.ts                # admin components + booking UI (client entry)
    core/                    # PURE: no Payload imports, no I/O
      time.ts                # zoned time helpers
      schedule.ts            # weekly schedule → candidate starts
      slots.ts               # generateSlots()
      lockKey.ts             # slot lock key derivation
      token.ts               # HMAC magic-link tokens
    payload/
      collections/appointments.ts
      collections/resources.ts
      collections/blackoutDates.ts
      globals/bookingSettings.ts
      access.ts              # wraps host-supplied access functions
      hooks/                 # lockKey, title, blackout guard, emails
    server/
      availability.ts        # reads settings + bookings, calls core
      endpoints/             # availability, book, cancelByToken, cancelByBusiness
      rateLimit.ts
      email/                 # templates + view models + sender
    admin/                   # React: dashboard widget, cancel button, slot preview, SlotCell
    react/                   # React: BookingForm, AvailabilityPicker, CancelView (headless + default styles)
  dev/                       # template's test app, configured with realistic values
  tests/
    unit/                    # core/* with DST fixtures
    int/                     # race test, cancel, blackout guard, endpoints
  ```
- **Dependencies (runtime):** keep to a minimum. Date handling: `date-fns` v4 +
  `@date-fns/tz` (or `luxon` — pick one, use it everywhere, never `new Date(y,m,d)`
  for wall-clock maths). `zod` for request validation. Nothing else unless
  justified in the README.

---

## 5. Config surface — `bookingPlugin(options)`

```ts
import type { Access, Plugin } from 'payload'

export type BookingPluginOptions = {
  /** Disable without removing collections (keeps schema stable). Default false. */
  disabled?: boolean

  /** Collection/global slugs, all overridable. Defaults shown. */
  slugs?: {
    appointments?: string      // 'appointments'
    resources?: string         // 'booking-resources'
    blackoutDates?: string     // 'booking-blackout-dates'
    settings?: string          // 'booking-settings'
  }

  /** Where the plugin mounts its endpoints under Payload's API route. Default '/booking'. */
  apiBasePath?: string

  /**
   * Host-owned routes the plugin needs to link to (emails, redirects).
   * The plugin cannot own Next routes — the host adds thin pages (§18).
   */
  routes: {
    cancelPath: string         // e.g. '/appointments/cancel' → '/appointments/cancel/[token]'
    bookPath: string           // e.g. '/schedule'
  }

  /** Access control is supplied by the host; the plugin does not invent roles. */
  access: {
    manage: Access             // read/update/cancel appointments in admin (staff)
    configure: Access          // edit settings, resources, blackouts (owner)
  }

  /**
   * Seed values written to booking-settings when the global is empty.
   * The client edits everything afterwards in the dashboard.
   */
  defaults: BookingSettingsSeed  // see §6.1

  /** Secret for magic-link HMACs. Never reuse PAYLOAD_SECRET. */
  tokenSecret: string

  /** Email. The plugin sends through the host's configured Payload email adapter. */
  email: {
    from: string                          // "Vera <bookings@example.com>"
    replyTo?: string
    /** Optional overrides; each receives a view model (§10) and returns { subject, html, text }. */
    templates?: Partial<Record<EmailEvent, EmailTemplate>>
  }

  /** Optional anti-abuse hook, e.g. Cloudflare Turnstile. Return false to reject. */
  verifyChallenge?: (token: string | undefined, ip: string) => Promise<boolean>

  /** Rate limits for the public book endpoint. Defaults shown. */
  rateLimit?: { windowMinutes?: number /* 60 */; maxPerIp?: number /* 5 */; maxPerEmail?: number /* 3 */ }

  /** Extra fields the host wants on appointments (e.g. a 'purpose' select). Appended, never replacing. */
  customerFields?: Field[]

  /** Called after a booking or cancellation is committed. Host uses it for revalidation, analytics, later Google Calendar. */
  onAppointmentChange?: (args: { event: 'booked' | 'cancelled'; doc: Appointment; req: PayloadRequest }) => Promise<void> | void
}

export const bookingPlugin: (options: BookingPluginOptions) => Plugin
```

Rules:
- Registers collections and globals **even when `disabled: true`**, so the host's
  database schema does not change when the plugin is toggled.
- Appends to the host config; never replaces `collections`, `globals`, `endpoints`
  or `admin.components` arrays.
- `disabled` short-circuits endpoints and hooks only.

---

## 6. Data model

### 6.1 Global `booking-settings` — everything the owner edits

| Field | Type | Notes |
|---|---|---|
| `timezone` | select (IANA list) | required; seeded from `defaults` |
| `slotDurationMinutes` | number | required, default 60 |
| `capacityPerSlot` | number | required, default 1. Per resource. |
| `minNoticeMinutes` | number | default 120. 0 allows booking a slot that starts in a minute. |
| `bookingWindow` | group | `mode: 'rolling-days' \| 'calendar-weeks'` (default rolling), `rollingDays` (default 14), `calendarWeeks` (default 2 = this week + next) |
| `weeklySchedule` | group of 7 named groups `monday…sunday` | each: `open` checkbox, `sessionStarts` array of `{ time: 'HH:mm' }`. **Explicit start times, not open/close + step** — "skip 12:00" is a deleted row, not a rule. Validate `HH:mm`, unique, sorted on save. |
| `notificationEmails` | array of `{ email }` | who is told about bookings. min 1 |
| `cancellationCutoffMinutes` | number | default 0 = customer may cancel until the slot starts |
| `confirmationNote` | textarea | appended to the customer confirmation email |
| `admin.group` | | `'Bookings'`; label **"Booking Settings"** |

Named day groups, not an array: a day cannot be deleted, duplicated or reordered.
Every field gets `admin.description` in plain business English (§13).

`BookingSettingsSeed` = the same shape, used once when the global is empty.

### 6.2 Collection `booking-resources` — what gets booked

v1 has exactly one document, created from `defaults.resource`. Exists now so
multi-resource is additive later.

| Field | Type | Notes |
|---|---|---|
| `name` | text | required — "Showroom" |
| `slug` | text | unique, generated |
| `active` | checkbox | default true |
| `capacityPerSlot` | number | optional override of the global |
| `scheduleOverride` | same shape as `weeklySchedule` | optional; when present replaces the global schedule for this resource |

Access: read public (needed for availability), create/update/delete `configure`.
Hidden from the admin nav while only one resource exists? **No** — show it, labelled
"Bookable Locations", so the model is honest. `admin.group: 'Bookings'`.

### 6.3 Collection `booking-blackout-dates`

| Field | Type | Notes |
|---|---|---|
| `startDate` | text `YYYY-MM-DD` | required. Text, not `date`: a date-only value must never shift with a timezone. Validate format. |
| `endDate` | text `YYYY-MM-DD` | required, ≥ startDate |
| `reason` | text | optional, shown only in admin |
| `resource` | relationship | optional; empty = all resources |

Hook `beforeChange`: refuse to save if any **confirmed** appointment falls inside the
range — with a message naming the count and dates. Closing a day with bookings is a
decision the owner makes appointment by appointment, not by accident.
`admin.group: 'Bookings'`, label "Closed Dates". Access: `configure`.

### 6.4 Collection `appointments`

| Field | Type | Notes |
|---|---|---|
| `title` | text | maintained by `beforeChange`: `"{customer.name} — {local date} {local time}"`; `admin.useAsTitle` |
| `resource` | relationship → resources | required, indexed |
| `slotStart` | date | required, indexed. Stored as UTC instant. `admin.readOnly` after create. |
| `slotEnd` | date | derived: slotStart + duration |
| `slotLocalDate` `slotLocalTime` `slotTimezone` | text, readOnly | derived at write time so the list view and emails never re-compute |
| `seat` | number | 0-based, derived (§8); readOnly, hidden |
| `slotLockKey` | text | **`unique: true`**, `index: true`, `admin.hidden`. Derived (§8). |
| `status` | select | `confirmed \| cancelled \| completed \| no-show`; default `confirmed`; indexed |
| `customer` | group | `name` (req), `email` (req, index), `phone` (req), plus `options.customerFields` |
| `message` | textarea | optional |
| `cancelledAt` | date | |
| `cancelledBy` | select | `customer \| business` |
| `cancellationReason` | text | business-entered, optional |
| `internalNotes` | textarea | staff only |
| `emailLog` | array | `{ event, to, sentAt, providerId, error }` — readOnly |
| `source` | group readOnly | `page`, `referrer`, `utmSource/Medium/Campaign`, `ipHash`, `userAgent` |
| `googleEventId`, `googleCalendarSyncedAt` | text/date, hidden | reserved for later; unused in v1 |

Customer-entered fields carry field-level `access.update: () => false` — nobody
rewrites what a customer typed.

- `versions: true` (audit), no drafts. `trash: true` optional; deleting is admin-only anyway.
- `defaultSort: 'slotStart'`. `admin.defaultColumns: ['slotLocalDate','slotLocalTime','title','customer.phone','status']`.
- `admin.listSearchableFields: ['customer.name','customer.email','customer.phone']`.
- Access: `create: () => false` (endpoint writes with `overrideAccess`), `read/update: options.access.manage`, `delete: options.access.configure`.
- `admin.group: 'Bookings'`, label "Appointments".

`ACTIVE_STATUSES = ['confirmed']` is **one exported constant** used by the lock
key, availability and the blackout guard — never three separate lists. Test it.

---

## 7. Slot generation — the pure core

`core/slots.ts` exports:

```ts
export function generateSlots(input: {
  timezone: string
  schedule: WeeklySchedule           // resolved: resource override or global
  slotDurationMinutes: number
  capacityPerSlot: number
  minNoticeMinutes: number
  window: { mode: 'rolling-days'; rollingDays: number } | { mode: 'calendar-weeks'; calendarWeeks: number }
  blackouts: { startDate: string; endDate: string }[]
  bookedCounts: Record<string, number> // key = slotStart ISO (UTC), value = confirmed count
  now: Date                            // injected, never Date.now() inside core
}): Day[]

type Day = { date: string /* YYYY-MM-DD local */; label: string; slots: Slot[] }
type Slot = {
  start: string        // ISO UTC instant — the only thing the client sends back
  end: string
  label: string        // "10:00 AM", rendered server-side in the business zone
  remaining: number    // capacity minus booked
  available: boolean
}
```

Algorithm:
1. Compute the window in **local calendar days**: rolling → today … today+N-1;
   calendar-weeks → today … end of (this week + N-1) (weeks start Monday).
2. For each local day: skip if blackout covers it; skip if `schedule[weekday].open` is false.
3. For each `sessionStarts[].time`, build the instant with the zone library
   (`fromZonedTime`-style), **never** `new Date(y, m, d, h)` — on a UTC server that
   is wrong. `end = start + duration`.
4. Drop slots where `start < now + minNotice`.
5. `remaining = capacity - (bookedCounts[start] ?? 0)`; `available = remaining > 0`.
6. Return days in order; include days with zero slots so the UI can show "closed".

Zero I/O, zero Payload imports. `server/availability.ts` gathers inputs (settings,
resource, blackouts, one `payload.find` of confirmed appointments in the window
with `select: { slotStart, seat }`) and calls it.

**DST:** both US transitions are Sundays. Tests must include the week after the
March and November transitions: 10:00 Central is `15:00Z` in July and `16:00Z` in
January, and any code that adds 86 400 000 ms to get "tomorrow" is one hour wrong
for a week, twice a year. Fixture files, not ad-hoc dates.

---

## 8. Double-booking prevention — the whole correctness story

Uniqueness lives in the database, via stock Payload config:

- `slotLockKey` is a text field with `unique: true`.
- A **collection-level** `beforeChange` hook derives it:
  ```ts
  ({ data, originalDoc }) => {
    const merged = { ...originalDoc, ...data }
    if (!ACTIVE_STATUSES.includes(merged.status) || !merged.slotStart) {
      data.slotLockKey = null              // cancelled → NULL → slot freed
      return data
    }
    data.slotLockKey = `${resourceId(merged.resource)}#${new Date(merged.slotStart).toISOString()}#${merged.seat ?? 0}`
    return data
  }
  ```
  It **must** merge `originalDoc` under `data`: a partial `{ status }` update
  otherwise sees no `slotStart` and silently frees a booked slot.
- NULL is distinct in Postgres unique indexes; on Mongo confirm the adapter creates
  the unique index as sparse (test it). Cancelled rows therefore never collide.
- **Seats:** the book endpoint loops `seat` from 0 to `capacity - 1`, calling
  `payload.create` and catching the uniqueness `ValidationError` on `slotLockKey`
  to try the next seat. Exhausted → `409 { error: 'slot_taken' }`.
- **Membership re-check:** before creating, the endpoint regenerates availability
  server-side and asserts the submitted `start` is present by exact string match,
  and re-applies `minNotice` (a form left open for an hour can submit a slot that
  is now illegal).

**Required test (§16):** two `payload.create` calls for the same slot fired with
`Promise.all` against a real Postgres → exactly one succeeds. Run it in CI.

---

## 9. Endpoints

Mounted at `${apiBasePath}` under Payload's API (`/api/booking/...` by default).
All return JSON. All validate with zod. None are authenticated by Payload
automatically — guard them yourself.

| Method + path | Auth | Purpose |
|---|---|---|
| `GET  /availability?resource=<id>&from=<YYYY-MM-DD>` | public | Returns `Day[]` for the window. Response header `Cache-Control: no-store`. |
| `POST /book` | public + guards | Body: `{ resource, start, customer:{name,email,phone,...custom}, message?, formToken, challengeToken?, honeypot?, source? }`. Guards in order: honeypot (silently 200), signed time-trap token (min 3 s, max 6 h), zod, `verifyChallenge`, rate limit (counts recent rows by `ipHash` and by email), membership re-check, seat loop. Success `201 { id, reference, start, end, label, icsContent }`. Failures: `400` token/challenge, `422 { errors }`, `429`, `409 { error: 'slot_taken' }`. |
| `GET  /appointment-by-token?token=` | token | Returns the minimal view for the cancel page (name, local date/time, status). Never the email or phone. |
| `POST /cancel-by-token` | token | Idempotent. Gated on `status === 'confirmed'`; after `cancellationCutoff` or after start → `410 { error: 'too_late' }`. |
| `POST /appointments/:id/cancel` | `access.manage` via `req.user` | Business cancel. Body `{ reason? }`. |

`reference` = short human code (e.g. 6 chars base32) stored on the doc for phone
conversations. There is **no** public confirmation URL keyed by reference —
success is in-page state plus the email.

IP is hashed with `tokenSecret` (HMAC) before storage; the raw address is never
kept. `formToken` = `issuedAt.hmac(issuedAt)`; the host mints it when rendering
the form (plugin exports `issueFormToken()`).

---

## 10. Emails

Sent through the host's Payload email adapter (`payload.sendEmail`). The plugin
ships **no** provider. If the host has no adapter, log a warning once and skip.

| Event | To | Contains |
|---|---|---|
| `customer.confirmed` | customer | local date/time, address line (from a `location` text in settings), what to bring note, cancel magic link, `.ics` attachment |
| `business.booked` | `notificationEmails` | customer name/phone/email, slot, message, deep link `/admin/collections/<appointments>/<id>` |
| `business.cancelledByCustomer` | `notificationEmails` | who, which slot |
| `customer.cancelledByBusiness` | customer | which slot, reason if given, phone line to rebook, link to `routes.bookPath` |

- Templates receive a **plain view model** (`{ customerName, localDate, localTime, timezone, location, cancelUrl, bookUrl, reason, note }`), never the raw document. Overridable per event via `options.email.templates`.
- Always send `text` alongside `html`.
- **Send after the write commits**, never inside the transaction; wrap in try/catch, append to `emailLog` (with provider message id on success, error on failure). A failed email must not fail the booking.
- `.ics`: generated by the plugin (UID = appointment id, DTSTART/DTEND in UTC, SUMMARY, LOCATION). Attached when the adapter supports attachments; always also returned as `icsContent` from `/book`.

---

## 11. Magic-link cancellation

- Token: `base64url(JSON{ a: appointmentId, p: 'cancel', exp })` + `.` + HMAC-SHA256
  with `tokenSecret`. Verify with `timingSafeEqual` after a length check.
- `exp = slotStart + 24h`. Idempotent, not single-use: a second click renders
  "already cancelled".
- **Confirmation page on GET, mutation on POST.** Mail clients and link scanners
  prefetch GETs; a mutating GET cancels appointments nobody clicked.
- Five rendered states, each showing the business phone from settings: valid →
  confirm button; expired; bad signature; already cancelled; in the past.
- The host owns the page route (`routes.cancelPath/[token]`); the plugin exports
  `CancelView` (§14) and the endpoints. The email links to the host route.

---

## 12. Anti-abuse

Honeypot field (never stored) · signed time-trap token · optional
`verifyChallenge` (Turnstile etc.; if unset, skip; if set and the provider is
unreachable, **fail open** and log — a Cloudflare outage must not take booking
down while the other guards still apply) · rate limit by counting recent
`appointments` rows per `ipHash` and per email (survives serverless cold starts,
unlike an in-memory counter) · per-email cap on *active* appointments (default 3)
so one person cannot hold the whole week.

---

## 13. Admin experience

The owner is a non-technical business person. This is a deliverable, not polish.

- `admin.group: 'Bookings'` for all four; order: Appointments, Closed Dates, Booking Settings, Bookable Locations.
- **Appointments list:** columns per §6.4; a custom `Cell` on `slotStart` that
  renders in the *business* timezone — Payload renders dates in the admin user's
  browser zone by default, which is wrong the moment the owner travels.
- **Cancel button** on the appointment edit view: a `ui` field whose component
  POSTs `/appointments/:id/cancel` with `credentials: 'include'`, asks for an
  optional reason, and refreshes. Staff cancel; they do not delete.
- **Closed Dates:** the blackout guard's error message must read like a sentence
  ("3 confirmed appointments fall on 21–22 Oct. Cancel them first, or pick other dates.").
- **Booking Settings:** after each weekday group, a small read-only
  `ui` component previews the resulting slot labels ("09:00 · 10:00 · 11:00 …")
  so the owner sees what they just configured.
- **Dashboard widget** (`beforeDashboard`): "Today & Tomorrow" — a list of upcoming
  confirmed appointments with name, time, phone, and a link. More useful at 9 AM
  than a calendar.
- **No custom list view** in v1. `admin.components.views.list` replaces the whole
  list and costs filtering, pagination and bulk actions.
- Every field: `admin.description` in plain English. Write the sentences; do not
  leave placeholders.
- Document in the README: the host must run `payload generate:importmap` after
  install.

---

## 14. Frontend exports (`./react`)

The plugin cannot own Next routes; the host adds two thin pages and renders these:

- `<AvailabilityPicker resource apiBasePath onSelect />` — fetches
  `/availability`, renders a day strip + slot grid from **server-supplied labels**.
- `<BookingForm resource apiBasePath formToken fields onSuccess />` — the full
  flow: picker → form → submit → success state (with "add to calendar" from
  `icsContent`). **409 recovery is required:** re-fetch availability, grey out the
  slot that vanished, say so in plain English, scroll to the grid, and **keep every
  field the customer typed**.
- `<CancelView token apiBasePath />` — the five-state cancel page (GET view, POST
  on confirm).
- `issueFormToken(secret)` — server helper the host calls when rendering the page.

Headless by default (unstyled, semantic HTML, labels, error announcements,
keyboard-operable), with an optional `styles.css` the host can import. Host passes
class names via a `classNames` prop map. Fully accessible: focus management on
step changes, `aria-live` for errors, buttons not divs.

---

## 15. Multi-resource readiness (do not build the UI, do build the model)

- `resources` collection exists from day one; v1 seeds one.
- `slotLockKey` includes the resource id.
- Availability and booking take a `resource` parameter; the picker hides the
  choice when only one active resource exists.
- Appointment *types* (services with different durations) are **not** in v1. The
  duration comes from settings. Leave a documented seam: `slotDurationMinutes`
  resolves resource → global; a future `types` collection would sit in front of
  that. Do not add the collection now.

---

## 16. Tests

**Unit (`core/`)** — vitest, no database:
- Slot generation across the March and November DST weeks (fixtures).
- Rolling vs calendar-week windows, on a Friday and a Monday.
- Lead time, blackouts (single day, range, resource-scoped), capacity subtraction.
- Lock key derivation with partial updates (the `originalDoc` merge).
- Token sign/verify: valid, expired, tampered, wrong purpose.

**Integration** — vitest against a real Postgres (the template's dev app config):
- **Race:** `Promise.all` of two creates for the same slot → one success, one
  uniqueness error. This test is the reason the plugin exists.
- Cancel frees the slot: book → cancel → book again succeeds.
- Blackout guard refuses a range with confirmed bookings.
- Endpoints: each error path in §9 returns its documented status.
- Appointments `create` via Payload REST → 403.

**CI** runs all of it on push. Postgres via the workflow's service container.

---

## 17. Build & publish checklist

1. `pnpm build` → `dist/` with `.js` + `.d.ts`; `exports` map for `.`, `./client`, `./react`, `./styles.css`.
2. `pnpm pack`, then in a **fresh** `create-payload-app -t blank` project:
   `pnpm add ../<tarball>`, add `bookingPlugin({...})`, `payload generate:importmap`,
   `pnpm dev` → admin loads, endpoints answer. This catches the exact failure the
   incumbent shipped.
3. Confirm `node_modules` has **one** copy of `@payloadcms/ui` (peer, not nested).
4. Version: semver. `0.x` until the first client has run it in production; `1.0.0` after.
5. `npm publish --access public` (scoped). Tag the commit. Update `CHANGELOG.md`.
6. README sections: What it does · Install · Config (every option) · Host routes to
   add · Emails · Admin walkthrough with screenshots · Compatibility table ·
   Contributing · License.

---

## 18. How the first client site consumes it

Before publishing:
```bash
# in the plugin repo
pnpm build && pnpm link --global
# in the client repo
pnpm link --global @ogutdgn/payload-booking
```
Then in the client's `payload.config.ts`:
```ts
bookingPlugin({
  routes: { cancelPath: '/appointments/cancel', bookPath: '/schedule' },
  access: { manage: isEditor, configure: isAdmin },
  tokenSecret: process.env.BOOKING_TOKEN_SECRET!,
  email: { from: process.env.BOOKING_FROM_EMAIL!, replyTo: 'info@example.com' },
  defaults: {
    timezone: 'America/Chicago',
    slotDurationMinutes: 60,
    capacityPerSlot: 1,
    minNoticeMinutes: 120,
    bookingWindow: { mode: 'rolling-days', rollingDays: 14 },
    weeklySchedule: {
      monday:    { open: true,  sessionStarts: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'] },
      tuesday:   { open: true,  sessionStarts: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'] },
      wednesday: { open: true,  sessionStarts: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'] },
      thursday:  { open: true,  sessionStarts: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'] },
      friday:    { open: true,  sessionStarts: ['09:00','10:00','11:00','12:00','13:00','14:00','15:00'] },
      saturday:  { open: true,  sessionStarts: ['10:00','11:00','12:00','13:00','14:00','15:00'] },
      sunday:    { open: false, sessionStarts: [] },
    },
    notificationEmails: ['info@example.com'],
    resource: { name: 'Showroom' },
    location: '2112 Rutland Dr #150, Austin, TX 78758',
  },
  customerFields: [{ name: 'purpose', type: 'select', options: [/* host-defined */] }],
  onAppointmentChange: async ({ event }) => { /* host revalidation / analytics */ },
})
```
The host adds `app/(frontend)/schedule/page.tsx` (renders `BookingForm`) and
`app/(frontend)/appointments/cancel/[token]/page.tsx` (renders `CancelView`),
runs `payload generate:importmap`, and sets `BOOKING_TOKEN_SECRET`.

After publishing: replace the link with `pnpm add @ogutdgn/payload-booking@^0.1`.

---

## 19. Out of scope for v1 (documented, not built)

Reminder emails (needs a cron; v1.1) · full reschedule (v1 = cancel + a
prefilled "book a new time" link) · Google Calendar sync (one-way, Postgres
authoritative; `googleEventId` reserved) · appointment types with different
durations · payments (never) · SMS · waitlists · recurring appointments.

---

## 20. Acceptance criteria

The plugin is done when, in the template's dev app:

1. A visitor books a slot, sees the in-page confirmation, and both emails are
   produced (captured by a local SMTP sink such as Mailpit).
2. Two simultaneous bookings for one slot yield one 201 and one 409, and the 409
   path in `BookingForm` keeps the typed fields.
3. The customer's magic link cancels on POST only, shows all five states, and the
   business is emailed.
4. Staff cancel from the admin; the customer is emailed; the slot is bookable again.
5. Closing a date with bookings is refused with a readable message.
6. Editing session times in settings changes availability without a deploy.
7. The list view shows business-zone times regardless of the admin user's browser zone.
8. `pnpm pack` installs into a fresh blank template and runs (§17 step 2).
9. CI is green: unit + integration including the race test.
10. `LICENSE`, `README.md`, `CHANGELOG.md` exist and are accurate.

---

## 21. Decisions with chosen defaults (implement these; the host can override)

| Question | Decision |
|---|---|
| Booking window | `rolling-days`, 14. Calendar-weeks mode also built. |
| Minimum notice | 120 minutes |
| Cancellation cutoff | 0 (until slot start) |
| Reschedule | Not in v1; cancel page carries a "book a new time" link with name/email/phone prefilled via query string |
| Session times storage | Explicit `HH:mm` start list per weekday |
| After booking | In-page success + email with `.ics`; no public confirmation URL |
| Reminders | v1.1 |
| Package name | Owner decides; suggested `@ogutdgn/payload-booking` |
| Date library | `date-fns` v4 + `@date-fns/tz` (or luxon — one, consistently) |
