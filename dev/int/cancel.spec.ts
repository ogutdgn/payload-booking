import type { Payload } from 'payload'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAppointmentByTokenHandler,
  createAvailabilityHandler,
  createBusinessCancelHandler,
  createCancelByTokenHandler,
  createMarkStatusHandler,
  resolveServerOptions,
  signCancelToken,
} from '@ogutdgn/payload-booking'

import { bookingOptions } from '../bookingOptions.js'
import { callEndpoint, capturedEmails, clearCapturedEmails, loginDevUser } from './endpointHelpers.js'
import {
  APPOINTMENTS,
  bootPayload,
  cleanAppointments,
  getResource,
  resetSettings,
} from './helpers.js'

const server = resolveServerOptions(bookingOptions)
const availability = createAvailabilityHandler(server)
const byToken = createAppointmentByTokenHandler(server)
const cancelByToken = createCancelByTokenHandler(server)
const businessCancel = createBusinessCancelHandler(server)
const markStatus = createMarkStatusHandler(server)

const SECRET = bookingOptions.tokenSecret

let payload: Payload
let resourceId: number | string
let token: string

type Appointment = { id: number | string; slotStart: string; status: string }

/**
 * A start the schedule actually offers.
 *
 * An invented instant would not appear in availability at all, so a test asserting that
 * cancelling frees the slot would look for something that was never there.
 */
const realFreeSlotStart = async (): Promise<string> => {
  const { body } = await callEndpoint({ handler: availability, path: '/availability' })
  const slot = (body.days as { slots: { available: boolean; start: string }[] }[])
    .flatMap((day) => day.slots)
    .find((entry) => entry.available)

  if (!slot) {
    throw new Error('Expected a bookable slot in the seeded schedule.')
  }

  return slot.start
}

const createBooking = async (args: {
  hoursFromNow?: number
  status?: string
  useRealSlot?: boolean
}): Promise<Appointment> => {
  if (args.useRealSlot) {
    return await createBookingAt(await realFreeSlotStart(), args.status)
  }

  const start = new Date(Date.now() + (args.hoursFromNow ?? 72) * 3_600_000)

  start.setUTCMinutes(0, 0, 0)

  return await createBookingAt(start.toISOString(), args.status)
}

const createBookingAt = async (
  slotStart: string,
  status?: string,
): Promise<Appointment> => {
  const created = (await payload.create({
    collection: APPOINTMENTS as never,
    data: {
      customer: { email: 'jane@example.com', name: 'Jane Doe', phone: '(512) 555-0111' },
      resource: resourceId,
      seat: 0,
      slotEnd: new Date(Date.parse(slotStart) + 3_600_000).toISOString(),
      slotStart,
      slotStart_tz: 'America/Chicago',
      status: 'confirmed',
    } as never,
    disableTransaction: true,
  })) as unknown as Appointment

  if (status && status !== 'confirmed') {
    return (await payload.update({
      id: created.id,
      collection: APPOINTMENTS as never,
      context: { bookingStatusChange: true },
      data: { status } as never,
    })) as unknown as Appointment
  }

  return created
}

const tokenFor = (appointment: Appointment, expiresAt?: Date): string =>
  signCancelToken({
    appointmentId: appointment.id,
    expiresAt: expiresAt ?? new Date(Date.parse(appointment.slotStart) + 24 * 3_600_000),
    secret: SECRET,
  })

beforeAll(async () => {
  payload = await bootPayload()
  resourceId = (await getResource(payload)).id
  token = await loginDevUser(payload)
})

beforeEach(() => {
  clearCapturedEmails()
})

afterEach(async () => {
  await cleanAppointments(payload)
  await resetSettings(payload)
})

afterAll(async () => {
  await payload.destroy()
})

describe('GET /appointment-by-token', () => {
  it('shows the appointment without revealing how to contact the customer', async () => {
    const appointment = await createBooking({})
    const { body, status } = await callEndpoint({
      handler: byToken,
      path: `/appointment-by-token?token=${tokenFor(appointment)}`,
    })

    expect(status).toBe(200)
    expect(body.state).toBe('valid')

    const view = body.appointment as Record<string, unknown>

    // This URL travels through email and link scanners open it, so it carries a name and a
    // time and nothing else.
    expect(view.customerName).toBe('Jane Doe')
    expect(Object.keys(view).sort()).toEqual([
      'customerName',
      'localDate',
      'localTime',
      'status',
      'timezone',
    ])
    expect(body.phone).toBeTruthy()
  })

  it('answers 200 with a state rather than an error, so the page always renders', async () => {
    const { body, status } = await callEndpoint({
      handler: byToken,
      path: '/appointment-by-token?token=rubbish',
    })

    expect(status).toBe(200)
    expect(body.state).toBe('invalid')
    expect(body.appointment).toBeUndefined()
    expect(body.phone).toBeTruthy()
  })

  it('distinguishes expired from past', async () => {
    // The token outlives the slot by a day, so every expired token also has a passed start
    // time. Testing expiry first is what keeps the expired state reachable at all.
    const appointment = await createBooking({ hoursFromNow: -48 })
    const expired = tokenFor(appointment, new Date(Date.now() - 3_600_000))
    const live = tokenFor(appointment, new Date(Date.now() + 3_600_000))

    const expiredResult = await callEndpoint({
      handler: byToken,
      path: `/appointment-by-token?token=${expired}`,
    })
    const pastResult = await callEndpoint({
      handler: byToken,
      path: `/appointment-by-token?token=${live}`,
    })

    expect(expiredResult.body.state).toBe('expired')
    expect(pastResult.body.state).toBe('past')
  })

  it('reports an already cancelled appointment', async () => {
    const appointment = await createBooking({ status: 'cancelled' })
    const { body } = await callEndpoint({
      handler: byToken,
      path: `/appointment-by-token?token=${tokenFor(appointment)}`,
    })

    expect(body.state).toBe('cancelled')
  })

  it('reports a completed appointment as past', async () => {
    const appointment = await createBooking({ hoursFromNow: -48, status: 'completed' })
    const { body } = await callEndpoint({
      handler: byToken,
      path: `/appointment-by-token?token=${tokenFor(appointment)}`,
    })

    expect(body.state).toBe('past')
  })
})

describe('POST /cancel-by-token', () => {
  it('cancels, frees the slot and tells the business', async () => {
    const appointment = await createBooking({ useRealSlot: true })
    const { body, status } = await callEndpoint({
      body: { token: tokenFor(appointment) },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    expect(status).toBe(200)
    expect(body.state).toBe('cancelled')

    const emails = capturedEmails()

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('info@example.com')
    expect(emails[0].subject).toContain('Cancelled')

    const stored = (await payload.findByID({
      id: appointment.id,
      collection: APPOINTMENTS as never,
    })) as unknown as { cancelledBy: string; slotLockKey: string; status: string }

    expect(stored.status).toBe('cancelled')
    expect(stored.cancelledBy).toBe('customer')
    expect(stored.slotLockKey).toContain('released#')

    const { body: fresh } = await callEndpoint({ handler: availability, path: '/availability' })
    const slots = (fresh.days as { slots: { available: boolean; start: string }[] }[]).flatMap(
      (day) => day.slots,
    )

    expect(slots.find((slot) => slot.start === appointment.slotStart)?.available).toBe(true)
  })

  it('is idempotent, because a second click is a person being unsure', async () => {
    const appointment = await createBooking({})
    const cancelToken = tokenFor(appointment)

    const first = await callEndpoint({
      body: { token: cancelToken },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    clearCapturedEmails()

    const second = await callEndpoint({
      body: { token: cancelToken },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.state).toBe('cancelled')
    // No second email: the business is told once.
    expect(capturedEmails()).toHaveLength(0)
  })

  it('refuses a tampered or expired token with distinct codes', async () => {
    const appointment = await createBooking({})

    const tampered = await callEndpoint({
      body: { token: `${tokenFor(appointment).split('.')[0]}.forged` },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })
    const expired = await callEndpoint({
      body: { token: tokenFor(appointment, new Date(Date.now() - 1000)) },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    expect(tampered.status).toBe(400)
    expect(tampered.body.error).toBe('token_invalid')
    expect(expired.status).toBe(400)
    expect(expired.body.error).toBe('token_expired')
  })

  it('refuses once the slot has started', async () => {
    const appointment = await createBooking({ hoursFromNow: -2 })
    const { body, status } = await callEndpoint({
      body: { token: tokenFor(appointment) },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    expect(status).toBe(410)
    expect(body.error).toBe('too_late')
  })

  it('honours a cancellation cutoff', async () => {
    await payload.updateGlobal({
      slug: 'booking-settings' as never,
      data: { cancellationCutoffMinutes: 24 * 60 } as never,
    })

    const appointment = await createBooking({ hoursFromNow: 12 })
    const { body, status } = await callEndpoint({
      body: { token: tokenFor(appointment) },
      handler: cancelByToken,
      path: '/cancel-by-token',
    })

    expect(status).toBe(410)
    expect(body.error).toBe('too_late')
  })
})

describe('POST /appointments/:id/cancel', () => {
  it('refuses without a session', async () => {
    const appointment = await createBooking({})
    const { body, status } = await callEndpoint({
      body: {},
      handler: businessCancel,
      path: `/appointments/${String(appointment.id)}/cancel`,
      routeParams: { id: appointment.id },
    })

    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
  })

  it('cancels, records who and why, and emails the customer with the reason', async () => {
    const appointment = await createBooking({})
    const { body, status } = await callEndpoint({
      body: { reason: 'Showroom closed for a burst pipe' },
      handler: businessCancel,
      path: `/appointments/${String(appointment.id)}/cancel`,
      routeParams: { id: appointment.id },
      token,
    })

    expect(status).toBe(200)
    expect(body.status).toBe('cancelled')
    expect(body.cancelledAt).toBeTruthy()

    // The audit fields are the reason these three carry a context-gated rule rather than a
    // flat denial: a flat denial would have dropped them silently.
    const stored = (await payload.findByID({
      id: appointment.id,
      collection: APPOINTMENTS as never,
    })) as unknown as {
      cancellationReason: string
      cancelledAt: string
      cancelledBy: string
    }

    expect(stored.cancelledBy).toBe('business')
    expect(stored.cancelledAt).toBeTruthy()
    expect(stored.cancellationReason).toBe('Showroom closed for a burst pipe')

    const emails = capturedEmails()

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('jane@example.com')
    expect(emails[0].text).toContain('Showroom closed for a burst pipe')
    expect(emails[0].attachments?.[0]?.contentType).toContain('method=CANCEL')
  })

  it('refuses to cancel something that is not confirmed', async () => {
    const appointment = await createBooking({ status: 'cancelled' })
    const { body, status } = await callEndpoint({
      body: {},
      handler: businessCancel,
      path: `/appointments/${String(appointment.id)}/cancel`,
      routeParams: { id: appointment.id },
      token,
    })

    expect(status).toBe(409)
    expect(body.error).toBe('invalid_transition')
  })

  it('answers 404 for an id that does not exist', async () => {
    const { status } = await callEndpoint({
      body: {},
      handler: businessCancel,
      path: '/appointments/999999/cancel',
      routeParams: { id: 999999 },
      token,
    })

    expect(status).toBe(404)
  })
})

describe('POST /appointments/:id/status', () => {
  it('marks a past appointment completed, silently', async () => {
    const appointment = await createBooking({ hoursFromNow: -4 })
    const { body, status } = await callEndpoint({
      body: { status: 'completed' },
      handler: markStatus,
      path: `/appointments/${String(appointment.id)}/status`,
      routeParams: { id: appointment.id },
      token,
    })

    expect(status).toBe(200)
    expect(body.status).toBe('completed')
    // Nothing changes for the customer, so nothing is sent.
    expect(capturedEmails()).toHaveLength(0)
  })

  it('keeps holding the slot after being marked completed', async () => {
    const appointment = await createBooking({ hoursFromNow: -4 })

    await callEndpoint({
      body: { status: 'no-show' },
      handler: markStatus,
      path: `/appointments/${String(appointment.id)}/status`,
      routeParams: { id: appointment.id },
      token,
    })

    const stored = (await payload.findByID({
      id: appointment.id,
      collection: APPOINTMENTS as never,
    })) as unknown as { slotLockKey: string }

    expect(stored.slotLockKey).not.toContain('released#')
  })

  it('refuses an appointment that has not happened yet', async () => {
    const appointment = await createBooking({ hoursFromNow: 48 })
    const { body, status } = await callEndpoint({
      body: { status: 'completed' },
      handler: markStatus,
      path: `/appointments/${String(appointment.id)}/status`,
      routeParams: { id: appointment.id },
      token,
    })

    expect(status).toBe(409)
    expect(body.error).toBe('invalid_transition')
  })

  it('refuses a status outside completed and no-show', async () => {
    const appointment = await createBooking({ hoursFromNow: -4 })
    const { status } = await callEndpoint({
      body: { status: 'confirmed' },
      handler: markStatus,
      path: `/appointments/${String(appointment.id)}/status`,
      routeParams: { id: appointment.id },
      token,
    })

    expect(status).toBe(422)
  })

  it('refuses without a session', async () => {
    const appointment = await createBooking({ hoursFromNow: -4 })
    const { status } = await callEndpoint({
      body: { status: 'completed' },
      handler: markStatus,
      path: `/appointments/${String(appointment.id)}/status`,
      routeParams: { id: appointment.id },
    })

    expect(status).toBe(401)
  })
})
