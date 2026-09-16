# Payload Booking Plugin — Build Specification (v2.1)

**For:** the agent and the owner building this plugin in this repository.
**Origin:** v1 written by the Vera Kitchen Bath & Closets site build, 2026-09-15. v2 rewritten 2026-09-16 after a verified review (`docs/spec-review.md`) and fifteen owner decisions (`docs/decisions.md`). v2.1 applies a second verification pass over the rewrite (coverage of all findings and decisions, plus three fresh lenses). The v1 text is kept at `docs/spec-v1-original.md`.
**Status:** every decision below is made. Build to it. Where the review left a detail to verify during the build, it says so in place.

Read this whole document before writing code. It is self-contained.

Conventions: `§` refers to sections of this document. Review finding ids such as `F01` or `C06` refer to `docs/spec-review.md`; decision ids `D1`–`D15` refer to `docs/decisions.md`.

---

## 0. What this is, in one paragraph

An appointment booking plugin for **Payload CMS 3.x**. A visitor picks a real time slot on a public site, the appointment appears in the Payload dashboard, both sides get email, either side can cancel, and **the same slot can never be sold twice**, enforced by a database uniqueness constraint, not by application logic. Version 1 serves a single bookable location (one showroom). The data model is designed so that many locations and many appointment types can be switched on later without a rewrite.

The first consumer is a real client site. It will install the packed tarball locally (§18), prove it, then install the published npm version.

---

## 1. Why this exists (so you make the right trade-offs)

We audited the existing options before deciding to build:

- `payload-appointments-plugin`: the published npm release does not import (tarball ships `dist/`, `exports` points at `src/`); no LICENSE file; exact runtime pins on `@payloadcms/ui` that duplicate Payload's admin on newer versions; double-booking check is a read-then-write with no constraint; `appointments.create` is public with no field-level access; no business notification email; no exported booking UI. Its opening-hours model and DST handling are good; borrow those ideas.
- `payload-reserve`: MIT, alive, but a hardcoded 15-minute step and unverified double-booking safety.

**Our differentiators, in priority order:** (1) verified database uniqueness for slots on both adapters, (2) a release that installs cleanly, (3) `peerDependencies` not pins, (4) a LICENSE file, (5) an exported booking component, (6) narrow scope done properly. Every decision below serves that list.

---

## 2. Non-negotiables

1. **Never double-book.** A slot-holding appointment is unique at the database level. Two visitors submitting the same slot in the same second → one 201, one 409. Covered by an automated race test on **both** Postgres and MongoDB, in CI.
2. **Status changes go through one code path.** Cancel, complete, and no-show are status changes made only by plugin endpoints. Nobody edits `status` by hand, and nothing is ever deleted as a way of cancelling. (D2, D4)
3. **All time is computed server-side in the business timezone.** The browser never computes availability, never formats an instant, and never decides a timezone. It receives labels and echoes opaque ISO strings.
4. **No plugin literal is host-specific.** No hardcoded hours, timezone, capacity, email address, site URL, route path, or brand name anywhere in the package. All of it arrives through `bookingPlugin(options)` or the `booking-settings` global.
5. **Public writes go only through the plugin's guarded endpoints.** Payload's own REST `create` on `appointments` is closed for everyone (`access.create: () => false`), including staff in v1 (D1).
6. **No prices, no payments, no deposits.** Not now, not as a "later" field.
7. **Works on Postgres and MongoDB** using only Payload field and index config, and is tested on both.

---

## 3. Payload compatibility rules

1. **Public APIs only.** `Config`, `CollectionConfig`, `GlobalConfig`, field configs, collection and global hooks, root `endpoints`, `admin.components`, the Local API (`payload.find/create/update/count/findGlobal/updateGlobal/sendEmail`), and the request helpers exported from `payload` (`createPayloadRequest`, `addDataAndFileToRequest`, `handleEndpoints`) and `payload/shared` (`formatAdminURL`, `defaultTimezones`). Nothing imported from Payload internals.
2. **`peerDependencies`, with ranges, never exact pins** (F04):
   ```json
   "peerDependencies": {
     "payload": "^3.84.1",
     "@payloadcms/ui": "^3.84.1",
     "react": "^19.0.0",
     "react-dom": "^19.0.0"
   }
   ```
   Rule: the floor is the lowest Payload version CI actually runs; bump it whenever a newer Payload feature is used. `@payloadcms/ui` keeps the same range as `payload` because it pins `payload` exactly. **No `next` peer, and no plugin file imports `next/*`**: prefer `@payloadcms/ui` wrappers (e.g. `useRouteCache()` instead of `useRouter().refresh()`, §13). If a `next` import ever becomes unavoidable, copy `@payloadcms/ui`'s range verbatim and mark it optional; never invent one. React 18 is not supported: `@payloadcms/ui` has only ever accepted React 19. `@payloadcms/ui` and `@payloadcms/next` are never in `dependencies`.
3. **Ship compiled output.** ESM (`"type": "module"`). The template's mechanism (F27): top-level `exports` point at `./src/*.ts` for the dev app; `publishConfig.exports` point at `./dist/*.js` and are applied by **`pnpm pack` / `pnpm publish`** (npm's own commands do not apply `publishConfig.exports`). `files: ["dist"]`; LICENSE, README and package.json are auto-included. `prepublishOnly: pnpm clean && pnpm build`.
4. **Database-agnostic.** No raw SQL, no migrations shipped by the plugin, no adapter assumptions. The uniqueness guarantee is a Payload `unique: true` text field (§8), which both adapters honour. Note for MongoDB: Payload creates the index as sparse **and** sparse indexes still index explicit `null`, so the key is never written as null (§8).
5. **Admin components referenced by package path.** Payload resolves admin components through an import map from a path such as `'@ogutdgn/payload-booking/rsc#TodayWidget'`, given either as a bare string or in object form `{ path, clientProps }` / `{ path, serverProps }`. The plugin uses the **object form** wherever a component needs plugin options, because a string-registered `afterNavLinks` client component receives only `{ documentSubViewType, viewType }` and a `beforeDashboard` server component only `{ i18n, locale, params, payload, permissions, searchParams, user }`. `generate:importmap` parses the object form's `path` exactly like a string, so the map is unchanged. Export client components from `./client`, server components from `./rsc` (F08), document that the host runs `payload generate:importmap`, and never import server code from a client entry.

Target: Payload **3.84.1** floor (what the template installs today), tested against the latest 3.x on every release (3.89.0 at time of writing). Do not target the 4.0 canary.

---

## 4. Repository setup

### 4.1 Scaffold and first fixes

- **Scaffold:** `pnpm create payload-app -t plugin --use-pnpm -a claude` (Payload's official plugin template; `-a claude` installs Payload's reference skill under `.claude/skills/payload`, already present in this repo). It gives a package build plus a `dev/` Next app that mounts the plugin. That dev app is the test bench. Keep it.
- **pnpm 12 fixes, first commit after scaffolding** (F05): replace the placeholder `pnpm-workspace.yaml` with `allowBuilds: { '@swc/core': true, esbuild: true, mongodb-memory-server: true, sharp: true, unrs-resolver: true, workerd: true }`; delete the `pnpm` block from `package.json`; set `"packageManager": "pnpm@12.3.4"` and `"engines": { "node": ">=20.9.0", "pnpm": ">=10" }`; pin the same pnpm major in CI.
- **Package name:** `@ogutdgn/payload-booking` (D15). Rename checklist (F28): `package.json` name, `exports` **and** `publishConfig.exports`; `dev/tsconfig.json` `paths` for every entry; `dev/payload.config.ts` import; one exported `PACKAGE_NAME` constant in `src/` used to build every admin component path string; then `pnpm generate:importmap` and verify the regenerated `dev/app/(payload)/admin/importMap.js`.
- **ESM rule:** relative imports inside `src/` end in `.js` (NodeNext; tsc TS2835 otherwise). The dev Next app maps `.js` → `.ts` through `extensionAlias` in `dev/next.config.mjs`.
- **License:** MIT. A real `LICENSE` file at the repo root, plus `"license": "MIT"` in `package.json`. First commit.
- **Files:** `README.md` (install, config, routes to add, screenshots), `CHANGELOG.md` (keep-a-changelog; repo-only, not in the tarball), `LICENSE`, `.github/workflows/ci.yml`, `docs/` (this spec's companions).

### 4.2 Layout

```
src/
  index.ts                 # bookingPlugin, public types, PACKAGE_NAME; server-only helpers: issueFormToken, toCustomerFieldDescriptors, getBookingApiUrl
  exports/
    client.ts              # admin client components ('use client'); imports @payloadcms/ui
    rsc.ts                 # admin server components (dashboard widget)
    react.ts               # booking UI for the host site ('use client'); never imports @payloadcms/ui
  core/                    # PURE: no Payload imports, no I/O, no clock
    time.ts                # TZDate helpers, toUtcIso, business-day helpers
    schedule.ts            # weekly schedule → candidate starts, overlap validation
    slots.ts               # generateSlots(), windowBounds()
    lockKey.ts             # slot lock key + tombstone derivation
    token.ts               # HMAC tokens (cancel link, form token), purpose-derived keys
    ics.ts                 # iCalendar REQUEST / CANCEL generation with RFC 5545 escaping; googleCalendarUrl builder
    format.ts              # label formatter (locale, hour12)
  payload/
    collections/appointments.ts
    collections/resources.ts
    collections/blackoutDates.ts
    globals/bookingSettings.ts
    access.ts              # wraps host-supplied access functions
    hooks/                 # lockKey, derived fields, reference, status guard, blackout guard, settings validation
    seed.ts                # onInit seeding
    timezones.ts           # SUPPORTED_TIMEZONES
  server/
    availability.ts        # reads settings + resource + blackouts + counts, calls core
    endpoints/             # availability, resources, formToken, book, appointmentByToken, cancelByToken, businessCancel, markStatus
    guards/                # honeypot, formToken, challenge, caps, clientIp
    email/                 # view models, default templates, sender, escaping
  admin/                   # React: TodayWidget (rsc), StatusActions, StatusLabel, WeekdayPreview, NavLinks (client)
  react/                   # React: AvailabilityPicker, BookingForm, CancelView, messages, styles.css
dev/                       # template's test app: Postgres by default, Mongo memory for parity, two host pages, int specs
```

Unit specs sit beside their modules (`src/core/slots.spec.ts`). Integration specs live in `dev/` (`dev/int/*.spec.ts`), where the template already wires `@payload-config` (D13, F06). No root `tests/` tree.

### 4.3 Dependencies (runtime)

`date-fns ^4.1.0` and `@date-fns/tz ^1.2.0` (both already installed by `@payloadcms/ui`, so no second copy), `zod`, `qs-esm` (Payload's own query-string library, used to build the admin list-filter URLs in §13). Nothing else unless justified in the README. Never `new Date(y, m, d)` for wall-clock maths; never `luxon`.

### 4.4 Dev app and databases (D13, F07, C11)

- `dev/payload.config.ts` selects the adapter from `DB_ADAPTER` (default `postgres`): `postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL } })`. `dev/.env.example`: `DATABASE_URL=postgres://<osuser>@localhost:5432/payload_booking_dev` plus `BOOKING_TOKEN_SECRET=<32+ random chars>` (db-postgres creates a missing database; schema push runs automatically outside production).
- Integration tests use a dedicated database (`payload_booking_test`) that always starts clean: `PAYLOAD_DROP_DATABASE=true` in the test env, so the dev-schema push never sees warnings (it opens an interactive prompt on destructive diffs, which hangs CI).
- `DB_ADAPTER=mongo` keeps the template's `mongooseAdapter` + `MongoMemoryReplSet` (count 1) for the adapter-parity suite (§16). The Mongo suite runs one throw-away create + delete in `beforeAll` before any assertion: a fresh replica set with versions enabled fails its first writes with transient "Unable to acquire IX lock" / "catalog changes" errors.
- Email: a capturing adapter for tests (pushes each `SendEmailOptions` into an array); the template's console adapter for `pnpm dev`. Optionally `@payloadcms/email-nodemailer` to Mailpit on `localhost:1025` for eyeballing HTML.
- Two host pages in the dev app, exactly as a real host adds them (§18): `dev/app/(frontend)/schedule/page.tsx` and `dev/app/(frontend)/appointments/cancel/[token]/page.tsx`.
- Realistic seed values from §18.

### 4.5 CI

`.github/workflows/ci.yml`: jobs `typecheck` (`tsc --noEmit -p dev/tsconfig.json`), `lint`, `unit`, `int-postgres` (service container `postgres:17`, `POSTGRES_HOST_AUTH_METHOD=trust`), `int-mongo` (mongodb-memory-server; cache `~/.cache/mongodb-binaries` via `MONGOMS_DOWNLOAD_DIR`), `e2e` (Playwright, the two flows in §16). `pnpm/action-setup` reads `packageManager`. Node 22.

---

## 5. Config surface — `bookingPlugin(options)`

```ts
import type { Access, Field, PayloadRequest, Plugin } from 'payload'

export type EmailEvent =
  | 'customer.confirmed'
  | 'business.booked'
  | 'business.cancelledByCustomer'
  | 'customer.cancelledByBusiness'

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

/** Stored / resolved schedule shape. BookingSettingsSeed uses string[] and the seeder maps it to rows. */
export type WeeklySchedule = Record<Weekday, { open: boolean; sessionStarts: { time: string }[] }>

export type EmailViewModelBase = {
  customerName: string; localDate: string; localTime: string; timezone: string
  location: string; phone: string; bookUrl: string
}
export type EmailViewModels = {
  'customer.confirmed': EmailViewModelBase & { cancelUrl: string; note?: string; icsContent: string }
  'business.booked': EmailViewModelBase & {
    customerEmail: string; customerPhone: string; message?: string
    customFields: Record<string, string>; adminUrl?: string
  }
  'business.cancelledByCustomer': EmailViewModelBase
  'customer.cancelledByBusiness': EmailViewModelBase & { reason?: string }
}
export type EmailViewModelFor<E extends EmailEvent> = EmailViewModels[E]

export type EmailTemplate<E extends EmailEvent = EmailEvent> = (
  vm: EmailViewModelFor<E>,
) => { subject: string; html: string; text: string } | Promise<{ subject: string; html: string; text: string }>

export type BookingSettingsSeed = {
  timezone: string                    // must be in SUPPORTED_TIMEZONES (§6.1)
  slotDurationMinutes: number         // 60
  capacityPerSlot: number             // 1
  minNoticeMinutes: number            // 120
  cancellationCutoffMinutes: number   // 0
  bookingWindow: { mode: 'rolling-days'; rollingDays: number } | { mode: 'calendar-weeks'; calendarWeeks: number }
  weeklySchedule: Record<Weekday, { open: boolean; sessionStarts: string[] /* 'HH:mm' */ }>
  notificationEmails: string[]        // min 1
  location: string                    // address line; emails + .ics LOCATION
  phone: string                       // business phone; cancel page + emails
  confirmationNote?: string
}

export type BookingPluginOptions = {
  /** Disable endpoints, hooks' side effects and seeding without removing collections. Default false. */
  disabled?: boolean

  /** Collection/global slugs, all overridable. Defaults shown. */
  slugs?: {
    appointments?: string      // 'appointments'
    resources?: string         // 'booking-resources'
    blackoutDates?: string     // 'booking-blackout-dates'
    settings?: string          // 'booking-settings'
  }

  /** Where the plugin mounts its endpoints under Payload's API route. Default '/booking'.
   *  Init throws if its first segment equals any collection slug (Payload would route to that collection instead). */
  apiBasePath?: string

  /** Public origin of the front-end site, protocol + host, e.g. 'https://example.com'. Used for cancel/book links in emails.
   *  Falls back to payload.config.serverURL; init throws if both are empty. */
  siteUrl?: string

  /** Host-owned routes the plugin links to. The plugin cannot own Next routes; the host adds thin pages (§18). */
  routes: {
    cancelPath: string         // '/appointments/cancel' → '/appointments/cancel/[token]'
    bookPath: string           // '/schedule'
  }

  /** Access control is supplied by the host; the plugin does not invent roles. */
  access: {
    manage: Access             // read appointments, run the status actions (staff)
    configure: Access          // settings, locations, closed dates, delete (owner)
  }

  /** Seed values written once when the settings global is empty; the owner edits everything afterwards. */
  defaults: {
    settings: BookingSettingsSeed
    resource: { name: string; slug?: string }   // 'Showroom' → slug 'showroom'
  }

  /** Secret for HMACs. ≥ 32 chars. Never reuse PAYLOAD_SECRET. Validated lazily at first use (C07). */
  tokenSecret: string

  /** Email. Sent through the host's Payload email adapter. */
  email: {
    from: string                          // "Vera <bookings@example.com>"
    replyTo?: string
    templates?: { [E in EmailEvent]?: EmailTemplate<E> }
  }

  /** Timezone list for settings and slotStart. Default: Payload's defaultTimezones from 'payload/shared'. */
  supportedTimezones?: (args: { defaultTimezones: { label: string; value: string }[] }) => { label: string; value: string }[]

  /** Label formatting for every rendered time and date. Default { locale: 'en-US', hour12: true }. (D14) */
  labels?: { locale?: string; hour12?: boolean }

  /** Optional anti-abuse challenge (e.g. Cloudflare Turnstile). See §12 for the contract. */
  verifyChallenge?: (token: string | undefined, ip: string | undefined) => Promise<boolean>
  challengeTimeoutMs?: number            // 5000

  /** Client IP resolution (§12). Default: undefined unless trustProxy is true.
   *  Set trustProxy true ONLY behind a proxy that overwrites X-Forwarded-For (Vercel, Cloudflare, most managed hosts).
   *  On bare Node/Docker without a reverse proxy the header is client-supplied: keep false, or supply getClientIp. */
  trustProxy?: boolean                   // false
  getClientIp?: (req: PayloadRequest) => string | undefined

  /** Booking caps for the public book endpoint (§12). Defaults shown. Not a request rate limit. */
  bookingCaps?: {
    windowMinutes?: number       // 60
    maxPerIpInWindow?: number    // 5   rows created per ipHash in window, any status
    maxPerEmailInWindow?: number // 3   rows created per email in window, any status
    maxActivePerEmail?: number   // 3   UPCOMING rows per email: status confirmed AND slotStart >= now
  }

  /** Name of the honeypot field the form renders and the endpoint reads. Default 'website'. */
  honeypotField?: string

  /** Extra customer fields (e.g. a 'purpose' select). Appended to customer, never replacing. See §14 for supported types. */
  customerFields?: Field[]

  /** Called after a booking or a status change is committed. Never for emailLog writes. */
  onAppointmentChange?: (args: {
    event: 'booked' | 'cancelled' | 'completed' | 'no-show'
    doc: Appointment
    req: PayloadRequest
  }) => Promise<void> | void
}

export const bookingPlugin: (options: BookingPluginOptions) => Plugin
```

`Appointment` is the generated collection type.

Other shared types exported from the root entry: `GenerateSlotsInput` (§7, the parameter object of `generateSlots`), and the helper `resourceId(r: string | number | { id: string | number }): string`, which exists because a relationship value is an id at depth 0 but may be a populated object when a host calls the Local API with `depth > 0`.

Rules:

- **Always registered, regardless of `disabled`**: collections, globals (with their field-level `ui` components), and root `admin.components` entries, so `payload generate:importmap` output is identical in every environment (C15). The dashboard widget and nav links read `disabled` and render nothing when it is true.
- **Short-circuited by `disabled`**: custom endpoints, hook side effects, emails, the `onAppointmentChange` callback, and the onInit seed.
- **Options reach admin components through the object form** (§3.5): `admin.components.afterNavLinks.push({ path: `${PACKAGE_NAME}/client#NavLinks`, clientProps: { disabled, appointmentsSlug } })`, `admin.components.beforeDashboard.push({ path: `${PACKAGE_NAME}/rsc#TodayWidget`, serverProps: { disabled, slugs, labels } })`, and each `ui` field's `admin.components.Field: { path, clientProps: { apiBasePath, … } }`. Components never guess slugs or paths.
- Appends to the host config; never replaces `collections`, `globals`, `endpoints` or `admin.components` arrays.
- **Seeding** (F29): the plugin wraps `config.onInit`, calling the host's incoming `onInit` first. Then, in order: (1) the resource: `count` by slug, create if 0, and treat a `ValidationError` with `errors[0].path === 'slug'` as "already seeded" (safe under multi-instance boot); (2) the settings global only if `findGlobal` returns a doc with falsy `timezone` (an unsaved global returns `{}`, not null), written with `updateGlobal`, which creates the row when absent. Seeding is idempotent and never overwrites an edited global. The seed maps `sessionStarts: string[]` to `{ time }` rows and `notificationEmails: string[]` to `{ email }` rows.
- `tokenSecret` is validated at first token use through a single `getSecret()` helper (≥ 32 chars, else a plugin-prefixed error naming `BOOKING_TOKEN_SECRET`); `bookingPlugin()` itself only warns, so `generate:importmap`, `generate:types` and `migrate` keep working without runtime secrets.
- `defaults.settings.timezone` is validated against the timezone list at init with a readable error.

---

## 6. Data model

All four entities: `admin.group: 'Bookings'`. Every field carries `admin.description` in plain business English (§13). Field names are fixed; only slugs are overridable.

### 6.1 Global `booking-settings` — everything the owner edits

Label **"Booking Settings"**. Access: `read: options.access.manage`, `update: options.access.configure` (F30). The plugin reads it through the Local API, so no public read is needed.

| Field | Type | Notes |
|---|---|---|
| `timezone` | select | required; options = `SUPPORTED_TIMEZONES` (below); seeded from defaults |
| `slotDurationMinutes` | number | required, default 60 |
| `capacityPerSlot` | number | required, default 1. Per location. |
| `minNoticeMinutes` | number | default 120. 0 allows booking a slot that starts in a minute. |
| `bookingWindow` | group | `mode: 'rolling-days' \| 'calendar-weeks'` (default rolling), `rollingDays` (default 14), `calendarWeeks` (default 2 = this week + next) |
| `weeklySchedule` | group of 7 named groups `monday…sunday` | each: `open` checkbox, `sessionStarts` array of `{ time: 'HH:mm' }`. Explicit start times, not open/close + step: "skip 12:00" is a deleted row. |
| `notificationEmails` | array of `{ email }` | who is told about bookings. `minRows: 1` |
| `cancellationCutoffMinutes` | number | default 0 = customer may cancel until the slot starts |
| `location` | text, required | address line shown in customer emails and as `.ics` LOCATION (F09) |
| `phone` | text, required | business phone shown on every cancel-page state and in the business-cancel email (F09, F54) |
| `confirmationNote` | textarea | appended to the customer confirmation email |

Named day groups, not an array: a day cannot be deleted, duplicated or reordered.

**Timezone list** (C02, D8): `SUPPORTED_TIMEZONES` = `defaultTimezones` exported from `payload/shared`, optionally extended through `options.supportedTimezones`. The same array is passed to `slotStart.timezone.supportedTimezones` (§6.4). Never derive select options from `Intl.supportedValuesOf` (the Postgres enum would change with the Node version).

**Validation on save** (`beforeValidate` on the global; same code reused for `scheduleOverride` in §6.2):

- each `time` matches `^([01]\d|2[0-3]):[0-5]\d$`, unique within the day, and the array is sorted on save;
- **no two starts in one day closer than `slotDurationMinutes`** (D10, F31): message "10:00 and 10:30 overlap: slots are 60 minutes long";
- a session whose end would pass local midnight is rejected ("23:30 + 60 minutes crosses midnight").

The rule itself is a pure `validateDaySchedule(schedule, slotDurationMinutes)` in `core/schedule.ts`, called from three places: this hook, the `booking-resources` hook (which fetches the duration with `req.payload.findGlobal({ slug: settingsSlug, depth: 0, req })` when `useScheduleOverride` is true), and the §13 preview.

**When `slotDurationMinutes` changes**, this hook also re-validates every override: `req.payload.find({ collection: resourcesSlug, where: { useScheduleOverride: { equals: true } }, pagination: false, depth: 0, req })`, running `validateDaySchedule` on each `scheduleOverride` with the new duration and throwing a `ValidationError` on `slotDurationMinutes` naming the first offender ("Showroom: 10:00 and 10:30 overlap: slots are 60 minutes long"). Without this, raising the duration would leave an override selling overlapping starts, which is exactly what D10 prevents.

**Effect of changes on existing appointments** (F32): none. Existing appointments are immutable snapshots. A duration, timezone, capacity or schedule change affects new bookings only; removed session times only stop being offered.

**Postgres identifier length** (C03): every array under a weekday group gets a short `dbName` (e.g. `bs_mon_starts` … `bs_sun_starts`; `br_mon_starts` … for the resource override) so the derived index names stay under 63 characters. A unit test asserts this for every array in the plugin's field tree, including overridden slugs.

### 6.2 Collection `booking-resources` — what gets booked

Label **"Bookable Locations"**. v1 has exactly one document, created from `defaults.resource`. Exists now so multi-location is additive later (§15). Shown in the admin so the model is honest.

| Field | Type | Notes |
|---|---|---|
| `name` | text | required — "Showroom" |
| `slug` | text | `unique`, `index`; generated in `beforeValidate` as slugified `name` when empty; seeded from `defaults.resource.slug ?? slugify(name)` so the host can reference `'showroom'` deterministically (F26) |
| `active` | checkbox | default true |
| `capacityPerSlot` | number | optional override of the global |
| `useScheduleOverride` | checkbox | default false (F33) |
| `scheduleOverride` | same shape as `weeklySchedule` | `admin.condition: (data) => data?.useScheduleOverride`; used only when `useScheduleOverride === true`, otherwise the global schedule applies |

Access: `read: options.access.configure`, `create/update/delete: options.access.configure` (D11). Nothing public reads this collection: availability uses the Local API, and the booking form uses `GET /booking/resources` (§9).

Duration is **not** per resource in v1; it comes from settings only (F53).

### 6.3 Collection `booking-blackout-dates`

Label **"Closed Dates"**. Access: `configure` for everything. Whole local days only; partial-day closures are out of scope (§19).

| Field | Type | Notes |
|---|---|---|
| `startDate` | text `YYYY-MM-DD` | required. Text, not `date`: a date-only value must never shift with a timezone. Validate format with zero padding. |
| `endDate` | text `YYYY-MM-DD` | required, ≥ startDate |
| `reason` | text | optional, shown only in admin |
| `resource` | relationship | optional; empty = all locations |

**Guard** (`beforeChange`, F34): refuse to save if any slot-holding appointment falls inside the range. Query with `payload.count` and `req` passed:

```ts
where: {
  slotLocalDate: { greater_than_equal: startDate, less_than_equal: endDate },
  status: { in: SLOT_HOLDING_STATUSES },
  ...(resource ? { resource: { equals: resourceId } } : {}),
}
```

Text comparison on `YYYY-MM-DD` is correct on both adapters, and both accept several operators on one key. Read values from `{ ...originalDoc, ...data }` (`originalDoc.resource` is an id at depth 0). Message reads like a sentence: "3 appointments fall on 21–22 Oct. Cancel them first, or pick other dates." The guard is advisory against concurrent bookings: a booking committed between its read and this save is kept, and the day simply disappears from availability. The unique lock key, not this guard, is the correctness boundary. Do not add locking here.

### 6.4 Collection `appointments`

Label **"Appointments"**. `admin.useAsTitle: 'title'`. `defaultSort: '-slotStart'` (C13). `admin.defaultColumns: ['slotStart', 'title', 'customer.phone', 'status', 'reference']` — `slotStart` is the shown time column so Payload's native companion-zone cell renders it in the business zone (D8); `slotLocalDate`/`slotLocalTime` remain available as optional columns and for search and sort. `admin.listSearchableFields: ['customer.name', 'customer.email', 'customer.phone', 'reference']`; the search placeholder falls back to the `useAsTitle` field's label, so give `title` the label "Customer" and it reads "Search by Customer". Never set `admin.enableListViewSelectAPI` on this collection: it strips the timezone companion from the list row data and the date cell falls back to the browser zone. `versions: { drafts: false, maxPerDoc: 20 }`. **No `trash`** (D5, F12). `admin.group: false` (hidden from the sidebar; reached through the two nav links in §13; routes stay enabled).

Access: `create: () => false` (endpoint writes with the Local API's default `overrideAccess: true`), `read/update: options.access.manage`, `delete: options.access.configure`.

| Field | Type | Notes |
|---|---|---|
| `title` | text | maintained by `beforeChange`: `"{customer.name} — {local date} {local time}"` |
| `reference` | text | `unique`, `index`, `admin.readOnly`; 8-char Crockford base32 from `crypto.randomBytes`, generated in the collection `beforeChange` on create (F10). Human code for phone conversations. |
| `resource` | relationship → resources | required, indexed |
| `slotStart` | date | required, indexed. Stored as a UTC instant. `timezone: { required: true, supportedTimezones: SUPPORTED_TIMEZONES, override: ({ baseField }) => ({ ...baseField, access: { update: () => false } }) }` (D8, F38): Payload adds the hidden companion `slotStart_tz`, written once on create and locked like every other derived field, so the list and the edit page render in the business zone natively. See **Writers** below. |
| `slotEnd` | date | derived: slotStart + duration at booking time |
| `slotLocalDate` | text `YYYY-MM-DD` | derived in the business zone at write time; used by the blackout guard, emails, search |
| `slotLocalTime` | text `HH:mm` (24h) | derived; 24-hour so the list column sorts (D14) |
| `seat` | number | 0-based; **set by the book endpoint's seat loop** (§8); the `beforeChange` hook normalises it to `merged.seat ?? 0` before deriving the key (F37). readOnly, hidden. |
| `slotLockKey` | text | **`unique: true`**, `index: true`, `admin.hidden`, `required: false`. Derived (§8). Never null. |
| `status` | select | `confirmed \| cancelled \| completed \| no-show`; default `confirmed`; indexed; **read-only in the admin** (`admin.components.Field` renders a label) and guarded server-side (below) |
| `customer` | group | `name` (text, req, maxLength 120), `email` (type `email`, req, index; the `email` field type has **no** `maxLength` option, so the 254-character cap comes from a `validate` that first delegates to Payload's exported `email` validator and then checks length; lower-cased and trimmed in a field `beforeChange` (C05)), `phone` (text, req, maxLength 40), plus `options.customerFields` |
| `message` | textarea | optional, maxLength 2000 |
| `cancelledAt` | date | |
| `cancelledBy` | select | `customer \| business` |
| `cancellationReason` | text | business-entered, optional, maxLength 500 |
| `internalNotes` | textarea | staff only; the one free-text field staff edit |
| `emailLog` | array, readOnly | `{ event, to, sentAt, providerId?, error? }` (§10) |
| `source` | group, readOnly | `page`, `referrer`, `utmSource/Medium/Campaign` (from the body, max 2048/2048/200), `ipHash` (`index: true`, server-computed), `userAgent` (from the header, max 512) |
| `googleEventId`, `googleCalendarSyncedAt` | text / date, hidden | reserved; unused in v1 |
| `statusActions` | ui | the action buttons (§13); `admin.condition: (_, __, { operation }) => operation === 'update'`, `admin.disableListColumn: true` |

**Field-level access** (F14, D3): `access.update: () => false` on `resource`, `slotStart`, `slotStart_tz`, `slotEnd`, `slotLocalDate`, `slotLocalTime`, `seat`, `slotLockKey`, `reference`, `emailLog`, `source`, `cancelledAt`, `cancelledBy`, `cancellationReason`, and on `customer.name/email/phone` (customer fields from `options.customerFields` keep whatever the host set). Field-level denial is silent: Payload drops the incoming value and keeps the stored one, with no error. Therefore every such field is also `admin.readOnly: true` so the owner is not shown an editable box. The remedy for a customer typo is cancel + rebook, stated in the README.

**Field access is evaluated whenever `overrideAccess` is false**, in the field `beforeValidate` pass, before any collection hook. Plugin endpoints therefore never write locked fields in the same call that evaluates the host's access rule: they check permission with a read (`payload.findByID({ id, user: req.user, overrideAccess: false })`) and then write with `overrideAccess: true` plus a context flag (§9). Collection hooks recompute derived fields regardless.

**Writers.** The book endpoint's `payload.create` data carries `resource`, `slotStart` and `slotEnd` (the matched slot's server-generated `start`/`end`, §8), `slotStart_tz = settings.timezone` (a snapshot, never rewritten), and `seat`. The collection `beforeChange` derives `slotLocalDate`, `slotLocalTime` and `title` from `merged.slotStart` in `merged.slotStart_tz` through `core/format.ts`, generates `reference` on create, and finally derives `slotLockKey` (§8). The hook never reads the settings global, so a later timezone change cannot re-derive an existing row on a status or emailLog update (the immutable-snapshot rule in §6.1).

**Status guard** (D2, F03): `status` carries `validate(value, { previousValue, operation, req })` that rejects any change on update unless `req.context.bookingStatusChange === true`, with the message "Use the action buttons so the customer is notified." The plugin's status endpoints set that context flag on their Local API call (`context` is copied onto `req.context`). `admin.readOnly` alone is a display hint and would not stop a REST PATCH.

**Slot-holding statuses** (D4, F36): `SLOT_HOLDING_STATUSES = ['confirmed', 'completed', 'no-show']` is **one exported constant** used by the lock key, availability, the caps and the blackout guard; never separate lists. Only `cancelled` releases a slot.

---

## 7. Slot generation — the pure core

`core/slots.ts` exports:

```ts
export type GenerateSlotsInput = {
  timezone: string
  schedule: WeeklySchedule           // resolved: resource override or global
  slotDurationMinutes: number
  capacityPerSlot: number
  minNoticeMinutes: number
  window: { mode: 'rolling-days'; rollingDays: number } | { mode: 'calendar-weeks'; calendarWeeks: number }
  blackouts: { startDate: string; endDate: string }[]
  bookedCounts: Record<string, number> // key = toUtcIso(slotStart), value = slot-holding count
  labels: { locale: string; hour12: boolean }
  now: Date                            // injected, never Date.now() inside core
}

export function generateSlots(input: GenerateSlotsInput): Day[]

export function windowBounds(input: Pick<GenerateSlotsInput, 'timezone' | 'window' | 'now'>): {
  firstDay: string; lastDay: string          // YYYY-MM-DD local
  fromInstant: string; toInstantExclusive: string  // UTC ISO, for the DB query
}

type Day = { date: string /* YYYY-MM-DD local */; label: string; slots: Slot[] }
type Slot = {
  start: string        // UTC ISO 'YYYY-MM-DDTHH:mm:ss.sssZ' — the only thing the client sends back
  end: string
  label: string        // "10:00 AM", rendered server-side in the business zone via core/format.ts
  remaining: number    // capacity minus booked
  available: boolean
}
```

Algorithm:

1. `today = format(now, 'yyyy-MM-dd', { in: tz(timezone) })`: the business-zone calendar date of the injected `now` (F39). Window in local days: rolling → today … today+N-1; calendar-weeks → today … end of (this week + N-1), weeks start Monday, computed with `startOfWeek/endOfWeek(..., { weekStartsOn: 1, in: tz(timezone) })` and iterated with `eachDayOfInterval(..., { in: tz(timezone) })`.
2. For each local day: skip if a blackout covers it; skip if `schedule[weekday].open` is false.
3. For each `sessionStarts[].time`, build the instant with `new TZDate(y, m - 1, d, hh, mm, 0, timezone)` (numeric parts; **never** an offset-less ISO string, which parses in the process zone, and never `new Date(y, m, d, h)`) (F40). `end = addMinutes(start, duration)`. A slot belongs to the local day of its start (F31).
4. **DST rules** (F41): if `format(start, 'HH:mm') !== session.time` the wall time did not exist (spring-forward gap) → drop the slot. Ambiguous fall-back times take TZDate's first occurrence. Both transition days are in the fixtures.
5. Drop slots where `start < now + minNotice` (pure millisecond arithmetic).
6. `remaining = capacity - (bookedCounts[toUtcIso(start)] ?? 0)`; `available = remaining > 0`.
7. Return days in order; include days with zero slots so the UI can show "closed".

**`windowBounds` derivation:** `fromInstant = toUtcIso(new TZDate(y, m - 1, d, 0, 0, 0, timezone))` for `firstDay`, and `toInstantExclusive = toUtcIso(addDays(new TZDate(… lastDay …, 0, 0, 0, timezone), 1))`. Because sessions never cross local midnight (§6.1) and a slot belongs to its start's local day (step 3), every slot-holding row whose `slotLocalDate` lies in `[firstDay, lastDay]` has `slotStart` in `[fromInstant, toInstantExclusive)`. That is why the availability range query and the blackout guard's `slotLocalDate` query see the same rows.

**ISO normalisation** (F15): `core/time.ts` exports `toUtcIso(d: Date | string | number): string => new Date(d instanceof Date ? d.getTime() : d).toISOString()`. Every `Slot.start/end`, every `bookedCounts` key, the lock key and the membership re-check use it. `TZDate#toISOString()` returns the offset form and must never reach a response or a key; core returns plain strings, never Date/TZDate objects.

**Labels** (F57, D14): `core/format.ts` renders `Slot.label`, `Day.label`, `title`, and the email view model's `localDate/localTime` with `Intl.DateTimeFormat(locale, { timeZone, ... , hour12 })`. One formatter, used everywhere.

Zero I/O, zero Payload imports. `server/availability.ts` gathers inputs: settings, the resource (override schedule if `useScheduleOverride`), the blackouts for the window with `payload.find({ collection: blackoutDates, pagination: false, depth: 0, select: { startDate: true, endDate: true }, where: { startDate: { less_than_equal: lastDay }, endDate: { greater_than_equal: firstDay }, or: [{ resource: { exists: false } }, { resource: { equals: resourceId } }] } })` (resource scoping happens here, never in core), and one `payload.find` of slot-holding appointments with `{ pagination: false, depth: 0, select: { slotStart: true }, where: { resource: { equals }, status: { in: SLOT_HOLDING_STATUSES }, slotStart: { greater_than_equal: fromInstant, less_than: toInstantExclusive } } }` (C01: the default `limit` is 10), then calls `generateSlots`.

**DST fixtures:** both US transitions are Sundays (2026: March 8 and November 1). 10:00 Central is `15:00Z` in July and `16:00Z` in January. Any code that adds 86 400 000 ms to get "tomorrow" is one hour wrong for a week, twice a year. Fixture files, not ad-hoc dates; the unit suite runs under both `TZ=UTC` and `TZ=America/Chicago`.

---

## 8. Double-booking prevention — the whole correctness story

Uniqueness lives in the database, via stock Payload config:

- `slotLockKey` is a text field with `unique: true`, `required: false`.
- A **collection-level** `beforeChange` hook derives it:

  ```ts
  ({ data, operation, originalDoc }) => {
    const merged = { ...originalDoc, ...data }              // originalDoc is {} on create
    data.seat = merged.seat ?? 0
    if (operation === 'create') data.reference = generateReference()
    if (merged.slotStart && merged.slotStart_tz) {
      data.slotLocalDate = formatLocalDate(merged.slotStart, merged.slotStart_tz)   // 'YYYY-MM-DD'
      data.slotLocalTime = formatLocalTime24(merged.slotStart, merged.slotStart_tz) // 'HH:mm'
      data.title = `${merged.customer?.name} — ${label(merged.slotStart, merged.slotStart_tz)}`
    }
    if (!SLOT_HOLDING_STATUSES.includes(merged.status) || !merged.slotStart) {
      data.slotLockKey = `released#${originalDoc?.id ?? crypto.randomUUID()}`   // tombstone, never null
      return data
    }
    data.slotLockKey = `${resourceId(merged.resource)}#${toUtcIso(merged.slotStart)}#${data.seat}`
    return data
  }
  ```

  It **must** merge `originalDoc` under `data`: a partial `{ status }` update otherwise sees no `slotStart`.

- **Why a tombstone and not null** (F01): MongoDB sparse indexes still index documents whose field exists with an explicit `null`, and Payload's Mongo adapter always writes the null. With null, only the first cancellation in the whole system would succeed on Mongo. `released#<id>` is unique per document on both adapters. Postgres would accept nulls, but one rule serves both.
- **Seats:** the book endpoint loops `seat` from 0 to `capacity - 1`, calling `payload.create` for each attempt and moving to the next seat on a uniqueness error on `slotLockKey`. Exhausted → `409 { error: 'slot_taken' }`. Invariant (F58): if the slot-holding count for a start is below capacity, some seat in `0..capacity-1` is free; lowering capacity later is conservative.
- **Each seat attempt is an independent, self-committing `payload.create`** with `disableTransaction: true` and **no shared `req` carrying a transaction** (F16, F17). Under Mongo transactions the race loser surfaces as a raw `WriteConflict` (code 112) rather than a `ValidationError`; without a transaction every loser is a `ValidationError` with `errors[0].path === 'slotLockKey'` on both adapters. `payload.create` also kills an inherited transaction on failure, so the endpoint never opens one around the loop and never performs a write that must be atomic with the booking.
- **Catch dispatch** (F10): on `ValidationError`, switch on `err.data.errors[0].path`: `'slotLockKey'` → next seat; `'reference'` → regenerate and retry the same seat (max 3); any other path → map to `422 { errors }`. Any error with `code === 112` or `errorLabels` containing `TransientTransactionError` → retry the same seat once, then continue. Anything else → rethrow (500).
- **Membership re-check** (F18): before the loop, the endpoint regenerates availability server-side and asserts the submitted `start` is present by **verbatim string match** (`start` is `z.string()`, never coerced), and re-applies `minNotice`. The matched slot's server-generated `start`/`end` are what get written, never the body value. No match → `409 { error: 'slot_unavailable' }`.
- **Same-person guard** (C06): between the membership check and the loop, if a slot-holding appointment exists for (resource, slotStart, normalised email) → `409 { error: 'already_booked', id, reference }` without creating. Read-then-write, so it only narrows the window; the form's in-flight submit lock (§14) closes it.
- **Re-confirming a cancelled appointment** is not a path in v1: status changes go through the endpoints, and none moves a row back to `confirmed`. The unique index would refuse it anyway if the slot were taken.

**Required tests (§16):** the race on both adapters, cancel-then-rebook, and cancel twice for the same slot (two `released#` rows must coexist).

---

## 9. Endpoints

Mounted at `${apiBasePath}` under Payload's API (`/api/booking/...` by default). All return JSON. All validate with zod. Payload populates `req.user` on custom endpoints but runs no access check: guard them yourself (F42, F44).

**Request handling** (F42): handlers are `(req: PayloadRequest) => Response`. Read JSON bodies with `await addDataAndFileToRequest(req)` then `req.data` (preferred: it also replaces `req.json` with a resolved copy, so the single-use caveat disappears). `PayloadRequest` extends `Partial<Request>`, so a bare `await req.json()` fails strict type-checking; write `await req.json?.()` if it is used directly. Query params come from `req.query`; path params from `req.routeParams`. Reject bodies whose `Content-Length` exceeds 16 KB before parsing (C09). Zod schemas are `.strict()` at the top level, on `source` and on `customer`; the `customer` schema is built at init from `name`, `email`, `phone` plus the `name`s in `options.customerFields`, so any undeclared key is rejected with 422 before `payload.create`. The create `data` is assembled explicitly from the parsed result, never `...body` (F59). The honeypot key is declared in the top-level schema so `.strict()` accepts it.

**Zod caps for `/book`** (C09, F23): `customer.name` ≤ 120, `customer.email` ≤ 254, `customer.phone` ≤ 40, `message` ≤ 2000, `source.page`/`source.referrer` ≤ 2048, `source.utm*` ≤ 200. All strings trimmed; any customer string or `message` containing control characters other than `\n` and `\t` is rejected with 422. `customer.email` is trimmed and lower-cased before validation. Collection `maxLength` mirrors these as the last-resort backstop, except on `customer.email`, whose field type has no `maxLength` (§6.4). Map any Payload `ValidationError` not handled by the seat loop to `422 { errors: [{ path, message }] }`.

**Resource resolution** (applies to `/availability` and `/book`): `resource` is a string matched first as the collection id, then as `slug`. Omitted with exactly one `active` location → that one. Omitted with several active → `400 { error: 'resource_required' }`. Supplied but unknown or inactive → `404 { error: 'resource_not_found' }`. Zero active locations → `/availability` returns `200 { days: [], meta }` so the form shows its empty-window message, and `/book` returns `409 { error: 'slot_unavailable' }`.

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /availability?resource=<id\|slug>` | public | Resource resolution above. Returns `200 { days: Day[], meta: { timezone, phone, labels: { locale, hour12 } } }`. `Cache-Control: no-store`. No `from` param in v1 (F43). |
| `GET /resources` | public | `{ id, slug, name }[]` of active locations, for the picker (F26). `no-store`. |
| `GET /form-token` | public | Fresh signed time-trap token (D7). `200 { formToken, expiresAt }` (`expiresAt` = issuedAt + 6 h, ISO). `no-store`. |
| `POST /book` | public + guards | Body `{ resource?, start, customer: { name, email, phone, ...custom }, message?, formToken, challengeToken?, [honeypotField]?, source?: { page?, referrer?, utmSource?, utmMedium?, utmCampaign? } }`. Guards in order: honeypot → formToken (min 3 s, max 6 h) → zod → `verifyChallenge` → caps → membership re-check → same-person guard → seat loop. `resource?` follows the resolution rule above. Success `201 { id, reference, start, end, label, icsContent, googleCalendarUrl }`. Failures: `400 { error: 'token_invalid' \| 'token_expired' \| 'token_too_fast' \| 'challenge_failed' \| 'resource_required' }`, `404 { error: 'resource_not_found' }`, `422 { errors }`, `429 { error: 'too_many' }`, `409 { error: 'slot_taken' \| 'slot_unavailable' \| 'already_booked' }`. Honeypot hit → respond exactly like success with a random id/reference and empty `icsContent` and `googleCalendarUrl`, creating nothing. |
| `GET /appointment-by-token?token=` | token | Always `200` with `no-store`: `{ state: 'valid' \| 'expired' \| 'invalid' \| 'cancelled' \| 'past', phone, bookUrl, appointment?: { customerName, localDate, localTime, timezone, status } }`. `appointment` present for every state except `invalid` (F24, F47). Never the email or phone of the customer. `localDate`/`localTime` are `core/format.ts` output, identical to the email view model, not the stored 24-hour values. **State precedence, in this order:** bad signature, wrong purpose, malformed, or no such appointment → `invalid`; `status === 'cancelled'` → `cancelled`; `status` in `completed \| no-show` → `past`; `exp < now` → `expired`; `slotStart <= now` → `past`; else `valid`. The `exp` test must precede the time-based `past` test, otherwise `expired` is unreachable because `exp = slotStart + 24h`. |
| `POST /cancel-by-token` | token | Body `{ token }`. Verify per §11. Fresh cancel and repeat alike → `200 { state: 'cancelled' }` (idempotent). Bad signature, wrong purpose or unknown appointment → `400 { error: 'token_invalid' }`; `exp < now` → `400 { error: 'token_expired' }`. `completed`/`no-show`, past `cancellationCutoff`, or past start → `410 { error: 'too_late' }`. Writes with `context: { bookingStatusChange: true }` and `cancelledBy: 'customer'`. `no-store`. |
| `POST /appointments/:id/cancel` | staff | Body `{ reason? }`. `401` without `req.user`. **Two steps** (F03, F14): first `req.payload.findByID({ id, user: req.user, overrideAccess: false, depth: 0 })`, mapping Payload `Forbidden` → 403 and `NotFound` → 404, so the host's `manage` rule is evaluated by Payload whether it returns a boolean or a `Where` (F44); then `req.payload.update({ id, data: { status: 'cancelled', cancelledAt, cancelledBy: 'business', cancellationReason }, overrideAccess: true, context: { bookingStatusChange: true } })`. The second step must use `overrideAccess: true`, otherwise Payload's field access pass silently drops the three audit fields (§6.4). Gated on `status === 'confirmed'`; otherwise `409 { error: 'invalid_transition', status }`. Success `200 { id, status, cancelledAt }`. |
| `POST /appointments/:id/status` | staff | Body `{ status: 'completed' \| 'no-show' }` (anything else → `422 { errors }`). Same two-step auth pattern. Allowed only when the row is `confirmed` and `slotStart <= now`; otherwise `409 { error: 'invalid_transition', status }`. Success `200 { id, status }`. No emails; fires `onAppointmentChange`. |

`reference` is the human code stored on the doc (§6.4). There is **no** public confirmation URL keyed by reference; success is in-page state plus the email.

**Client IP** (F19): resolved by `options.getClientIp` if given; else, when `trustProxy` is true, the first entry of `X-Forwarded-For` (falling back to `X-Real-IP`, `CF-Connecting-IP`); else `undefined`. When undefined: skip the per-IP cap, store `source.ipHash = null`, pass `undefined` to `verifyChallenge`, never throw. `ipHash = HMAC(k_ip, ip)`; the raw address is never kept.

**Email normalisation** (C05): the normalised value is what the caps, the same-person guard, and the create all use.

**`googleCalendarUrl`** (F61): built server-side in `core/ics.ts` as `https://calendar.google.com/calendar/render?action=TEMPLATE&text=<SUMMARY>&dates=<start>/<end>&location=<LOCATION>&details=<note>`, with `start`/`end` in UTC basic form `YYYYMMDDTHHmmssZ`, the same SUMMARY and LOCATION as the `.ics`, and every value `encodeURIComponent`-ed.

---

## 10. Emails

Sent through the host's Payload email adapter (`payload.sendEmail`). The plugin ships no provider.

**Where sends happen** (F21): only in endpoint code, after `await payload.create/update` resolves. Payload has no post-commit hook (`afterChange` and `afterOperation` both run before `commitTransaction`), so collection hooks never send email. Since status changes only happen through endpoints (D2), this covers every event.

**No adapter** (C04): Payload substitutes a console adapter when the host configures none. Detect `payload.email.name === 'console'`: skip the send, append an `emailLog` entry with `error: 'no_email_adapter'`, and log one plugin-level warning.

| Event | To | Contains |
|---|---|---|
| `customer.confirmed` | customer | local date/time, `location`, `confirmationNote`, cancel magic link, `.ics` invitation attached |
| `business.booked` | `notificationEmails` | customer name/phone/email, slot, message, custom fields, admin edit-view link |
| `business.cancelledByCustomer` | `notificationEmails` | who, which slot |
| `customer.cancelledByBusiness` | customer | which slot, reason if given, `phone`, plain link to `routes.bookPath` (D9), `.ics` cancellation attached |

**View models** (C10): per event, plain objects, never the raw document. Base: `{ customerName, localDate, localTime, timezone, location, phone, bookUrl }`. `customer.confirmed` adds `{ cancelUrl, note, icsContent }`. `business.booked` adds `{ customerEmail, customerPhone, message, customFields: Record<string, string>, adminUrl }`. `customer.cancelledByBusiness` adds `{ reason }`. Host overrides per event via `options.email.templates`; they receive unescaped values and own their escaping (stated in the `EmailTemplate` JSDoc).

**Links** (F22): `origin = options.siteUrl ?? payload.config.serverURL`; `cancelUrl = new URL(`${routes.cancelPath}/${token}`, origin)`; `bookUrl` likewise. Admin link via `formatAdminURL({ adminRoute: payload.config.routes.admin, path: `/collections/${slugs.appointments}/${id}`, serverURL })` from `payload/shared`; when `serverURL` is empty, warn once and omit it.

**Escaping** (F23): default templates HTML-escape every view-model string (`& < > " '`) in `html`; `text` is sent as plain text. Unit test: a name containing `<a href=x>` renders as literal text.

**Sending discipline** (D6, F13): sends run sequentially; all `emailLog` entries for one operation are collected in memory and written in **one** `payload.update` with `context: { bookingEmailLog: true }` after the sends. A failed email never fails the booking: wrap in try/catch, record `error`. `providerId` is the adapter's return value when it is a string (nodemailer's `messageId`), else omitted. The `bookingEmailLog` context flag marks these bookkeeping writes so the collection hooks and any host-added hook can recognise them; the plugin's own hooks are idempotent through the `originalDoc` merge and need no special case today.

**`onAppointmentChange`** (F21): after the emailLog update resolves, or immediately after the write when there are no sends (`/appointments/:id/status`), the endpoint runs `await options.onAppointmentChange?.({ event, doc, req })` once per successful mutation, inside try/catch that logs through `payload.logger.error` and never changes the status code or body. `doc` is the committed document at `depth: 0`. `event` is `'booked'` for `/book`, `'cancelled'` for both cancel endpoints, and the new status for `/status`. Never invoked for the honeypot fake success, for emailLog writes, or when `disabled` is true.

**Calendar files** (D12, C14): `core/ics.ts` generates iTIP. Confirmation: `METHOD:REQUEST`, `UID = appointment id`, `DTSTAMP`, `SEQUENCE:0`, `ORGANIZER:mailto:<notificationEmails[0]>`, `ATTENDEE:mailto:<customer email>`, `DTSTART/DTEND` in UTC, `SUMMARY`, `LOCATION`. Business cancel: `METHOD:CANCEL`, same UID and ORGANIZER, `DTSTAMP`, `SEQUENCE:1`, `STATUS:CANCELLED`. TEXT values escaped per RFC 5545 §3.3.11, CRLF line endings, lines folded at 75 octets. Passed via `attachments`, with the MIME `method` parameter matching the file's METHOD (RFC 6047 §2.4): confirmation `{ filename: 'appointment.ics', content, contentType: 'text/calendar; method=REQUEST' }`, cancellation `{ filename: 'cancellation.ics', content, contentType: 'text/calendar; method=CANCEL' }`. Any provider error is caught and logged. `icsContent` is also returned from `/book`. README states that automatic removal on cancel is best-effort across calendar clients.

---

## 11. Magic-link cancellation

- **Token** (F47): `token = enc + '.' + sig` where `enc = base64url(JSON.stringify({ a: appointmentId, p: 'cancel', exp }))` and `sig = base64url(HMAC-SHA256(k_cancel, enc))`. Verify by recomputing the HMAC over the received `enc` string (never re-serialise), length check, `timingSafeEqual`, then parse and reject if `p !== 'cancel'` or `exp < now`. `exp` in unix seconds = `slotStart + 24h`.
- **Keys** (F45): purpose-bound sub-keys derived once: `k_cancel = HMAC(tokenSecret, 'booking:cancel')`, `k_form = HMAC(tokenSecret, 'booking:form')`, `k_ip = HMAC(tokenSecret, 'booking:ip')`. The raw secret is never used directly.
- Idempotent, not single-use: a second click renders "already cancelled".
- **Confirmation page on GET, mutation on POST.** Mail clients and link scanners prefetch GETs.
- **Five rendered states**, each showing `phone` from settings and a plain "book a new time" link (no prefill, D9): valid → confirm button; expired; bad signature; already cancelled; in the past (also used for `completed`/`no-show`).
- The host owns the page route (`routes.cancelPath/[token]`); the plugin exports `CancelView` (§14) and the endpoints. The email links to the host route. The host page should send `Referrer-Policy: no-referrer` since the token lives in its path.

---

## 12. Anti-abuse

Layers, in order of execution in `/book`:

1. **Honeypot.** Field named `options.honeypotField` (default `'website'`), rendered off-screen with `autocomplete="off"`, never stored. Filled → respond like success, create nothing.
2. **Signed time-trap token** (D7). `formToken = issuedAt + '.' + base64url(HMAC(k_form, 'form.' + issuedAt))`, fetched by the form from `GET /form-token` on load, so the window (min 3 s, max 6 h) is measured from page load. It is reusable within its window by design, not a nonce; per-visitor abuse is bounded by the caps and the challenge (F45). A token younger than 3 s returns `400 { error: 'token_too_fast' }`, distinct from `token_invalid`, so the form can wait until `issuedAt + 3 s` and resubmit the same token instead of fetching a new one. `issueFormToken(secret)` is also exported from the root entry for hosts that render the token server-side (§18).
3. **Zod** validation with length caps (§9).
4. **`verifyChallenge`** (F48): resolved `false` → `400 { error: 'challenge_failed' }`; rejected promise or timeout (`challengeTimeoutMs`, default 5000) → `req.payload.logger.warn` and continue (fail open: a challenge-provider outage must not stop bookings while the other layers still apply). Unset → skipped. Cloudflare Turnstile is the recommended provider; the README carries the host-side snippet. Enabling it is a host-only change.
5. **Booking caps** (F46): counted with `payload.count` on stored rows, so rejected attempts are not counted. `maxPerIpInWindow` (by `source.ipHash`, skipped when IP is unknown), `maxPerEmailInWindow` (rows created in the window, any status), `maxActivePerEmail` (**upcoming** rows only: status `confirmed` and `slotStart >= now`, so past completed and no-show appointments never lock a repeat customer out). Exceeded → `429 { error: 'too_many' }`. Request-level throttling belongs to the host's edge (WAF, Turnstile), which is adequate because rows and emails only occur on the success path.

---

## 13. Admin experience

The owner is a non-technical business person. This is a deliverable, not polish.

- **Group and order.** `admin.group: 'Bookings'` for Closed Dates, Bookable Locations, and Booking Settings. Payload lists a group's collections in registration order and then its globals, so the sidebar reads: Closed Dates, Bookable Locations, Booking Settings (F49). Appointments uses `admin.group: false` and is reached through the links below.
- **No Create button** (D1). Appointments has no create path; staff enter phone bookings through the public booking page at `routes.bookPath` so every appointment passes the same checks. The README's admin walkthrough says this, so the missing button reads as intentional.
- **Upcoming / Past** (D5). A client component in `admin.components.afterNavLinks` (registered in object form with `clientProps: { disabled, appointmentsSlug }`, §3.5) renders two links. It builds the base with `formatAdminURL({ adminRoute: useConfig().config.routes.admin, path: `/collections/${appointmentsSlug}` })` from `payload/shared` (never a literal `/admin`, §2.4) and appends a query string built with `qs-esm`'s `stringify`, in the canonical WhereBuilder shape, **one field per `and` entry**:
  - Upcoming: `where[or][0][and][0][status][equals]=confirmed`, `where[or][0][and][1][slotStart][greater_than_equal]=<now ISO>`, `sort=slotStart`.
  - Past: `where[or][0][and][0][status][not_equals]=confirmed`, `where[or][1][and][0][slotStart][less_than]=<now ISO>`, `sort=-slotStart`.

  The shape matters: the filter UI renders each `and` entry from its first key, so a flat two-key `where` would show one chip and silently drop the second constraint the moment the owner edits it. "Now" is computed at click time. Search, pagination and bulk actions remain Payload's own. Note that Payload stores the list's `sort` per user and prefers it over `defaultSort`, so after the first click the plain list keeps whichever direction was last used; `defaultSort` governs only a user's first visit.
- **Status label and actions** (D2, F50). `status` renders as a read-only label. The `statusActions` ui field renders, from the `./client` entry: **Cancel appointment** (enabled while `confirmed`; opens a `ConfirmationModal` from `@payloadcms/ui` for the optional reason), **Mark completed** and **Mark no-show** (enabled while `confirmed` and `slotStart <= now`). Each button reads `id` and `collectionSlug` from `useDocumentInfo()`, builds the URL with `formatAdminURL({ apiRoute: useConfig().config.routes.api, path })`, POSTs with `credentials: 'include'`, shows the result with `toast`, then calls `useRouteCache().clearRouteCache()` from `@payloadcms/ui`, which wraps Next's router refresh so Payload's Form replaces its state and the label and buttons update. Using the wrapper keeps `next/*` out of the package and the peer list as written (§3.2). `apiBasePath` arrives through `clientProps`; the collection slug comes from `useDocumentInfo()`. Hidden on the create view. The client-side disabling of the two past-only buttons mirrors the server's `409 invalid_transition` guard, which is the real check.
- **Business-zone times** (D8). `slotStart.timezone` renders the list column and the edit picker in the business zone natively. No custom Cell.
- **Closed Dates:** the blackout guard's message reads like a sentence (§6.3).
- **Booking Settings:** last inside each weekday group sits a client `ui` field (`weeklySchedule.<day>.preview`) that reads its sibling rows through `useFormFields` (paths `weeklySchedule.<day>.sessionStarts.<i>.time`) and renders "09:00–10:00 · 10:00–11:00 …" using the duration, flagging overlaps inline; no timezone maths (F60). It echoes the stored 24-hour `HH:mm` values exactly as typed and is the one place a time is not passed through `core/format.ts`, by design, because it mirrors the inputs beside it. Hidden when `open` is false. Not mounted on a resource's `scheduleOverride` in v1, where the duration is not in form state.
- **Dashboard widget** (F08, C01): `admin.components.beforeDashboard` → `{ path: '<PACKAGE_NAME>/rsc#TodayWidget', serverProps: { disabled, slugs, labels } }`, an async server component typed `ServerProps` from `payload`. Reads settings for the timezone, computes the [today, tomorrow] window in that zone, runs `payload.find({ collection, user: props.user, overrideAccess: false, pagination: false, where: { status: { equals: 'confirmed' }, slotStart: { greater_than_equal, less_than } }, sort: 'slotStart' })` so a user without `manage` sees nothing, and lists name, time, phone, and a link built with `formatAdminURL`. Renders nothing when `disabled`. Do not use `admin.dashboard.widgets` (experimental in 3.84).
- **No custom list view** in v1.
- Every field: `admin.description` in plain English. Write the sentences; do not leave placeholders.
- README: the host must run `payload generate:importmap` after install.

---

## 14. Frontend exports (`./react`)

Browser-safe: `'use client'` components and their prop types only; no `node:crypto`, no secret-taking helpers (F25). The host adds two thin pages and renders these:

- `<AvailabilityPicker apiUrl resource? onSelect messages? classNames? />` — fetches `/availability`, renders a day strip + slot grid from **server-supplied labels**. `resource` optional (F26); with one active location none is needed.
- `<BookingForm apiUrl resource? fields? formToken? challenge? onSuccess messages? classNames? />` — the full flow: picker → form → submit → success. Fetches its token from `/form-token` on mount unless `formToken` is given (D7). On `400 token_too_fast` it waits until `issuedAt + 3 s` and resubmits the same token. On `400 token_invalid` / `token_expired` it fetches a fresh token, waits 3 s so the new token clears the trap, then retries once, keeping typed fields and the submit button disabled throughout; if that retry fails it shows the message but keeps the fresh token so a later manual submit works. Disables submit while a request is in flight (C06). **409 recovery is required:** on `slot_taken` / `slot_unavailable`, re-fetch availability, grey out the vanished slot, say so in plain English, scroll to the grid, and **keep every field the customer typed**; on `already_booked`, show success-with-notice ("You already have this slot, check your email"). `400 resource_required` and `404 resource_not_found` are host-configuration errors shown through `messages`, never retried. Success state offers "Add to calendar" as `<a href="data:text/calendar;charset=utf-8,…" download="appointment.ics">` plus the `googleCalendarUrl` link (F61). `challenge` is a render slot for a provider widget (e.g. Turnstile); its token is sent as `challengeToken`.
- `<CancelView apiUrl token messages? classNames? />` — GET `/appointment-by-token` on mount, render the five states from `state`, POST `/cancel-by-token` on confirm. On the POST: `200` → cancelled state; `400 token_invalid` / `token_expired` → the matching bad-signature or expired state; `410 too_late` → the past state.
- `apiUrl` (F51) is the full prefix of the plugin's endpoints, `${routes.api}${apiBasePath}`, default `'/api/booking'`, absolute for cross-origin hosts. The components never read Payload config.
- `fields` (F52): `CustomerFieldDescriptor = { name; label; type: 'text' | 'textarea' | 'email' | 'number' | 'select' | 'checkbox'; required?; options?: { label; value }[]; placeholder? }`. The root entry exports `toCustomerFieldDescriptors(customerFields)`, which maps supported Payload field types and throws at config time for unsupported ones, so the host's server page computes descriptors and passes them down. The `/book` zod schema for `customer` is built from the core keys plus the `name`s in `options.customerFields` and is `.strict()`, so undeclared keys are rejected with 422; declared custom keys are passed to `payload.create`, whose own field validation reports errors in the same `422` shape.
- `messages` (F54): `Partial<Messages>` with English defaults exported as `defaultMessages`: empty window ("No times available in the next {days} days. Call {phone}."), slot taken, already booked, validation, rate limit, token, success, the five cancel states. The empty state renders when every returned day has zero available slots; `phone` comes from `/availability`'s `meta`.

Headless by default (unstyled, semantic HTML, labels, error announcements, keyboard-operable), with an optional stylesheet at `src/react/styles.css` exported as `./styles.css`. Fully accessible: focus management on step changes, `aria-live` for errors, buttons not divs. No `window` access at render.

Server-only helpers live in the root entry `.`: `issueFormToken(secret: string)`, `toCustomerFieldDescriptors(fields: Field[])`, and `getBookingApiUrl({ routesApi, apiBasePath }: { routesApi?: string; apiBasePath?: string }): string`, which returns `${routesApi ?? '/api'}${apiBasePath ?? '/booking'}` so the host page can compute `apiUrl` from its own config instead of hardcoding it.

---

## 15. Multi-location readiness (do not build the UI, do build the model)

- `booking-resources` exists from day one; v1 seeds one.
- `slotLockKey` includes the resource id.
- Availability and booking take an optional `resource`; with one active location the server resolves it. With several active locations the server requires it, and `/resources` lists them so a future chooser needs no host knowledge of the collection slug. v1 renders no chooser (F26).
- Appointment *types* (services with different durations) are **not** in v1. Duration comes from settings only. `server/availability.ts` centralises schedule and capacity resolution in one `resolveSlotConfig({ settings, resource })`; a future `types` collection sits in front of that lookup (F53). The uniqueness model keys on slot start and assumes one duration per location; variable-duration types will need a different lock strategy. Do not assume the current key generalises.

---

## 16. Tests

**Unit (`src/**/*.spec.ts`)** — vitest, no database:

- Slot generation across the March and November DST weeks and both transition days (2026-03-08 with a 02:30 session → dropped; 2026-11-01 with a 01:30 session → first occurrence), run under `TZ=UTC` and `TZ=America/Chicago`.
- Every emitted `start`/`end` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`, and for every emitted slot `format(new TZDate(slot.start, timezone), 'HH:mm')` equals the configured session time (catches gap-normalised instants).
- Rolling vs calendar-week windows, on a Friday and a Monday; "today" in the business zone at 04:30Z.
- Lead time, blackouts (single day, range, resource-scoped), capacity subtraction, overlap validation, midnight rule.
- Lock key derivation with partial updates (the `originalDoc` merge); tombstone on cancel; `completed` keeps the key.
- Token sign/verify: valid, expired, tampered, wrong purpose; `tokenSecret` undefined / empty / short. Form token: issued now → `token_too_fast`; the same token at +3 s → passes.
- HTML escaping in templates; `.ics` escaping (a name containing `\r\n` and `;` yields a parseable VEVENT); the cancellation attachment's contentType contains `method=CANCEL`.
- Postgres identifier length for every array in the field tree (C03).

**Integration (`dev/int/*.spec.ts`)** — vitest, `fileParallelism: false`, one `getPayload` per file, clean database per run:

- **Race:** `Promise.all` of 2 and of 10 creates for the same slot, each passing `disableTransaction: true` exactly as the seat loop does (§8) → exactly one succeeds; every loser is a `ValidationError` with `errors[0].path === 'slotLockKey'`. **Both adapters.** A control case on Mongo *without* `disableTransaction` asserts the loser is a `MongoServerError` with `code === 112`, documenting why the flag exists. Also run two concurrent `/book` handler calls → one 201, one `409 slot_taken`.
- Cancel frees the slot: book → cancel → book again succeeds. Cancel twice on the same slot: two `released#` rows coexist. **Both adapters.**
- Capacity 1, 12+ bookings across the window → every one reports `available: false` (C01).
- Book one slot, re-fetch availability: that slot's `remaining` dropped by exactly one and no other slot changed. **Both adapters.**
- Blackout guard refuses a range with slot-holding bookings; a blackout saved concurrently with a booking → both succeed, the day is empty afterwards.
- Endpoints: each error path in §9 returns its documented status; `already_booked` with capacity 2 → one row.
- Resource resolution: two active locations and no `resource` → `400 resource_required`; a bogus slug and a deactivated row → `404 resource_not_found`; zero active → `/availability` empty days and `/book` `409 slot_unavailable`.
- Cancel by token: valid → 200, tampered → `400 token_invalid`, expired → `400 token_expired`, a `completed` row → `410 too_late`, a second call → 200.
- `/status`: `completed` and `no-show` on a past `confirmed` row → 200, no sends, `emailLog` unchanged, and the slot still reports `available: false`; a future row → `409 invalid_transition`; a second call → 409; unauthenticated → 401.
- After `POST /appointments/:id/cancel` with `{ reason }`: `cancelledBy === 'business'`, `cancelledAt` set, `cancellationReason` equals the posted reason, and the customer email carries that reason.
- Caps: three past `completed` rows plus a cancelled row for an email → `/book` 201; three upcoming `confirmed` rows → `429 too_many`; cancelling one → next `/book` 201. Case-insensitive: `Foo@X.com ` after three upcoming rows for `foo@x.com` → 429.
- `verifyChallenge` that rejects or exceeds `challengeTimeoutMs` → 201 with one logged warning; one that resolves `false` → `400 challenge_failed`.
- `onAppointmentChange` fires once per book, cancel and status call with the matching `event`, never for the emailLog write; a throwing callback still yields 201/200 with the emailLog intact.
- Settings duration raised above an existing override's spacing → the settings save is refused naming the location.
- Change `settings.timezone`, then cancel an existing appointment: `slotLocalDate`, `slotLocalTime` and the stored zone are unchanged.
- Unauthenticated REST create on appointments → 403. A `manage` user PATCHing `slotStart` via REST leaves the doc unchanged. PATCHing `status` without the flag → 400 with the readable message; `POST /appointments/:id/cancel` → 200 and emails.
- Emails: the capturing adapter records two sends on book (customer + business, with an attachment) and one on each cancel; `emailLog` has 2 entries after book, 3 after cancel.
- Seeding boots twice → one resource, one settings doc.

**Endpoint harness** (C12): handlers are exported `PayloadHandler`s. Tests build `new Request(url, { method, headers, body })`, call `createPayloadRequest({ config, request })`, set `req.routeParams = { id }` for `:id` routes (or go through `handleEndpoints({ config, request })` for real path matching), and invoke the handler. Authenticated paths log in with `payload.login` and send `Authorization: JWT <token>`.

**Browser (Playwright, `dev/e2e/*.spec.ts`)**: (1) happy path: pick a slot, submit, assert the success state and the two captured emails; (2) 409 recovery keeps typed fields; (3) the five CancelView states with minted tokens; (4) against `next build && next start` of the dev app, never `next dev`: load the booking page, wait at least 3 seconds, book successfully, proving the token is minted per page load and the page is not prerendered (F20). Optional: business-zone list rendering with `timezoneId`.

**CI** runs all of it on push (§4.5).

---

## 17. Build & publish checklist

1. `pnpm build` → `dist/` with `.js` + `.d.ts` + `react/styles.css`. Five entries in **both** `exports` and `publishConfig.exports`: `.`, `./client`, `./rsc`, `./react`, `./styles.css` (`./src/react/styles.css` ↔ `./dist/react/styles.css`).
2. `pnpm pack`, then in a **fresh** `create-payload-app -t blank` project: `pnpm add ../<tarball>`, add `bookingPlugin({...})`, `payload generate:importmap`, `pnpm dev` → admin loads, endpoints answer. This catches the exact failure the incumbent shipped.
3. In that project run `pnpm why @payloadcms/ui` and require "Found 1 version" (F62).
4. Version: semver. `0.x` until the first client has run it in production; `1.0.0` after.
5. `pnpm publish --access public` (scoped; pnpm applies `publishConfig`). Tag the commit. Update `CHANGELOG.md`.
6. README sections: What it does · Install · Config (every option) · Env (`BOOKING_TOKEN_SECRET`, required, ≥ 32 chars, must differ from `PAYLOAD_SECRET`, `openssl rand -base64 32`) · Client IP and `trustProxy` · Host routes to add · Turnstile snippet · Emails · Admin walkthrough with screenshots · Compatibility table · Contributing · License.

---

## 18. How the first client site consumes it

Before publishing (F02; `pnpm link --global` no longer exists in pnpm 11+, and `pnpm add file:<dir>` skips `publishConfig`):

```bash
# in the plugin repo
pnpm build && pnpm pack --pack-destination ..
# in the client repo
pnpm add ../ogutdgn-payload-booking-0.1.0.tgz && pnpm payload generate:importmap
```

Re-run both after every plugin rebuild. Do not commit the tarball dependency to the client's main branch.

Then in the client's `payload.config.ts`:

```ts
bookingPlugin({
  siteUrl: 'https://example.com',
  routes: { cancelPath: '/appointments/cancel', bookPath: '/schedule' },
  access: { manage: isEditor, configure: isAdmin },
  tokenSecret: process.env.BOOKING_TOKEN_SECRET!,
  email: { from: process.env.BOOKING_FROM_EMAIL!, replyTo: 'info@example.com' },
  trustProxy: true,   // Vercel / Cloudflare set X-Forwarded-For
  defaults: {
    resource: { name: 'Showroom' },
    settings: {
      timezone: 'America/Chicago',
      slotDurationMinutes: 60,
      capacityPerSlot: 1,
      minNoticeMinutes: 120,
      cancellationCutoffMinutes: 0,
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
      location: '2112 Rutland Dr #150, Austin, TX 78758',
      phone: '(512) 555-0100',
    },
  },
  customerFields: [{ name: 'purpose', type: 'select', options: [/* host-defined */] }],
  onAppointmentChange: async ({ event }) => { /* host revalidation / analytics */ },
})
```

The host adds `app/(frontend)/schedule/page.tsx` (a server component that renders `<BookingForm apiUrl="/api/booking" fields={toCustomerFieldDescriptors(...)} />`) and `app/(frontend)/appointments/cancel/[token]/page.tsx` (renders `<CancelView apiUrl="/api/booking" token={params.token} />`), runs `payload generate:importmap`, and sets `BOOKING_TOKEN_SECRET`. If the host mints `formToken` server-side instead of letting the form fetch it, the page must `await connection()` from `next/server`, inside a Suspense boundary, before minting, so it is not prerendered (F20).

After publishing: `pnpm add @ogutdgn/payload-booking@^0.1`.

---

## 19. Out of scope for v1 (documented, not built)

Admin-side appointment creation (v1.1) · calendar-style admin page (v1.1 candidate) · multi-location booking UI (v1.1; model ready) · reminder emails (needs a cron; v1.1) · moving an appointment to another time (v1 = cancel + book again) · one-off partial-day closures (blackouts are whole local days; use session times for recurring gaps) · Google Calendar sync and Meet links (one-way, Postgres authoritative; `googleEventId` reserved; needs appointment types) · appointment types with different durations · payments (never) · SMS · waitlists · recurring appointments.

---

## 20. Acceptance criteria

The plugin is done when, in the dev app:

1. **[auto + e2e]** A visitor books a slot, sees the in-page confirmation, and both emails are captured by the test email adapter with the expected recipients and the `.ics` attachment.
2. **[auto]** Two simultaneous bookings for one slot yield one 201 and one 409, on Postgres and on Mongo; **[e2e]** the 409 path in `BookingForm` keeps the typed fields.
3. **[auto + e2e]** The customer's magic link cancels on POST only, shows all five states, and the business is emailed.
4. **[auto]** Staff cancel from the admin action; the customer is emailed with the reason; `cancelledAt`/`cancelledBy`/`cancellationReason` are stored; the slot is bookable again. A manual status change is refused with the readable message. Mark completed and Mark no-show work on a past appointment, send nothing, and keep the slot held.
5. **[auto]** Closing a date with bookings is refused with a readable message.
6. **[manual]** Editing session times in settings changes availability without a deploy; overlapping times are refused.
7. **[manual, optional e2e]** The list and edit views show business-zone times regardless of the admin user's browser zone.
8. **[manual]** `pnpm pack` installs into a fresh blank template and runs (§17 steps 2–3).
9. **[auto]** CI is green: unit, integration on both adapters, e2e.
10. **[manual]** `LICENSE`, `README.md`, `CHANGELOG.md` exist and are accurate.

---

## 21. Decisions with chosen defaults

| Question | Decision |
|---|---|
| Booking window | `rolling-days`, 14. Calendar-weeks mode also built. |
| Minimum notice | 120 minutes |
| Cancellation cutoff | 0 (until slot start) |
| Reschedule | Not in v1; cancel page and business-cancel email carry a plain "book a new time" link, no prefill (D9) |
| Session times storage | Explicit `HH:mm` start list per weekday; overlaps rejected (D10) |
| Status changes | Endpoints only; read-only label + action buttons in the admin; server-side validator (D2) |
| Slot-holding statuses | confirmed, completed, no-show; only cancelled releases (D4) |
| Staff-created appointments | Not in v1 (D1) |
| Customer contact fields | Locked after submission for everyone (D3) |
| Trash | Off (D5) |
| Email log | Array on the row, one write per operation (D6) |
| Form token | Fetched on load from `/form-token` (D7) |
| Admin timezone rendering | Payload native `timezone` on `slotStart`; Payload's timezone list (D8) |
| Resources read access | `configure` only; `/resources` endpoint for the picker (D11) |
| Calendar files | iTIP REQUEST + CANCEL (D12) |
| Test layout / DB | Template layout; Postgres default, Mongo parity, CI matrix (D13) |
| Labels | `Intl`, `en-US`, 12-hour by default; stored local time 24-hour (D14) |
| After booking | In-page success + email with `.ics`; no public confirmation URL |
| Reminders | v1.1 |
| Package name | `@ogutdgn/payload-booking` (D15) |
| Per-email cap scope | Upcoming confirmed rows only; past completed / no-show never lock a repeat customer out |
| Admin refresh mechanism | `useRouteCache()` from `@payloadcms/ui`; no `next/*` import anywhere in the package |
| Date library | `date-fns ^4.1` + `@date-fns/tz ^1.2`, `TZDate` for all zoned construction |
