import { createHmac, timingSafeEqual } from 'node:crypto'

export const MIN_SECRET_LENGTH = 32

/** Seconds a form token stays valid, and the minimum age a submission must have. */
export const FORM_TOKEN_MAX_AGE_SECONDS = 6 * 60 * 60
export const FORM_TOKEN_MIN_AGE_SECONDS = 3

export type TokenPurpose = 'cancel' | 'form' | 'ip'

/**
 * `tokenSecret` is checked here rather than at config build time: `generate:importmap`,
 * `generate:types` and `migrate` all run the plugin through `buildConfig` without runtime
 * secrets, and throwing there would break those commands in CI (C07).
 */
export const assertSecret = (secret: unknown): string => {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[payload-booking] tokenSecret must be a string of at least ${MIN_SECRET_LENGTH} characters. ` +
        `Set BOOKING_TOKEN_SECRET (openssl rand -base64 32) and keep it different from PAYLOAD_SECRET.`,
    )
  }

  return secret
}

/**
 * One secret, three unrelated uses. Deriving a key per purpose means a value signed for
 * one can never verify for another, by key rather than by encoding accident (F45).
 */
export const deriveKey = (secret: string, purpose: TokenPurpose): Buffer =>
  createHmac('sha256', assertSecret(secret)).update(`booking:${purpose}`).digest()

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url')

const sign = (key: Buffer, message: string): string =>
  createHmac('sha256', key).update(message).digest('base64url')

/** Constant-time compare that tolerates length differences without leaking them. */
const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

export type CancelTokenPayload = {
  /** Appointment id. */
  a: number | string
  /** Expiry, unix seconds. */
  exp: number
  /** Purpose. Always 'cancel'. */
  p: 'cancel'
}

/**
 * `base64url(json) + '.' + hmac(base64url(json))`.
 *
 * The signature covers the encoded segment exactly as it travels, so verification never
 * re-serialises the JSON: key order or whitespace differences would otherwise break
 * perfectly valid tokens.
 */
export const signCancelToken = (args: {
  appointmentId: number | string
  expiresAt: Date | number
  secret: string
}): string => {
  const exp = Math.floor(
    (args.expiresAt instanceof Date ? args.expiresAt.getTime() : args.expiresAt) / 1000,
  )
  const payload: CancelTokenPayload = { a: args.appointmentId, exp, p: 'cancel' }
  const encoded = base64url(JSON.stringify(payload))

  return `${encoded}.${sign(deriveKey(args.secret, 'cancel'), encoded)}`
}

export type CancelTokenResult =
  | { payload: CancelTokenPayload; state: 'valid' }
  | { state: 'expired' }
  | { state: 'invalid' }

export const verifyCancelToken = (args: {
  now: Date
  secret: string
  token: unknown
}): CancelTokenResult => {
  const { now, secret, token } = args

  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return { state: 'invalid' }
  }

  const separator = token.lastIndexOf('.')

  if (separator <= 0) {
    return { state: 'invalid' }
  }

  const encoded = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  if (!safeEqual(signature, sign(deriveKey(secret, 'cancel'), encoded))) {
    return { state: 'invalid' }
  }

  let payload: CancelTokenPayload

  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CancelTokenPayload
  } catch {
    return { state: 'invalid' }
  }

  if (!payload || payload.p !== 'cancel' || typeof payload.exp !== 'number') {
    return { state: 'invalid' }
  }

  if (payload.a === null || payload.a === undefined || payload.a === '') {
    return { state: 'invalid' }
  }

  if (payload.exp * 1000 < now.getTime()) {
    return { state: 'expired' }
  }

  return { payload, state: 'valid' }
}

/**
 * The time trap: a signed issue time. A submission faster than three seconds is a bot;
 * one older than six hours is a form left open overnight.
 *
 * Reusable inside its window by design, not a nonce. Per-visitor abuse is bounded by the
 * booking caps and the optional challenge.
 */
export const issueFormToken = (secret: string, now: Date = new Date()): string => {
  const issuedAt = Math.floor(now.getTime() / 1000)

  return `${issuedAt}.${sign(deriveKey(secret, 'form'), `form.${issuedAt}`)}`
}

export const formTokenExpiresAt = (token: string): null | string => {
  const issuedAt = Number(token.slice(0, token.indexOf('.')))

  if (!Number.isFinite(issuedAt)) {
    return null
  }

  return new Date((issuedAt + FORM_TOKEN_MAX_AGE_SECONDS) * 1000).toISOString()
}

export type FormTokenState = 'expired' | 'invalid' | 'too_fast' | 'valid'

export const verifyFormToken = (args: {
  now: Date
  secret: string
  token: unknown
}): FormTokenState => {
  const { now, secret, token } = args

  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return 'invalid'
  }

  const separator = token.indexOf('.')

  if (separator <= 0) {
    return 'invalid'
  }

  const issuedAtRaw = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const issuedAt = Number(issuedAtRaw)

  if (!Number.isInteger(issuedAt) || issuedAt <= 0) {
    return 'invalid'
  }

  if (!safeEqual(signature, sign(deriveKey(secret, 'form'), `form.${issuedAt}`))) {
    return 'invalid'
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - issuedAt

  if (ageSeconds < FORM_TOKEN_MIN_AGE_SECONDS) {
    return 'too_fast'
  }

  if (ageSeconds > FORM_TOKEN_MAX_AGE_SECONDS) {
    return 'expired'
  }

  return 'valid'
}

/**
 * Pseudonymise a client IP before storing it. The raw address is never kept.
 *
 * Honest about what this buys: with the key, all four billion IPv4 addresses can be
 * enumerated in hours. Without it, the stored value is useless. It is a guard against
 * casual database exposure, not anonymisation.
 */
export const hashIp = (ip: string, secret: string): string =>
  createHmac('sha256', deriveKey(secret, 'ip')).update(ip).digest('base64url').slice(0, 32)
