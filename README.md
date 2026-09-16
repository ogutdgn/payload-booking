# @ogutdgn/payload-booking

Appointment booking for [Payload CMS](https://payloadcms.com) 3.x.

A visitor picks a real time slot on your site, the appointment appears in the Payload
admin, both sides get email, either side can cancel, and **the same slot can never be
sold twice** — enforced by a database uniqueness constraint, not by application logic.

> **Status: in development.** Not published yet. The build specification is
> [`PLUGIN_BOOKING_SPEC.md`](./PLUGIN_BOOKING_SPEC.md); it is the source of truth for
> every behaviour below.

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

## License

MIT. See [LICENSE](./LICENSE).
