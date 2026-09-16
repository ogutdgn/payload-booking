import type { Payload, PayloadRequest } from 'payload'

import type { ResolvedServerOptions } from './options.js'

import { hashIp, verifyFormToken } from '../core/token.js'
import { collectionSlug } from '../payload/slugs.js'
import { SLOT_HOLDING_STATUSES } from '../types.js'

/**
 * The client IP, if it can be trusted.
 *
 * A Web `Request` carries no address, so the only source is a proxy header, which anyone
 * can set. Behind Vercel or Cloudflare the platform overwrites it and it is reliable;
 * on bare Node it is whatever the caller typed. Defaulting to "unknown" rather than
 * trusting the header keeps the per-IP cap honest instead of trivially bypassable.
 */
export const resolveClientIp = (args: {
  req: PayloadRequest
  server: ResolvedServerOptions
}): string | undefined => {
  const { req, server } = args

  if (server.options.getClientIp) {
    return server.options.getClientIp(req)
  }

  if (!server.options.trustProxy) {
    return undefined
  }

  const forwarded = req.headers?.get('x-forwarded-for')

  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()

    if (first) {
      return first
    }
  }

  return req.headers?.get('x-real-ip') ?? req.headers?.get('cf-connecting-ip') ?? undefined
}

export const resolveIpHash = (args: {
  req: PayloadRequest
  server: ResolvedServerOptions
}): null | string => {
  const ip = resolveClientIp(args)

  return ip ? hashIp(ip, args.server.options.tokenSecret) : null
}

export type FormTokenOutcome = 'expired' | 'invalid' | 'too_fast' | 'valid'

export const checkFormToken = (args: {
  now?: Date
  server: ResolvedServerOptions
  token: unknown
}): FormTokenOutcome =>
  verifyFormToken({
    now: args.now ?? new Date(),
    secret: args.server.options.tokenSecret,
    token: args.token,
  })

/**
 * Ask the host's challenge provider, if there is one.
 *
 * Fails open on a provider error or timeout, deliberately: an outage at Cloudflare must
 * not stop a showroom taking bookings, and the honeypot, the time trap and the caps still
 * apply. A provider that answers "no" is a different thing and is refused.
 */
export const checkChallenge = async (args: {
  ip: string | undefined
  payload: Payload
  server: ResolvedServerOptions
  token: string | undefined
}): Promise<'failed' | 'passed' | 'skipped'> => {
  const { ip, payload, server, token } = args
  const verify = server.options.verifyChallenge

  if (!verify) {
    return 'skipped'
  }

  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('verifyChallenge timed out')),
        server.challengeTimeoutMs,
      ).unref?.()
    })

    const passed = await Promise.race([verify(token, ip), timeout])

    return passed ? 'passed' : 'failed'
  } catch (error) {
    payload.logger.warn(
      `[payload-booking] verifyChallenge did not answer, allowing the booking through: ${String(error)}`,
    )

    return 'skipped'
  }
}

export type CapOutcome = { reason: 'email_active' | 'email_window' | 'ip_window' } | null

/**
 * Per-visitor limits, counted from stored rows rather than an in-memory counter, so they
 * survive a serverless cold start and every instance sees the same numbers.
 *
 * These count successful bookings, not requests: a rejected attempt is free. Request-rate
 * limiting belongs at the host's edge. That is adequate here because a row and its two
 * emails only happen on the success path.
 */
export const checkCaps = async (args: {
  email: string
  ipHash: null | string
  now?: Date
  payload: Payload
  req?: PayloadRequest
  server: ResolvedServerOptions
}): Promise<CapOutcome> => {
  const { email, ipHash, payload, req, server } = args
  const now = args.now ?? new Date()
  const collection = collectionSlug(server.slugs.appointments)
  const windowStart = new Date(now.getTime() - server.caps.windowMinutes * 60_000).toISOString()

  if (ipHash) {
    const { totalDocs } = await payload.count({
      collection,
      req,
      where: {
        createdAt: { greater_than_equal: windowStart },
        'source.ipHash': { equals: ipHash },
      },
    })

    if (totalDocs >= server.caps.maxPerIpInWindow) {
      return { reason: 'ip_window' }
    }
  }

  const perEmailWindow = await payload.count({
    collection,
    req,
    where: {
      createdAt: { greater_than_equal: windowStart },
      'customer.email': { equals: email },
    },
  })

  if (perEmailWindow.totalDocs >= server.caps.maxPerEmailInWindow) {
    return { reason: 'email_window' }
  }

  // Upcoming only. Counting every slot-holding row would include completed and no-show
  // visits from years back, so a loyal customer would eventually be locked out for good.
  const activeForEmail = await payload.count({
    collection,
    req,
    where: {
      'customer.email': { equals: email },
      slotStart: { greater_than_equal: now.toISOString() },
      status: { in: [...SLOT_HOLDING_STATUSES] },
    },
  })

  if (activeForEmail.totalDocs >= server.caps.maxActivePerEmail) {
    return { reason: 'email_active' }
  }

  return null
}

/** Has this person already got this exact slot? Narrows the double-submit window. */
export const findExistingBooking = async (args: {
  email: string
  payload: Payload
  req?: PayloadRequest
  resourceId: number | string
  server: ResolvedServerOptions
  slotStart: string
}): Promise<{ id: number | string; reference?: string } | null> => {
  const { docs } = await args.payload.find({
    collection: collectionSlug(args.server.slugs.appointments),
    depth: 0,
    limit: 1,
    req: args.req,
    select: { reference: true },
    where: {
      'customer.email': { equals: args.email },
      resource: { equals: args.resourceId },
      slotStart: { equals: args.slotStart },
      status: { in: [...SLOT_HOLDING_STATUSES] },
    },
  })

  return docs[0] ? (docs[0] as unknown as { id: number | string; reference?: string }) : null
}
