# @ogutdgn/payload-booking

Appointment booking for [Payload CMS](https://payloadcms.com) 3.x.

A visitor picks a real time slot on your site, the appointment appears in the Payload
admin, both sides get email, either side can cancel, and **the same slot can never be
sold twice** — enforced by a database uniqueness constraint, not by application logic.

> **Status: not published yet.** The build specification is
> [`PLUGIN_BOOKING_SPEC.md`](./PLUGIN_BOOKING_SPEC.md), and it is the source of truth for
> every behaviour described here.

## What it does

- **Never double-books.** Each slot-holding appointment carries a unique lock key, so two
  visitors submitting the same second get one `201` and one `409`. Verified on PostgreSQL
  and MongoDB.
- **Cancel is a status change, never a delete.** Audit trail, slot release and emails all
  run through one code path.
- **All time is computed server-side** in the business timezone. The browser receives
  labels and echoes opaque ISO strings.
- **Nothing in the package is host-specific.** Hours, timezone, capacity, addresses and
  routes come from plugin options or the settings global.
- No prices, no payments, no deposits.

## Requirements

| Package | Range |
| --- | --- |
| `payload` | `^3.84.1` |
| `@payloadcms/ui` | `^3.84.1` |
| `react` / `react-dom` | `^19.0.0` |

PostgreSQL or MongoDB, through Payload's own adapters. Node 20.9+.

## Install

```bash
pnpm add @ogutdgn/payload-booking
```

Add it to your Payload config:

```ts
import { bookingPlugin } from '@ogutdgn/payload-booking'

export default buildConfig({
  plugins: [
    bookingPlugin({
      access: { configure: isAdmin, manage: isEditor },
      defaults: {
        resource: { name: 'Showroom' },
        settings: {
          bookingWindow: { mode: 'rolling-days', rollingDays: 14 },
          cancellationCutoffMinutes: 0,
          capacityPerSlot: 1,
          location: '2112 Rutland Dr #150, Austin, TX 78758',
          minNoticeMinutes: 120,
          notificationEmails: ['info@example.com'],
          phone: '(512) 555-0100',
          slotDurationMinutes: 60,
          timezone: 'America/Chicago',
          weeklySchedule: {
            monday: { open: true, sessionStarts: ['09:00', '10:00', '11:00'] },
            // …the rest of the week
          },
        },
      },
      email: { from: 'Vera <bookings@example.com>' },
      routes: { bookPath: '/schedule', cancelPath: '/appointments/cancel' },
      siteUrl: 'https://example.com',
      tokenSecret: process.env.BOOKING_TOKEN_SECRET!,
    }),
  ],
})
```

Then run `payload generate:importmap`.

These values are only the starting point. Everything in `defaults.settings` is written
once, and the owner edits it in the admin afterwards.

## Configuration

**Required**

| Option | What it does |
| --- | --- |
| `access.manage` | Who may read appointments and run the status actions (staff). |
| `access.configure` | Who may edit settings, locations and closed dates (owner). |
| `defaults` | Seed values written once when the settings are empty, plus the first location. |
| `email.from` | The address confirmations are sent from. |
| `routes.bookPath` / `routes.cancelPath` | Your own page routes, used to build links in emails. |
| `tokenSecret` | Signs cancellation links and the anti-bot token. At least 32 characters, and different from `PAYLOAD_SECRET`. |

**Optional**

| Option | Default | What it does |
| --- | --- | --- |
| `siteUrl` | Payload's `serverURL` | Public origin for the links in emails. Set it: `serverURL` is often empty, and a relative cancel link cannot be opened from an inbox. |
| `apiBasePath` | `/booking` | Where the endpoints mount under Payload's API route. |
| `slugs` | see below | Rename any of the four collections and the global. |
| `labels` | `{ locale: 'en-US', hour12: true }` | How every time and date is written. |
| `supportedTimezones` | Payload's own list | Extend the timezone choices. |
| `customerFields` | none | Extra fields on the booking form. Text, textarea, email, number, select and checkbox. |
| `bookingCaps` | 5/hour per IP, 3/hour per email, 3 upcoming per email | Per-visitor limits. |
| `verifyChallenge` | none | Called with the challenge token on every booking. See below. |
| `trustProxy` | `false` | Whether to believe `X-Forwarded-For`. True on Vercel, Cloudflare and most managed hosts. On bare Node the header is client-supplied, so leaving it false keeps the per-IP cap honest. |
| `getClientIp` | none | Resolve the client IP yourself instead. |
| `honeypotField` | `website` | Name of the hidden field bots fill in. |
| `email.replyTo`, `email.templates` | none | Reply-to address, and per-event template overrides. |
| `onAppointmentChange` | none | Called after a booking or status change commits, for revalidation or analytics. |
| `disabled` | `false` | Turn off the endpoints, emails and seeding while leaving the database schema untouched. |

Default slugs: `appointments`, `booking-resources`, `booking-blackout-dates`,
`booking-settings`.

### Environment

| Variable | Notes |
| --- | --- |
| `BOOKING_TOKEN_SECRET` | Required, at least 32 characters, different from `PAYLOAD_SECRET`. Generate with `openssl rand -base64 32`. |

### Spam protection

Four layers, three of them on by default: a hidden honeypot field, a signed time-trap
token measured from page load, and caps per email and per IP. The fourth is yours to add:
pass a `verifyChallenge` function and the plugin calls it with the token from whatever
widget you render in the form's `challenge` slot.

```ts
verifyChallenge: async (token, ip) => {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    body: JSON.stringify({ remoteip: ip, response: token, secret: process.env.TURNSTILE_SECRET }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const result = await response.json()
  return result.success === true
}
```

A provider that answers "no" rejects the booking. A provider that is unreachable or slow
is logged and the booking goes through, because an outage at Cloudflare must not stop a
showroom taking bookings while the other three layers still apply.

## Endpoints

Mounted under Payload's API route, `/api/booking` by default.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /availability` | public | Days and slots, with labels already rendered in the business timezone. |
| `GET /resources` | public | Active locations, id and name only. |
| `GET /form-token` | public | A fresh anti-bot token per page load. |
| `POST /book` | public | Make a booking. |
| `GET /appointment-by-token` | link holder | What the cancellation page shows. Never the customer's email or phone. |
| `POST /cancel-by-token` | link holder | The customer's own cancellation. |
| `POST /appointments/:id/cancel` | staff | Cancel and email the customer. |
| `POST /appointments/:id/status` | staff | Mark completed or no-show. |

## Using it on a site

The plugin cannot own routes, so the host adds two thin pages and renders the exported
components. Both are in `dev/app/(frontend)/` as working references.

```tsx
// app/(frontend)/schedule/page.tsx
import { toCustomerFieldDescriptors } from '@ogutdgn/payload-booking'
import { BookingForm } from '@ogutdgn/payload-booking/react'

export default function SchedulePage() {
  return <BookingForm apiUrl="/api/booking" fields={toCustomerFieldDescriptors(customerFields)} />
}
```

```tsx
// app/(frontend)/appointments/cancel/[token]/page.tsx
import { CancelView } from '@ogutdgn/payload-booking/react'

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CancelView apiUrl="/api/booking" token={token} />
}
```

Then run `payload generate:importmap` and set `BOOKING_TOKEN_SECRET`.

The components are unstyled by default. Either import the optional stylesheet with
`import '@ogutdgn/payload-booking/styles.css'`, or pass your own class names through the
`classNames` prop. Every visible sentence can be replaced through `messages`.

## Development

```bash
pnpm install
createdb payload_booking_dev          # or set DATABASE_URL to an existing database
cp dev/.env.example dev/.env          # then edit DATABASE_URL and BOOKING_TOKEN_SECRET
pnpm dev                              # http://localhost:3000/admin
```

The `dev/` folder is a complete Payload site that mounts the plugin from `src/`. It is both
the test bench and the reference implementation of everything a host has to do.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the test bench |
| `pnpm typecheck` | Type-check the plugin and the bench |
| `pnpm lint` | ESLint |
| `pnpm test:unit` | Pure unit specs, no database |
| `pnpm test:int` | Integration specs against PostgreSQL |
| `pnpm test:int:mongo` | The same specs against an in-memory MongoDB |
| `pnpm test:e2e` | Playwright browser flows (run `npx playwright install chromium` once first) |
| `pnpm build` | Compile `src/` to `dist/` |

The bench chooses its database with `DB_ADAPTER` (`postgres` by default, `mongo` for the
adapter-parity suite). PostgreSQL creates the database and pushes the schema automatically
outside production, so no migrations are needed locally.

## How it avoids double-booking

Most booking systems ask "is this slot free?" and then write the appointment. Those are two
steps, and two requests can both pass the check before either one writes.

Here, every slot-holding appointment stores a key built from the location, the exact start
instant and a seat number, and that column is unique in the database. The second write is
refused by the database itself, so there is no gap to race through. Capacity above one
works by seat: the booking endpoint walks seats until one is free, and returns "that time
has gone" when they all are.

Cancelling replaces the key with a per-appointment tombstone rather than emptying it.
MongoDB indexes an explicitly empty value, so emptying it would let only the first
cancellation in the whole system succeed.

## Not included

No prices, payments or deposits, ever. Not in version 1: staff creating appointments from
the admin, several locations in the booking form, reminder emails, rescheduling in place,
partial-day closures, calendar sync, and appointment types with different lengths. The data
model already carries the seams for locations and types.

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck`, `pnpm lint`,
`pnpm test:unit` and `pnpm test:int` before opening one.

## License

MIT. See [LICENSE](./LICENSE).
