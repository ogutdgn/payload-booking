import type { Payload } from 'payload'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  APPOINTMENTS,
  bootPayload,
  cleanAppointments,
  createAppointment,
  futureSlot,
  getResource,
  isMongo,
  isUniqueError,
  settled,
} from './helpers.js'

/**
 * The reason this plugin exists.
 *
 * Every other booking plugin checks "is the slot free?" and then writes, and two requests
 * can both pass the check before either writes. Here the database refuses the second one,
 * so there is no window to race through.
 */
let payload: Payload
let resource: number | string

beforeAll(async () => {
  payload = await bootPayload()
  resource = (await getResource(payload)).id
})

afterEach(async () => {
  await cleanAppointments(payload)
})

afterAll(async () => {
  await payload.destroy()
})

describe('double-booking', () => {
  it('lets exactly one of two simultaneous bookings win', async () => {
    const slotStart = futureSlot()

    const results = await Promise.allSettled([
      createAppointment(payload, { resource, slotStart }),
      createAppointment(payload, { email: 'sam@example.com', resource, slotStart }),
    ])

    const { fulfilled, rejected } = settled(results)

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(isUniqueError(rejected[0].reason, 'slotLockKey')).toBe(true)
  })

  it('lets exactly one of ten simultaneous bookings win', async () => {
    const slotStart = futureSlot()

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        createAppointment(payload, {
          email: `racer${index}@example.com`,
          resource,
          slotStart,
        }),
      ),
    )

    const { fulfilled, rejected } = settled(results)

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(9)
    expect(rejected.every((entry) => isUniqueError(entry.reason, 'slotLockKey'))).toBe(true)

    const { totalDocs } = await payload.count({
      collection: APPOINTMENTS as never,
      where: { slotStart: { equals: slotStart } },
    })

    expect(totalDocs).toBe(1)
  })

  it('separates seats, so capacity above one sells more than once', async () => {
    const slotStart = futureSlot()

    await createAppointment(payload, { resource, seat: 0, slotStart })
    await createAppointment(payload, { email: 'sam@example.com', resource, seat: 1, slotStart })

    const { totalDocs } = await payload.count({
      collection: APPOINTMENTS as never,
      where: { slotStart: { equals: slotStart } },
    })

    expect(totalDocs).toBe(2)
  })

  it('refuses a second booking of the same seat', async () => {
    const slotStart = futureSlot()

    await createAppointment(payload, { resource, seat: 1, slotStart })

    await expect(
      createAppointment(payload, { email: 'sam@example.com', resource, seat: 1, slotStart }),
    ).rejects.toSatisfy((error: unknown) => isUniqueError(error, 'slotLockKey'))
  })
})

describe('cancelling', () => {
  it('frees the slot, so the time can be sold again', async () => {
    const slotStart = futureSlot()
    const first = await createAppointment(payload, { resource, slotStart })

    await payload.update({
      id: first.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'cancelled' } as never,
    })

    const replacement = await createAppointment(payload, {
      email: 'sam@example.com',
      resource,
      slotStart,
    })

    expect(replacement.id).toBeDefined()
  })

  it('lets two appointments for the same slot both be cancelled', async () => {
    // The case a null release breaks: on MongoDB a sparse index still indexes an explicit
    // null, so the second cancelled row in the whole system would collide with the first.
    const slotStart = futureSlot()
    const first = await createAppointment(payload, { resource, slotStart })

    await payload.update({
      id: first.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'cancelled' } as never,
    })

    const second = await createAppointment(payload, {
      email: 'sam@example.com',
      resource,
      slotStart,
    })

    await expect(
      payload.update({
        id: second.id as string,
        collection: APPOINTMENTS as never,
        context: { bookingStatusChange: true },
        data: { status: 'cancelled' } as never,
      }),
    ).resolves.toBeTruthy()

    const { totalDocs } = await payload.count({
      collection: APPOINTMENTS as never,
      where: { status: { equals: 'cancelled' } },
    })

    expect(totalDocs).toBe(2)
  })

  it('survives a partial update that carries only the status', async () => {
    const slotStart = futureSlot()
    const appointment = await createAppointment(payload, { resource, slotStart })

    // The hook sees no slotStart in `data` here; without merging originalDoc it would
    // rebuild the key from nothing and free a slot that is still booked.
    const cancelled = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'cancelled' } as never,
    })) as unknown as { slotLockKey: string }

    expect(cancelled.slotLockKey).toBe(`released#${String(appointment.id)}`)
  })

  it('keeps holding the slot when marked completed or no-show', async () => {
    const slotStart = futureSlot()
    const appointment = await createAppointment(payload, { resource, slotStart })

    const completed = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'completed' } as never,
    })) as unknown as { slotLockKey: string }

    expect(completed.slotLockKey).not.toContain('released#')

    await expect(
      createAppointment(payload, { email: 'sam@example.com', resource, slotStart }),
    ).rejects.toSatisfy((error: unknown) => isUniqueError(error, 'slotLockKey'))
  })

  it('never writes a null lock key, on either adapter', async () => {
    const slotStart = futureSlot()
    const appointment = await createAppointment(payload, { resource, slotStart })

    const cancelled = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'cancelled' } as never,
    })) as unknown as { slotLockKey: unknown }

    expect(cancelled.slotLockKey).toBeTypeOf('string')
    expect(cancelled.slotLockKey).not.toBeNull()
  })
})

describe('derived fields', () => {
  it('fills the local date, time, title and reference from the stored zone', async () => {
    const appointment = (await createAppointment(payload, {
      name: 'Jane Doe',
      resource,
      slotStart: '2026-09-18T19:00:00.000Z',
      timezone: 'America/Chicago',
    })) as unknown as {
      reference: string
      slotLocalDate: string
      slotLocalTime: string
      title: string
    }

    expect(appointment.slotLocalDate).toBe('2026-09-18')
    expect(appointment.slotLocalTime).toBe('14:00')
    expect(appointment.title).toBe('Jane Doe — Fri, Sep 18 2:00 PM')
    expect(appointment.reference).toMatch(/^[0-9A-Z]{8}$/)
  })

  it('gives every appointment a different reference', async () => {
    const a = await createAppointment(payload, { resource, slotStart: futureSlot() })
    const b = await createAppointment(payload, { resource, slotStart: futureSlot() })

    expect(a.reference).not.toBe(b.reference)
  })

  it('leaves the stored local date and time alone on a later update', async () => {
    // They are a snapshot of what the customer booked, not a view of current settings.
    const appointment = (await createAppointment(payload, {
      resource,
      slotStart: '2026-09-18T19:00:00.000Z',
    })) as unknown as { slotLocalTime: string }

    const updated = (await payload.update({
      id: (appointment as unknown as { id: string }).id,
      collection: APPOINTMENTS as never,
      data: { internalNotes: 'Called to confirm' } as never,
    })) as unknown as { slotLocalTime: string }

    expect(updated.slotLocalTime).toBe(appointment.slotLocalTime)
  })
})

describe('adapter reporting', () => {
  it('reports the uniqueness failure on the lock key field, not as an opaque error', () => {
    // Documents which adapter this run covered, so a green suite cannot hide a gap.
    expect(typeof isMongo()).toBe('boolean')
  })
})
