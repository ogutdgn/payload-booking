import type { Payload } from 'payload'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  APPOINTMENTS,
  BLACKOUTS,
  bootPayload,
  cleanAppointments,
  cleanBlackouts,
  createAppointment,
  expectRejection,
  futureSlot,
  getResource,
  resetSettings,
  RESOURCES,
  SETTINGS,
} from './helpers.js'

let payload: Payload
let resource: number | string

beforeAll(async () => {
  payload = await bootPayload()
  resource = (await getResource(payload)).id
})

afterEach(async () => {
  await cleanAppointments(payload)
  await cleanBlackouts(payload)
  // Settings are a single shared document, so a spec that edits them must put them back
  // or the next spec measures the wrong schedule.
  await resetSettings(payload)
})

afterAll(async () => {
  await payload.destroy()
})

describe('status guard', () => {
  it('refuses a status change that did not come from a plugin endpoint', async () => {
    // Without this, editing the dropdown would free the slot but send no email and record
    // no audit trail, leaving a customer expecting an appointment nobody has.
    const appointment = await createAppointment(payload, { resource, slotStart: futureSlot() })

    await expectRejection(
      payload.update({
        id: appointment.id as string,
        collection: APPOINTMENTS as never,
        data: { status: 'cancelled' } as never,
      }),
      /buttons on this page/,
    )
  })

  it('allows the same change when the endpoint flag is present', async () => {
    const appointment = await createAppointment(payload, { resource, slotStart: futureSlot() })

    await expect(
      payload.update({
        id: appointment.id as string,
        collection: APPOINTMENTS as never,
        context: { bookingStatusChange: true },
        data: { status: 'cancelled' } as never,
      }),
    ).resolves.toBeTruthy()
  })

  it('leaves unrelated edits alone', async () => {
    const appointment = await createAppointment(payload, { resource, slotStart: futureSlot() })

    const updated = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      data: { internalNotes: 'Customer called ahead' } as never,
    })) as unknown as { internalNotes: string; status: string }

    expect(updated.internalNotes).toBe('Customer called ahead')
    expect(updated.status).toBe('confirmed')
  })

  it('stores who cancelled and why when the endpoint writes them', async () => {
    // These three carry a context-gated rule rather than a flat denial: Payload silently
    // drops denied fields, so a flat denial would leave a cancelled appointment with no
    // record of who cancelled it or why, and the customer's email with an empty reason.
    const appointment = await createAppointment(payload, { resource, slotStart: futureSlot() })

    const cancelled = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: {
        cancellationReason: 'Showroom closed for a burst pipe',
        cancelledAt: new Date().toISOString(),
        cancelledBy: 'business',
        status: 'cancelled',
      } as never,
    })) as unknown as {
      cancellationReason: string
      cancelledAt: string
      cancelledBy: string
    }

    expect(cancelled.cancelledBy).toBe('business')
    expect(cancelled.cancelledAt).toBeTruthy()
    expect(cancelled.cancellationReason).toBe('Showroom closed for a burst pipe')
  })
})

describe('public write protection', () => {
  it('refuses to create an appointment without overriding access', async () => {
    await expect(
      payload.create({
        collection: APPOINTMENTS as never,
        data: {
          customer: { name: 'X', email: 'x@example.com', phone: '1' },
          resource,
          slotStart: futureSlot(),
          slotStart_tz: 'America/Chicago',
        } as never,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('silently discards an attempt to move an appointment to another time', async () => {
    // Field-level denial is silent by design in Payload: the value is dropped and the
    // stored one kept. Moving a booking has to go through cancel and rebook, because the
    // availability, notice and blackout rules only run in the endpoint.
    const slotStart = futureSlot()
    const appointment = await createAppointment(payload, { resource, slotStart })

    const updated = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      data: { slotStart: futureSlot(5) } as never,
      overrideAccess: false,
      user: { id: 1, collection: 'users', email: 'dev@payloadcms.com' } as never,
    })) as unknown as { slotStart: string }

    expect(new Date(updated.slotStart).toISOString()).toBe(slotStart)
  })

  it('silently discards an attempt to rewrite what the customer typed', async () => {
    const appointment = await createAppointment(payload, {
      name: 'Jane Doe',
      resource,
      slotStart: futureSlot(),
    })

    const updated = (await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      data: { customer: { name: 'Someone Else' } } as never,
      overrideAccess: false,
      user: { id: 1, collection: 'users', email: 'dev@payloadcms.com' } as never,
    })) as unknown as { customer: { name: string } }

    expect(updated.customer.name).toBe('Jane Doe')
  })
})

describe('closed dates', () => {
  it('refuses to close a day that already has appointments, naming the count', async () => {
    const appointment = (await createAppointment(payload, {
      resource,
      slotStart: '2026-10-21T15:00:00.000Z',
    })) as unknown as { slotLocalDate: string }

    expect(appointment.slotLocalDate).toBe('2026-10-21')

    await expectRejection(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-10-22', startDate: '2026-10-21' } as never,
      }),
      /1 appointment falls on 2026-10-21 to 2026-10-22\. Cancel them first/,
    )
  })

  it('allows closing a day once the appointments there are cancelled', async () => {
    const appointment = await createAppointment(payload, {
      resource,
      slotStart: '2026-10-21T15:00:00.000Z',
    })

    await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'cancelled' } as never,
    })

    await expect(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-10-21', startDate: '2026-10-21' } as never,
      }),
    ).resolves.toBeTruthy()
  })

  it('allows closing a day that has none', async () => {
    await createAppointment(payload, { resource, slotStart: '2026-10-21T15:00:00.000Z' })

    await expect(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-11-11', startDate: '2026-11-10' } as never,
      }),
    ).resolves.toBeTruthy()
  })

  it('counts completed and no-show appointments too', async () => {
    const appointment = await createAppointment(payload, {
      resource,
      slotStart: '2026-10-21T15:00:00.000Z',
    })

    await payload.update({
      id: appointment.id as string,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status: 'completed' } as never,
    })

    await expectRejection(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-10-21', startDate: '2026-10-21' } as never,
      }),
      /1 appointment falls/,
    )
  })

  it('rejects a range that ends before it starts', async () => {
    await expectRejection(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-10-20', startDate: '2026-10-22' } as never,
      }),
      /cannot be before/,
    )
  })

  it('rejects a date that is not a real calendar day', async () => {
    await expectRejection(
      payload.create({
        collection: BLACKOUTS as never,
        data: { endDate: '2026-02-30', startDate: '2026-02-30' } as never,
      }),
      /Use a date in the form 2026-10-21/,
    )
  })
})

describe('settings validation', () => {
  it('refuses start times closer together than an appointment is long', async () => {
    await expectRejection(
      payload.updateGlobal({
        slug: SETTINGS as never,
        data: {
          weeklySchedule: {
            monday: { open: true, sessionStarts: [{ time: '10:00' }, { time: '10:30' }] },
          },
        } as never,
      }),
      /Monday — 10:00 and 10:30 overlap: slots are 60 minutes long/,
    )
  })

  it('refuses a duration change that would make the existing week overlap', async () => {
    await payload.updateGlobal({
      slug: SETTINGS as never,
      data: {
        slotDurationMinutes: 30,
        weeklySchedule: {
          monday: { open: true, sessionStarts: [{ time: '10:00' }, { time: '10:30' }] },
        },
      } as never,
    })

    await expectRejection(
      payload.updateGlobal({
        slug: SETTINGS as never,
        data: { slotDurationMinutes: 60 } as never,
      }),
      /10:00 and 10:30 overlap/,
    )
  })

  it('refuses a session that would run past midnight', async () => {
    await expectRejection(
      payload.updateGlobal({
        slug: SETTINGS as never,
        data: {
          weeklySchedule: { monday: { open: true, sessionStarts: [{ time: '23:30' }] } },
        } as never,
      }),
      /23:30 plus 60 minutes crosses midnight/,
    )
  })
})

describe('seeding', () => {
  it('leaves exactly one location and a filled-in settings document', async () => {
    const { totalDocs } = await payload.count({ collection: RESOURCES as never })
    const settings = (await payload.findGlobal({ slug: SETTINGS as never })) as {
      location: string
      phone: string
      timezone: string
    }

    expect(totalDocs).toBe(1)
    expect(settings.timezone).toBe('America/Chicago')
    expect(settings.location).toContain('Austin')
    expect(settings.phone).toBeTruthy()
  })

  it('generates the location identifier from its name', async () => {
    const { docs } = await payload.find({ collection: RESOURCES as never, limit: 1 })

    expect((docs[0] as unknown as { slug: string }).slug).toBe('showroom')
  })
})
