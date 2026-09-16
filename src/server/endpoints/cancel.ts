import type { Payload, PayloadHandler, PayloadRequest } from 'payload'

import { z } from 'zod'

import type { BookingSettings } from '../availability.js'
import type { EmailLogEntry } from '../email/send.js'
import type { AppointmentRecord } from '../email/viewModels.js'
import type { ResolvedServerOptions } from '../options.js'

import { createFormatter } from '../../core/format.js'
import { buildIcs } from '../../core/ics.js'
import { verifyCancelToken } from '../../core/token.js'
import { CONTEXT_STATUS_CHANGE } from '../../payload/access.js'
import { collectionSlug } from '../../payload/slugs.js'
import { readSettings } from '../availability.js'
import { appendEmailLog, sendEmails } from '../email/send.js'
import {
  buildCancelledByBusinessViewModel,
  buildCancelledByCustomerViewModel,
} from '../email/viewModels.js'
import { buildSiteUrl, errorResponse, jsonResponse, readJsonBody } from '../options.js'

type StoredAppointment = {
  cancelledAt?: null | string
  emailLog?: EmailLogEntry[]
  status: string
} & AppointmentRecord

const loadAppointment = async (args: {
  id: number | string
  payload: Payload
  req?: PayloadRequest
  server: ResolvedServerOptions
}): Promise<null | StoredAppointment> => {
  try {
    return (await args.payload.findByID({
      id: args.id,
      collection: collectionSlug(args.server.slugs.appointments),
      depth: 0,
      req: args.req,
    })) as unknown as StoredAppointment
  } catch {
    return null
  }
}

/** Shared by both cancel paths, so the emails and the audit trail cannot drift apart. */
const applyCancellation = async (args: {
  appointment: StoredAppointment
  by: 'business' | 'customer'
  payload: Payload
  reason?: string
  req: PayloadRequest
  server: ResolvedServerOptions
  settings: BookingSettings
}): Promise<StoredAppointment> => {
  const { appointment, by, payload, reason, req, server, settings } = args

  // Written with access overridden and the context flag set. The flag is what the status
  // validator and the audit fields' access rules look for; without it Payload would refuse
  // the status change and silently drop the three audit fields.
  const updated = (await payload.update({
    id: appointment.id,
    collection: collectionSlug(server.slugs.appointments),
    context: { [CONTEXT_STATUS_CHANGE]: true },
    data: {
      cancellationReason: reason,
      cancelledAt: new Date().toISOString(),
      cancelledBy: by,
      status: 'cancelled',
    } as never,
  })) as unknown as StoredAppointment

  const timezone = appointment.slotStart_tz ?? settings.timezone ?? 'UTC'
  const formatter = createFormatter(timezone, server.labels)

  const entries =
    by === 'business'
      ? await sendEmails({
          payload,
          requests: [
            {
              attachment: {
                content: buildIcs({
                  attendeeEmail: appointment.customer?.email,
                  end: appointment.slotEnd ?? appointment.slotStart,
                  method: 'CANCEL',
                  now: new Date(),
                  organizerEmail: settings.notificationEmails?.[0]?.email,
                  sequence: 1,
                  start: appointment.slotStart,
                  summary: `Appointment with ${settings.location ?? 'us'}`,
                  uid: String(appointment.id),
                }),
                method: 'CANCEL',
              },
              event: 'customer.cancelledByBusiness',
              to: [appointment.customer?.email ?? ''].filter(Boolean),
              viewModel: buildCancelledByBusinessViewModel({
                appointment: { ...updated, customer: appointment.customer },
                payload,
                server,
                settings,
              }),
            },
          ],
          server,
        })
      : await sendEmails({
          payload,
          requests: [
            {
              event: 'business.cancelledByCustomer',
              to: (settings.notificationEmails ?? []).map((row) => row.email).filter(Boolean),
              viewModel: buildCancelledByCustomerViewModel({
                appointment: { ...updated, customer: appointment.customer },
                server,
                settings,
              }),
            },
          ],
          server,
        })

  await appendEmailLog({
    appointmentId: appointment.id,
    entries,
    existing: updated.emailLog ?? appointment.emailLog,
    payload,
    server,
  })

  try {
    await server.options.onAppointmentChange?.({
      doc: updated as unknown as Record<string, unknown>,
      event: 'cancelled',
      req,
    })
  } catch (error) {
    payload.logger.error(`[payload-booking] onAppointmentChange failed: ${String(error)}`)
  }

  void formatter

  return updated
}

/**
 * What the cancel page shows.
 *
 * Always 200 with a `state`, because "your link has expired" is something to render, not
 * an HTTP failure. Never returns the customer's email or phone: this URL travels through
 * email and link scanners open it.
 */
export const createAppointmentByTokenHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) => {
    const { payload } = req
    const now = new Date()
    const settings = await readSettings({ payload, server })
    const bookUrl =
      buildSiteUrl({
        options: server.options,
        path: server.options.routes.bookPath,
        payload,
      }) ?? ''

    const base = { bookUrl, phone: settings.phone ?? '' }
    const token = typeof req.query?.token === 'string' ? req.query.token : undefined
    const verified = verifyCancelToken({ now, secret: server.options.tokenSecret, token })

    if (verified.state === 'invalid') {
      return jsonResponse({ ...base, state: 'invalid' })
    }

    const appointment = await loadAppointment({
      id: verified.payload.a,
      payload,
      server,
    })

    if (!appointment) {
      return jsonResponse({ ...base, state: 'invalid' })
    }

    const timezone = appointment.slotStart_tz ?? settings.timezone ?? 'UTC'
    const formatter = createFormatter(timezone, server.labels)
    const view = {
      customerName: appointment.customer?.name ?? '',
      localDate: formatter.dateLabel(appointment.slotStart),
      localTime: formatter.timeLabel(appointment.slotStart),
      status: appointment.status,
      timezone,
    }

    // Order matters. Expiry is tested before "in the past" because the token expires a day
    // after the slot, so every expired token also has a passed start time and the expired
    // state would otherwise be unreachable.
    if (appointment.status === 'cancelled') {
      return jsonResponse({ ...base, appointment: view, state: 'cancelled' })
    }

    if (appointment.status === 'completed' || appointment.status === 'no-show') {
      return jsonResponse({ ...base, appointment: view, state: 'past' })
    }

    if (verified.state === 'expired') {
      return jsonResponse({ ...base, appointment: view, state: 'expired' })
    }

    if (Date.parse(String(appointment.slotStart)) <= now.getTime()) {
      return jsonResponse({ ...base, appointment: view, state: 'past' })
    }

    return jsonResponse({ ...base, appointment: view, state: 'valid' })
  }

/**
 * The customer's own cancellation. A POST, never a GET: mail clients and link scanners
 * prefetch links, and a mutating GET would cancel appointments nobody clicked.
 */
export const createCancelByTokenHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) => {
    const { payload } = req
    const now = new Date()
    const body = await readJsonBody(req)
    const parsed = z.object({ token: z.string().max(4096) }).safeParse(body ?? {})

    if (!parsed.success) {
      return errorResponse('token_invalid', 400)
    }

    const verified = verifyCancelToken({
      now,
      secret: server.options.tokenSecret,
      token: parsed.data.token,
    })

    if (verified.state === 'invalid') {
      return errorResponse('token_invalid', 400)
    }

    if (verified.state === 'expired') {
      return errorResponse('token_expired', 400)
    }

    const appointment = await loadAppointment({
      id: verified.payload.a,
      payload,
      server,
    })

    if (!appointment) {
      return errorResponse('token_invalid', 400)
    }

    // Idempotent: a second click renders "already cancelled" rather than an error.
    if (appointment.status === 'cancelled') {
      return jsonResponse({ state: 'cancelled' })
    }

    if (appointment.status !== 'confirmed') {
      return errorResponse('too_late', 410)
    }

    const settings = await readSettings({ payload, server })
    const cutoffMs = (settings.cancellationCutoffMinutes ?? 0) * 60_000
    const startsAt = Date.parse(String(appointment.slotStart))

    if (startsAt - cutoffMs <= now.getTime()) {
      return errorResponse('too_late', 410)
    }

    await applyCancellation({
      appointment,
      by: 'customer',
      payload,
      req,
      server,
      settings,
    })

    return jsonResponse({ state: 'cancelled' })
  }

/**
 * Evaluate the host's access rule, then act.
 *
 * Two steps on purpose. Payload only evaluates a `Where`-returning rule during an operation
 * with access enabled, but field access runs in that same mode and would silently drop the
 * audit fields. So permission is decided by a read, and the write overrides access.
 */
const authorise = async (args: {
  id: number | string
  req: PayloadRequest
  server: ResolvedServerOptions
}): Promise<{ appointment: StoredAppointment } | { response: Response }> => {
  const { id, req, server } = args

  if (!req.user) {
    return { response: errorResponse('unauthorized', 401) }
  }

  try {
    const appointment = (await req.payload.findByID({
      id,
      collection: collectionSlug(server.slugs.appointments),
      depth: 0,
      overrideAccess: false,
      req,
      user: req.user,
    })) as unknown as StoredAppointment

    return { appointment }
  } catch (error) {
    const status = (error as { status?: number }).status

    if (status === 403) {
      return { response: errorResponse('unauthorized', 403) }
    }

    return { response: errorResponse('not_found', 404) }
  }
}

export const createBusinessCancelHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) => {
    const id = req.routeParams?.id as number | string | undefined

    if (!id) {
      return errorResponse('not_found', 404)
    }

    const authorised = await authorise({ id, req, server })

    if ('response' in authorised) {
      return authorised.response
    }

    const { appointment } = authorised

    if (appointment.status !== 'confirmed') {
      return errorResponse('invalid_transition', 409, { status: appointment.status })
    }

    const body = await readJsonBody(req)
    const parsed = z
      .object({ reason: z.string().trim().max(500).optional() })
      .safeParse(body ?? {})

    const settings = await readSettings({ payload: req.payload, server })
    const updated = await applyCancellation({
      appointment,
      by: 'business',
      payload: req.payload,
      reason: parsed.success ? parsed.data.reason : undefined,
      req,
      server,
      settings,
    })

    return jsonResponse({
      id: appointment.id,
      cancelledAt: updated.cancelledAt ?? null,
      status: 'cancelled',
    })
  }

/** Mark completed or no-show. No emails: nothing changes for the customer. */
export const createMarkStatusHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) => {
    const id = req.routeParams?.id as number | string | undefined

    if (!id) {
      return errorResponse('not_found', 404)
    }

    const authorised = await authorise({ id, req, server })

    if ('response' in authorised) {
      return authorised.response
    }

    const { appointment } = authorised
    const body = await readJsonBody(req)
    const parsed = z
      .object({ status: z.enum(['completed', 'no-show']) })
      .safeParse(body ?? {})

    if (!parsed.success) {
      return jsonResponse(
        { errors: [{ message: 'Status must be completed or no-show.', path: 'status' }] },
        422,
      )
    }

    // Only a confirmed appointment whose time has passed. Marking a future one completed
    // would be a mistake with no way back, since nothing moves a row to confirmed again.
    if (appointment.status !== 'confirmed') {
      return errorResponse('invalid_transition', 409, { status: appointment.status })
    }

    if (Date.parse(String(appointment.slotStart)) > Date.now()) {
      return errorResponse('invalid_transition', 409, { status: appointment.status })
    }

    const updated = (await req.payload.update({
      id,
      collection: collectionSlug(server.slugs.appointments),
      context: { [CONTEXT_STATUS_CHANGE]: true },
      data: { status: parsed.data.status } as never,
    })) as unknown as StoredAppointment

    try {
      await server.options.onAppointmentChange?.({
        doc: updated as unknown as Record<string, unknown>,
        event: parsed.data.status,
        req,
      })
    } catch (error) {
      req.payload.logger.error(
        `[payload-booking] onAppointmentChange failed: ${String(error)}`,
      )
    }

    return jsonResponse({ id: appointment.id, status: parsed.data.status })
  }
