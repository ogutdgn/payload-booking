import type { Payload } from 'payload'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAvailabilityHandler,
  createBookHandler,
  createFormTokenHandler,
  createResourcesHandler,
  resolveServerOptions,
} from '@ogutdgn/payload-booking'

import {
  APPOINTMENTS,
  bootPayload,
  cleanAppointments,
  cleanBlackouts,
  getResource,
  resetSettings,
} from './helpers.js'
import { callEndpoint, capturedEmails, clearCapturedEmails } from './endpointHelpers.js'
import { bookingOptions } from '../bookingOptions.js'

const server = resolveServerOptions(bookingOptions)
const availability = createAvailabilityHandler(server)
const book = createBookHandler(server)
const formToken = createFormTokenHandler(server)
const resources = createResourcesHandler(server)

let payload: Payload
let resourceId: number | string

/** A token old enough to clear the three-second trap. */
const agedFormToken = async (): Promise<string> => {
  const { body } = await callEndpoint({ handler: formToken, path: '/form-token' })

  await new Promise((resolve) => setTimeout(resolve, 3100))

  return body.formToken as string
}

type Slot = { available: boolean; label: string; start: string }
type Day = { closed: boolean; date: string; slots: Slot[] }

const firstFreeSlot = async (): Promise<Slot> => {
  const { body } = await callEndpoint({ handler: availability, path: '/availability' })
  const days = body.days as Day[]
  const slot = days.flatMap((day) => day.slots).find((entry) => entry.available)

  if (!slot) {
    throw new Error('Expected at least one bookable slot in the seeded schedule.')
  }

  return slot
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  customer: {
    email: 'jane@example.com',
    name: 'Jane Doe',
    phone: '(512) 555-0111',
  },
  ...overrides,
})

beforeAll(async () => {
  payload = await bootPayload()
  resourceId = (await getResource(payload)).id
})

beforeEach(() => {
  clearCapturedEmails()
})

afterEach(async () => {
  await cleanAppointments(payload)
  await cleanBlackouts(payload)
  await resetSettings(payload)
})

afterAll(async () => {
  await payload.destroy()
})

describe('GET /availability', () => {
  it('returns days with server-rendered labels and the business timezone', async () => {
    const { body, status } = await callEndpoint({ handler: availability, path: '/availability' })

    expect(status).toBe(200)
    expect((body.meta as { timezone: string }).timezone).toBe('America/Chicago')

    const days = body.days as Day[]

    expect(days.length).toBe(14)

    const slot = days.flatMap((day) => day.slots)[0]

    // The browser never formats a time, so a label has to arrive with the slot.
    expect(slot.label).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
    expect(slot.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('includes the phone, so the form can say who to call when nothing is free', async () => {
    const { body } = await callEndpoint({ handler: availability, path: '/availability' })

    expect((body.meta as { phone: string }).phone).toBeTruthy()
  })

  it('reports a slot as taken once it is booked', async () => {
    const slot = await firstFreeSlot()

    await payload.create({
      collection: APPOINTMENTS as never,
      data: {
        customer: { email: 'x@example.com', name: 'X', phone: '1' },
        resource: resourceId,
        seat: 0,
        slotStart: slot.start,
        slotStart_tz: 'America/Chicago',
        status: 'confirmed',
      } as never,
      disableTransaction: true,
    })

    const { body } = await callEndpoint({ handler: availability, path: '/availability' })
    const days = body.days as Day[]
    const same = days.flatMap((day) => day.slots).find((entry) => entry.start === slot.start)

    // Proves the booked-count key matches what the generator produces, on this adapter.
    expect(same?.available).toBe(false)
  })

  it('answers 404 for a location that does not exist', async () => {
    const { body, status } = await callEndpoint({
      handler: availability,
      path: '/availability?resource=not-a-real-place',
    })

    expect(status).toBe(404)
    expect(body.error).toBe('resource_not_found')
  })

  it('accepts a location by its identifier as well as its id', async () => {
    const bySlug = await callEndpoint({
      handler: availability,
      path: '/availability?resource=showroom',
    })
    const byId = await callEndpoint({
      handler: availability,
      path: `/availability?resource=${String(resourceId)}`,
    })

    expect(bySlug.status).toBe(200)
    expect(byId.status).toBe(200)
  })
})

describe('GET /resources', () => {
  it('lists only what a chooser needs', async () => {
    const { body, status } = await callEndpoint({ handler: resources, path: '/resources' })
    const list = body.resources as Record<string, unknown>[]

    expect(status).toBe(200)
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'name', 'slug'])
  })
})

describe('GET /form-token', () => {
  it('issues a token with its expiry', async () => {
    const { body, status } = await callEndpoint({ handler: formToken, path: '/form-token' })

    expect(status).toBe(200)
    expect(body.formToken).toMatch(/^\d+\./)
    expect(Date.parse(body.expiresAt as string)).toBeGreaterThan(Date.now())
  })

  it('issues a different token each time, so the trap measures this page load', async () => {
    const first = await callEndpoint({ handler: formToken, path: '/form-token' })

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const second = await callEndpoint({ handler: formToken, path: '/form-token' })

    expect(first.body.formToken).not.toBe(second.body.formToken)
  })
})

describe('POST /book', () => {
  it('books a slot and emails both sides', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(201)
    expect(body.reference).toMatch(/^[0-9A-Z]{8}$/)
    expect(body.start).toBe(slot.start)
    expect(body.icsContent).toContain('METHOD:REQUEST')
    expect(body.googleCalendarUrl).toContain('calendar.google.com')

    const emails = capturedEmails()

    expect(emails).toHaveLength(2)
    expect(emails.map((email) => email.to)).toEqual(['jane@example.com', 'info@example.com'])
    expect(emails[0].attachments?.[0]?.contentType).toContain('method=REQUEST')
    expect(emails[0].text).toContain('Need to cancel?')

    const stored = (await payload.findByID({
      id: body.id as string,
      collection: APPOINTMENTS as never,
    })) as unknown as { emailLog: { event: string }[] }

    expect(stored.emailLog.map((entry) => entry.event)).toEqual([
      'customer.confirmed',
      'business.booked',
    ])
  })

  it('refuses a submission faster than a human can fill the form', async () => {
    const { body: tokenBody } = await callEndpoint({ handler: formToken, path: '/form-token' })
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: tokenBody.formToken, start: slot.start }),
      handler: book,
      path: '/book',
    })

    // Its own code, so the form waits and resubmits the same token rather than fetching a
    // new one and restarting the clock forever.
    expect(status).toBe(400)
    expect(body.error).toBe('token_too_fast')
  })

  it('refuses a forged token', async () => {
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: '1700000000.not-a-signature', start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(400)
    expect(body.error).toBe('token_invalid')
  })

  it('answers a honeypot hit exactly like a success, and writes nothing', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { status } = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start, website: 'http://spam.example' }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(201)

    const { totalDocs } = await payload.count({ collection: APPOINTMENTS as never })

    expect(totalDocs).toBe(0)
    expect(capturedEmails()).toHaveLength(0)
  })

  it('rejects a slot that was never offered', async () => {
    const token = await agedFormToken()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: token, start: '2030-01-01T05:00:00.000Z' }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(409)
    expect(body.error).toBe('slot_unavailable')
  })

  it('rejects a start that means the right instant but is spelled differently', async () => {
    // The membership check compares strings, so acceptance never depends on the server's
    // own timezone.
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start.replace('.000Z', 'Z') }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(409)
    expect(body.error).toBe('slot_unavailable')
  })

  it('rejects a slot someone else already took', async () => {
    const slot = await firstFreeSlot()

    await payload.create({
      collection: APPOINTMENTS as never,
      data: {
        customer: { email: 'first@example.com', name: 'First', phone: '1' },
        resource: resourceId,
        seat: 0,
        slotStart: slot.start,
        slotStart_tz: 'America/Chicago',
        status: 'confirmed',
      } as never,
      disableTransaction: true,
    })

    const token = await agedFormToken()
    const { body, status } = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(409)
    expect(body.error).toBe('slot_taken')
  })

  it('treats the same person resubmitting the same slot as already booked', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()

    const first = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(first.status).toBe(201)

    const second = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('already_booked')
    expect(second.body.reference).toBe(first.body.reference)

    const { totalDocs } = await payload.count({ collection: APPOINTMENTS as never })

    expect(totalDocs).toBe(1)
  })

  it('rejects a malformed body with field-level messages', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: {
        customer: { email: 'not-an-email', name: '', phone: '1' },
        formToken: token,
        start: slot.start,
      },
      handler: book,
      path: '/book',
    })

    expect(status).toBe(422)

    const paths = (body.errors as { path: string }[]).map((entry) => entry.path)

    expect(paths).toContain('customer.email')
    expect(paths).toContain('customer.name')
  })

  it('rejects an undeclared customer field rather than letting it through', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { status } = await callEndpoint({
      body: {
        customer: {
          email: 'jane@example.com',
          name: 'Jane',
          phone: '1',
          role: 'admin',
        },
        formToken: token,
        start: slot.start,
      },
      handler: book,
      path: '/book',
    })

    expect(status).toBe(422)
  })

  it('normalises the email, so the caps cannot be bypassed with capitals', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { body, status } = await callEndpoint({
      body: validBody({
        customer: { email: '  Jane@Example.COM ', name: 'Jane Doe', phone: '1' },
        formToken: token,
        start: slot.start,
      }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(201)

    const stored = (await payload.findByID({
      id: body.id as string,
      collection: APPOINTMENTS as never,
    })) as unknown as { customer: { email: string } }

    expect(stored.customer.email).toBe('jane@example.com')
  })

  it('refuses a fourth upcoming booking for one address', async () => {
    const { body } = await callEndpoint({ handler: availability, path: '/availability' })
    const slots = (body.days as Day[]).flatMap((day) => day.slots).filter((s) => s.available)

    for (let index = 0; index < 3; index += 1) {
      const token = await agedFormToken()
      const result = await callEndpoint({
        body: validBody({ formToken: token, start: slots[index].start }),
        handler: book,
        path: '/book',
      })

      expect(result.status).toBe(201)
    }

    const token = await agedFormToken()
    const fourth = await callEndpoint({
      body: validBody({ formToken: token, start: slots[3].start }),
      handler: book,
      path: '/book',
    })

    expect(fourth.status).toBe(429)
    expect(fourth.body.error).toBe('too_many')
  })

  it('does not count past visits against the upcoming cap', async () => {
    // Completed and no-show hold their slot, but they are history. Counting them would
    // lock a loyal customer out for good. `createdAt` is backdated too, so this measures
    // the upcoming cap rather than the separate per-hour rate cap.
    for (let index = 0; index < 3; index += 1) {
      const appointment = await payload.create({
        collection: APPOINTMENTS as never,
        data: {
          createdAt: `2024-0${index + 1}-14T15:00:00.000Z`,
          customer: { email: 'jane@example.com', name: 'Jane Doe', phone: '1' },
          resource: resourceId,
          seat: index,
          slotStart: `2024-0${index + 1}-15T15:00:00.000Z`,
          slotStart_tz: 'America/Chicago',
          status: 'confirmed',
        } as never,
        disableTransaction: true,
      })

      await payload.update({
        id: (appointment as unknown as { id: string }).id,
        collection: APPOINTMENTS as never,
        context: { bookingStatusChange: true },
        data: { status: 'completed' } as never,
      })
    }

    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { status } = await callEndpoint({
      body: validBody({ formToken: token, start: slot.start }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(201)
  })

  it('refuses a body larger than the cap without parsing it', async () => {
    const token = await agedFormToken()
    const slot = await firstFreeSlot()
    const { status } = await callEndpoint({
      body: validBody({
        formToken: token,
        message: 'x'.repeat(200_000),
        start: slot.start,
      }),
      handler: book,
      path: '/book',
    })

    expect(status).toBe(422)
  })
})
