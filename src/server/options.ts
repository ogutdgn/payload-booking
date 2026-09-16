import type { Payload, PayloadRequest } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from '../types.js'

import { resolveLabelOptions } from '../core/format.js'
import { DEFAULT_API_BASE_PATH, DEFAULT_SLUGS } from '../types.js'

export type ResolvedServerOptions = {
  apiBasePath: string
  caps: {
    maxActivePerEmail: number
    maxPerEmailInWindow: number
    maxPerIpInWindow: number
    windowMinutes: number
  }
  challengeTimeoutMs: number
  honeypotField: string
  labels: { hour12: boolean; locale: string }
  options: BookingPluginOptions
  slugs: ResolvedSlugs
}

export const resolveServerOptions = (
  options: BookingPluginOptions,
): ResolvedServerOptions => ({
  apiBasePath: options.apiBasePath ?? DEFAULT_API_BASE_PATH,
  caps: {
    maxActivePerEmail: options.bookingCaps?.maxActivePerEmail ?? 3,
    maxPerEmailInWindow: options.bookingCaps?.maxPerEmailInWindow ?? 3,
    maxPerIpInWindow: options.bookingCaps?.maxPerIpInWindow ?? 5,
    windowMinutes: options.bookingCaps?.windowMinutes ?? 60,
  },
  challengeTimeoutMs: options.challengeTimeoutMs ?? 5000,
  honeypotField: options.honeypotField ?? 'website',
  labels: resolveLabelOptions(options.labels),
  options,
  slugs: { ...DEFAULT_SLUGS, ...options.slugs },
})

/**
 * Where the customer-facing site lives, for the links in emails.
 *
 * Payload's `serverURL` defaults to an empty string, so it cannot be relied on: a relative
 * cancel link in an email is unopenable.
 */
export const resolveOrigin = (args: {
  options: BookingPluginOptions
  payload: Payload
}): null | string => {
  const configured = args.options.siteUrl ?? args.payload.config.serverURL

  return configured && configured.length > 0 ? configured.replace(/\/+$/, '') : null
}

export const buildSiteUrl = (args: {
  options: BookingPluginOptions
  path: string
  payload: Payload
}): null | string => {
  const origin = resolveOrigin(args)

  if (!origin) {
    return null
  }

  return new URL(args.path, `${origin}/`).toString()
}

export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  Response.json(body, {
    headers: { 'Cache-Control': 'no-store', ...headers },
    status,
  })

/** Every failure the public endpoints can return, in one place. */
export type BookingErrorCode =
  | 'already_booked'
  | 'challenge_failed'
  | 'invalid_transition'
  | 'not_found'
  | 'resource_not_found'
  | 'resource_required'
  | 'slot_taken'
  | 'slot_unavailable'
  | 'token_expired'
  | 'token_invalid'
  | 'token_too_fast'
  | 'too_late'
  | 'too_many'
  | 'unauthorized'

export const errorResponse = (
  code: BookingErrorCode,
  status: number,
  extra: Record<string, unknown> = {},
): Response => jsonResponse({ error: code, ...extra }, status)

/** Payload validation failures, reshaped into the documented 422 body. */
export const validationResponse = (errors: { message: string; path: string }[]): Response =>
  jsonResponse({ errors }, 422)

export const isValidationError = (error: unknown): boolean =>
  Boolean((error as { data?: { errors?: unknown[] } })?.data?.errors)

export const validationErrorEntries = (
  error: unknown,
): { message: string; path: string }[] => {
  const errors = (error as { data?: { errors?: { message?: string; path?: string }[] } })?.data
    ?.errors

  return Array.isArray(errors)
    ? errors.map((entry) => ({ message: entry.message ?? 'Invalid value', path: entry.path ?? '' }))
    : []
}

/**
 * Read a JSON body safely.
 *
 * `PayloadRequest` extends `Partial<Request>`, so `req.json` is optional-typed; and a body
 * larger than the cap is refused before it is parsed at all.
 */
export const readJsonBody = async (
  req: PayloadRequest,
  maxBytes = 16 * 1024,
): Promise<null | Record<string, unknown>> => {
  const declared = Number(req.headers?.get('content-length') ?? '0')

  if (Number.isFinite(declared) && declared > maxBytes) {
    return null
  }

  try {
    const body = (await req.json?.()) as unknown

    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
