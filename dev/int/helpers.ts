import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'

export const APPOINTMENTS = 'appointments'
export const RESOURCES = 'booking-resources'
export const BLACKOUTS = 'booking-blackout-dates'
export const SETTINGS = 'booking-settings'

/**
 * Boot Payload once per spec file.
 *
 * Integration files run serially: each `getPayload` pushes the schema to the one test
 * database, and two doing that at the same time race.
 *
 * On Mongo the first writes against a fresh replica set fail with transient lock and
 * catalog errors, so a throw-away document is created and deleted before any assertion.
 */
export const bootPayload = async (): Promise<Payload> => {
  const payload = await getPayload({ config })

  if (process.env.DB_ADAPTER === 'mongo') {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const warmUp = (await payload.create({
          collection: BLACKOUTS as never,
          data: { endDate: '1999-01-01', startDate: '1999-01-01' } as never,
        })) as unknown as { id: number | string }

        await payload.delete({ id: warmUp.id, collection: BLACKOUTS as never })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  return payload
}

export const isMongo = (): boolean => process.env.DB_ADAPTER === 'mongo'

/** The seeded showroom. */
export const getResource = async (payload: Payload): Promise<{ id: number | string }> => {
  const { docs } = await payload.find({
    collection: RESOURCES as never,
    depth: 0,
    limit: 1,
    where: { slug: { equals: 'showroom' } },
  })

  if (!docs[0]) {
    throw new Error('Expected the seeded showroom. Did onInit run?')
  }

  return docs[0] as { id: number | string }
}

let counter = 0

/** A start instant far enough ahead that the notice rule never interferes. */
export const futureSlot = (offsetHours = 0): string => {
  counter += 1

  const base = new Date()

  base.setUTCDate(base.getUTCDate() + 30)
  base.setUTCHours(15 + offsetHours + counter, 0, 0, 0)

  return base.toISOString()
}

export type BookingSeed = {
  email?: string
  name?: string
  resource: number | string
  seat?: number
  slotStart: string
  status?: string
  timezone?: string
}

/**
 * Create an appointment the way the book endpoint will: the Local API with access
 * overridden, no transaction, and the companion timezone supplied on create.
 */
export const createAppointment = async (
  payload: Payload,
  seed: BookingSeed,
): Promise<Record<string, unknown>> =>
  (await payload.create({
    collection: APPOINTMENTS as never,
    data: {
      customer: {
        name: seed.name ?? 'Jane Doe',
        email: seed.email ?? 'jane@example.com',
        phone: '(512) 555-0111',
      },
      resource: seed.resource,
      seat: seed.seat ?? 0,
      slotEnd: new Date(Date.parse(seed.slotStart) + 3_600_000).toISOString(),
      slotStart: seed.slotStart,
      slotStart_tz: seed.timezone ?? 'America/Chicago',
      status: seed.status ?? 'confirmed',
    } as never,
    // Each attempt is independent and self-committing. Under a transaction on Mongo the
    // loser of a race surfaces as a raw WriteConflict instead of a field-level uniqueness
    // error, which is exactly what the seat loop must not have to special-case.
    disableTransaction: true,
  })) as unknown as Record<string, unknown>

/** A uniqueness failure on a specific field, whichever adapter raised it. */
export const isUniqueError = (error: unknown, path: string): boolean => {
  const errors = (error as { data?: { errors?: { path?: string }[] } })?.data?.errors

  return Array.isArray(errors) && errors.some((entry) => entry.path === path)
}

export const settled = <T>(results: PromiseSettledResult<T>[]) => ({
  fulfilled: results.filter(
    (r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled',
  ),
  rejected: results.filter((r): r is PromiseRejectedResult => r.status === 'rejected'),
})

/** Remove everything a spec created, so files do not depend on each other's leftovers. */
export const cleanAppointments = async (payload: Payload): Promise<void> => {
  await payload.delete({
    collection: APPOINTMENTS as never,
    where: { id: { exists: true } },
  })
}

export const cleanBlackouts = async (payload: Payload): Promise<void> => {
  await payload.delete({
    collection: BLACKOUTS as never,
    where: { id: { exists: true } },
  })
}

/**
 * Payload's ValidationError carries a generic `message` ("The following field is invalid:
 * X"); the sentence the owner actually reads is on the field entry. Tests assert on that,
 * because a readable message is a deliverable, not an implementation detail.
 */
export const validationMessages = (error: unknown): string[] => {
  const errors = (error as { data?: { errors?: { message?: string }[] } })?.data?.errors

  return Array.isArray(errors) ? errors.map((entry) => entry.message ?? '') : []
}

export const expectRejection = async (
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> => {
  try {
    await promise
  } catch (error) {
    const messages = validationMessages(error)
    const combined = [...messages, (error as Error)?.message ?? ''].join(' | ')

    if (!pattern.test(combined)) {
      throw new Error(`Expected a rejection matching ${pattern}, got: ${combined}`)
    }

    return
  }

  throw new Error(`Expected a rejection matching ${pattern}, but it resolved.`)
}

/** The values the plugin seeds, restored so specs never inherit each other's edits. */
export const SEED_SETTINGS = {
  bookingWindow: { mode: 'rolling-days', rollingDays: 14 },
  cancellationCutoffMinutes: 0,
  capacityPerSlot: 1,
  location: '2112 Rutland Dr #150, Austin, TX 78758',
  minNoticeMinutes: 120,
  notificationEmails: [{ email: 'info@example.com' }],
  phone: '(512) 555-0100',
  slotDurationMinutes: 60,
  timezone: 'America/Chicago',
  weeklySchedule: {
    friday: { open: true, sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'] },
    monday: { open: true, sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'] },
    saturday: { open: true, sessionStarts: ['10:00', '11:00', '13:00', '14:00'] },
    sunday: { open: false, sessionStarts: [] },
    thursday: { open: true, sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'] },
    tuesday: { open: true, sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'] },
    wednesday: { open: true, sessionStarts: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'] },
  },
}

export const resetSettings = async (payload: Payload): Promise<void> => {
  await payload.updateGlobal({
    slug: SETTINGS as never,
    data: {
      ...SEED_SETTINGS,
      weeklySchedule: Object.fromEntries(
        Object.entries(SEED_SETTINGS.weeklySchedule).map(([day, entry]) => [
          day,
          { open: entry.open, sessionStarts: entry.sessionStarts.map((time) => ({ time })) },
        ]),
      ),
    } as never,
  })
}
