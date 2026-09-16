import type { PayloadHandler } from 'payload'

import { z } from 'zod'

import type { AppointmentRecord } from '../email/viewModels.js'
import type { ResolvedServerOptions } from '../options.js'

import { buildIcs, googleCalendarUrl } from '../../core/ics.js'
import { generateReference } from '../../core/reference.js'
import { findSlot } from '../../core/slots.js'
import { signCancelToken } from '../../core/token.js'
import { collectionSlug } from '../../payload/slugs.js'
import { computeAvailability, resolveSlotConfig } from '../availability.js'
import { appendEmailLog, sendEmails } from '../email/send.js'
import {
  buildBookedViewModel,
  buildConfirmedViewModel,
} from '../email/viewModels.js'
import {
  checkCaps,
  checkChallenge,
  checkFormToken,
  findExistingBooking,
  resolveClientIp,
  resolveIpHash,
} from '../guards.js'
import {
  buildSiteUrl,
  errorResponse,
  isValidationError,
  jsonResponse,
  readJsonBody,
  validationErrorEntries,
  validationResponse,
} from '../options.js'
import { resolveResource } from '../resource.js'

/**
 * `start` is a string and is never coerced.
 *
 * It is compared verbatim against the instants the server just generated. Parsing it first
 * would accept equivalent spellings whose acceptance depends on the server's timezone, and
 * the whole design rests on the client echoing back an opaque value.
 */
const buildSchema = (server: ResolvedServerOptions) => {
  const customFieldNames = (server.options.customerFields ?? [])
    .map((field) => ('name' in field ? field.name : null))
    .filter((name): name is string => Boolean(name))

  const customerShape: Record<string, z.ZodTypeAny> = {
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    phone: z.string().trim().min(1).max(40),
  }

  for (const name of customFieldNames) {
    customerShape[name] = z.union([z.string().max(500), z.number(), z.boolean()]).optional()
  }

  return z
    .object({
      challengeToken: z.string().max(4096).optional(),
      [server.honeypotField]: z.unknown().optional(),
      // Built from the declared custom fields, so an undeclared key is refused here rather
      // than relying on the database to drop it.
      customer: z.object(customerShape).strict(),
      formToken: z.string().max(512),
      message: z.string().trim().max(2000).optional(),
      resource: z.string().max(200).optional(),
      source: z
        .object({
          page: z.string().max(2048).optional(),
          referrer: z.string().max(2048).optional(),
          utmCampaign: z.string().max(200).optional(),
          utmMedium: z.string().max(200).optional(),
          utmSource: z.string().max(200).optional(),
        })
        .strict()
        .optional(),
      start: z.string().max(40),
    })
    .strict()
}

/**
 * The parsed body.
 *
 * Declared rather than inferred: the customer object is assembled at startup from the
 * host's declared custom fields, so its zod type is dynamic and inference collapses to an
 * empty object.
 */
export type BookRequest = {
  challengeToken?: string
  customer: { email: string; name: string; phone: string } & Record<string, unknown>
  formToken: string
  message?: string
  resource?: string
  source?: {
    page?: string
    referrer?: string
    utmCampaign?: string
    utmMedium?: string
    utmSource?: string
  }
  start: string
}

/**
 * Control characters other than tab and newline have no place in a name or a message, and
 * they break the calendar file and the plain-text email.
 *
 * Checked by code point rather than a regular-expression literal, which formatters and
 * lint autofixes tend to rewrite into the raw characters themselves.
 */
const hasControlCharacters = (value: unknown): boolean =>
  typeof value === 'string' &&
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0

    return (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f
  })

export const createBookHandler = (server: ResolvedServerOptions): PayloadHandler => {
  const schema = buildSchema(server)

  return async (req) => {
    const { payload } = req
    const now = new Date()
    const body = await readJsonBody(req)

    if (body === null) {
      return validationResponse([{ message: 'That request was too large.', path: '' }])
    }

    // 1. Honeypot. A hidden field only a bot fills in. Answered like a success so the bot
    // learns nothing, but nothing is written.
    const honeypotValue = body[server.honeypotField]

    if (typeof honeypotValue === 'string' && honeypotValue.trim().length > 0) {
      return jsonResponse(
        {
          id: generateReference(),
          end: '',
          googleCalendarUrl: '',
          icsContent: '',
          label: '',
          reference: generateReference(),
          start: '',
        },
        201,
      )
    }

    // 2. Time trap.
    const tokenState = checkFormToken({ now, server, token: body.formToken })

    if (tokenState === 'too_fast') {
      return errorResponse('token_too_fast', 400)
    }

    if (tokenState === 'expired') {
      return errorResponse('token_expired', 400)
    }

    if (tokenState === 'invalid') {
      return errorResponse('token_invalid', 400)
    }

    // 3. Shape and limits.
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return validationResponse(
        parsed.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join('.'),
        })),
      )
    }

    const data = parsed.data as unknown as BookRequest
    const { customer } = data

    if ([customer.name, customer.phone, data.message].some(hasControlCharacters)) {
      return validationResponse([
        { message: 'That value contains characters we cannot accept.', path: 'customer' },
      ])
    }

    // 4. Challenge, if the host configured one.
    const ip = resolveClientIp({ req, server })
    const challenge = await checkChallenge({
      ip,
      payload,
      server,
      token: data.challengeToken,
    })

    if (challenge === 'failed') {
      return errorResponse('challenge_failed', 400)
    }

    // 5. Which location.
    const resolution = await resolveResource({
      payload,
      resource: data.resource ?? null,
      server,
    })

    if (resolution.state === 'required') {
      return errorResponse('resource_required', 400)
    }

    if (resolution.state === 'not_found') {
      return errorResponse('resource_not_found', 404)
    }

    if (resolution.state === 'none_active') {
      return errorResponse('slot_unavailable', 409)
    }

    const { resource } = resolution

    // 6. Per-visitor caps.
    const ipHash = resolveIpHash({ req, server })
    const cap = await checkCaps({ email: customer.email, ipHash, now, payload, server })

    if (cap) {
      return errorResponse('too_many', 429)
    }

    // 7. Membership re-check. A form left open for an hour can submit a slot that has since
    // become illegal, so availability is regenerated and the submitted start must appear in
    // it by exact string match.
    const { days, settings } = await computeAvailability({ now, payload, resource, server })
    const slot = findSlot(days, data.start)

    if (!slot) {
      return errorResponse('slot_unavailable', 409)
    }

    // 8. Same person, same slot: a double-click, a retry, or the back button.
    //
    // Checked before the "is it free" test, not after. Once they hold the slot it reads as
    // full, so the later test would answer "someone just took that" to the person who took
    // it, and the form would wipe their success screen and tell them to pick again.
    const existing = await findExistingBooking({
      email: customer.email,
      payload,
      resourceId: resource.id,
      server,
      slotStart: slot.start,
    })

    if (existing) {
      return errorResponse('already_booked', 409, {
        id: existing.id,
        reference: existing.reference,
      })
    }

    if (!slot.available) {
      return errorResponse('slot_taken', 409)
    }

    // 9. Seat loop. Each attempt is an independent, self-committing write with no shared
    // transaction: the database decides the winner, and a loser simply tries the next seat.
    const config = resolveSlotConfig({ resource, settings })
    const capacity = Math.max(1, config.capacityPerSlot)
    const timezone = config.timezone

    let created: AppointmentRecord | null = null
    let lastError: unknown = null

    for (let seat = 0; seat < capacity && !created; seat += 1) {
      for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
        try {
          created = (await payload.create({
            collection: collectionSlug(server.slugs.appointments),
            data: {
              customer: { ...customer },
              message: data.message,
              resource: resource.id,
              seat,
              slotEnd: slot.end,
              slotStart: slot.start,
              slotStart_tz: timezone,
              source: {
                ipHash,
                page: data.source?.page,
                referrer: data.source?.referrer,
                userAgent: req.headers?.get('user-agent')?.slice(0, 512),
                utmCampaign: data.source?.utmCampaign,
                utmMedium: data.source?.utmMedium,
                utmSource: data.source?.utmSource,
              },
              status: 'confirmed',
            } as never,
            disableTransaction: true,
          })) as unknown as AppointmentRecord
        } catch (error) {
          lastError = error
          const entries = validationErrorEntries(error)
          const paths = entries.map((entry) => entry.path)

          if (paths.includes('slotLockKey')) {
            break // That seat is taken. Try the next one.
          }

          if (paths.includes('reference')) {
            continue // Astronomically unlikely, but retry the same seat with a new code.
          }

          if (isValidationError(error)) {
            return validationResponse(entries)
          }

          const code = (error as { code?: unknown }).code

          if (code === 112) {
            continue // Transient write conflict: retry the same seat.
          }

          throw error
        }
      }
    }

    if (!created) {
      payload.logger.info(
        `[payload-booking] Every seat for ${slot.start} was taken: ${String(lastError)}`,
      )

      return errorResponse('slot_taken', 409)
    }

    // 10. Everything below happens after the write is committed. Payload has no post-commit
    // hook, so a hook-based email could go out for a booking that then rolled back.
    const cancelUrl =
      buildSiteUrl({
        options: server.options,
        path: `${server.options.routes.cancelPath}/${signCancelToken({
          appointmentId: created.id,
          expiresAt: new Date(Date.parse(slot.start) + 24 * 60 * 60 * 1000),
          secret: server.options.tokenSecret,
        })}`,
        payload,
      }) ?? ''

    const summary = `Appointment with ${settings.location ?? 'us'}`
    const icsContent = buildIcs({
      attendeeEmail: customer.email,
      description: settings.confirmationNote ?? undefined,
      end: slot.end,
      location: settings.location,
      method: 'REQUEST',
      now,
      organizerEmail: settings.notificationEmails?.[0]?.email,
      sequence: 0,
      start: slot.start,
      summary,
      uid: String(created.id),
    })

    const calendarUrl = googleCalendarUrl({
      details: settings.confirmationNote ?? undefined,
      end: slot.end,
      location: settings.location,
      start: slot.start,
      summary,
    })

    const entries = await sendEmails({
      payload,
      requests: [
        {
          attachment: { content: icsContent, method: 'REQUEST' },
          event: 'customer.confirmed',
          to: [customer.email],
          viewModel: buildConfirmedViewModel({
            appointment: created,
            cancelUrl,
            icsContent,
            server,
            settings,
          }),
        },
        {
          event: 'business.booked',
          to: (settings.notificationEmails ?? []).map((row) => row.email).filter(Boolean),
          viewModel: buildBookedViewModel({
            appointment: { ...created, customer: { ...customer } },
            payload,
            server,
            settings,
          }),
        },
      ],
      server,
    })

    await appendEmailLog({ appointmentId: created.id, entries, payload, server })

    try {
      await server.options.onAppointmentChange?.({
        doc: created as unknown as Record<string, unknown>,
        event: 'booked',
        req,
      })
    } catch (error) {
      payload.logger.error(`[payload-booking] onAppointmentChange failed: ${String(error)}`)
    }

    return jsonResponse(
      {
        id: created.id,
        end: slot.end,
        googleCalendarUrl: calendarUrl,
        icsContent,
        label: slot.label,
        reference: created.reference,
        start: slot.start,
      },
      201,
    )
  }
}
