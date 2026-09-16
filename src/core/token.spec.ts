import { describe, expect, it } from 'vitest'

import {
  assertSecret,
  deriveKey,
  FORM_TOKEN_MAX_AGE_SECONDS,
  formTokenExpiresAt,
  hashIp,
  issueFormToken,
  signCancelToken,
  verifyCancelToken,
  verifyFormToken,
} from './token.js'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)
const NOW = new Date('2026-09-16T12:00:00.000Z')
const at = (offsetSeconds: number): Date => new Date(NOW.getTime() + offsetSeconds * 1000)

describe('assertSecret', () => {
  it('rejects the ways a secret actually goes missing', () => {
    // An absent env var, a blank line in .env, and a short placeholder. The first two
    // would otherwise sign every token with an empty key and verify happily.
    expect(() => assertSecret(undefined)).toThrow(/at least 32/)
    expect(() => assertSecret('')).toThrow(/at least 32/)
    expect(() => assertSecret('short')).toThrow(/at least 32/)
    expect(() => assertSecret(12345)).toThrow(/at least 32/)
  })

  it('names the environment variable so the error is actionable', () => {
    expect(() => assertSecret('')).toThrow(/BOOKING_TOKEN_SECRET/)
  })

  it('accepts a long enough secret', () => {
    expect(assertSecret(SECRET)).toBe(SECRET)
  })
})

describe('deriveKey', () => {
  it('gives each purpose its own key', () => {
    const cancel = deriveKey(SECRET, 'cancel')
    const form = deriveKey(SECRET, 'form')
    const ip = deriveKey(SECRET, 'ip')

    expect(cancel.equals(form)).toBe(false)
    expect(cancel.equals(ip)).toBe(false)
    expect(form.equals(ip)).toBe(false)
  })

  it('is deterministic for the same secret and purpose', () => {
    expect(deriveKey(SECRET, 'cancel').equals(deriveKey(SECRET, 'cancel'))).toBe(true)
  })
})

describe('cancel tokens', () => {
  const token = signCancelToken({
    appointmentId: 'appt-1',
    expiresAt: at(3600),
    secret: SECRET,
  })

  it('round-trips a valid token', () => {
    const result = verifyCancelToken({ now: NOW, secret: SECRET, token })

    expect(result.state).toBe('valid')
    expect(result.state === 'valid' && result.payload.a).toBe('appt-1')
  })

  it('reports expiry separately, so the page can say "this link has expired"', () => {
    expect(verifyCancelToken({ now: at(3601), secret: SECRET, token }).state).toBe('expired')
  })

  it('rejects a tampered payload', () => {
    const forged = signCancelToken({
      appointmentId: 'appt-2',
      expiresAt: at(3600),
      secret: SECRET,
    })
    const swapped = `${forged.split('.')[0]}.${token.split('.')[1]}`

    expect(verifyCancelToken({ now: NOW, secret: SECRET, token: swapped }).state).toBe('invalid')
  })

  it('rejects a token signed with a different secret', () => {
    expect(verifyCancelToken({ now: NOW, secret: OTHER_SECRET, token }).state).toBe('invalid')
  })

  it('rejects a form token presented as a cancel token', () => {
    // The purpose-derived keys make this a key mismatch, not an encoding accident.
    const formToken = issueFormToken(SECRET, NOW)

    expect(verifyCancelToken({ now: NOW, secret: SECRET, token: formToken }).state).toBe('invalid')
  })

  it('rejects junk without throwing', () => {
    for (const bad of ['', '.', 'no-dot', 'a.b', null, undefined, 42, 'x'.repeat(5000)]) {
      expect(verifyCancelToken({ now: NOW, secret: SECRET, token: bad }).state).toBe('invalid')
    }
  })

  it('rejects a well-formed payload carrying the wrong purpose', () => {
    const encoded = Buffer.from(
      JSON.stringify({ a: 'appt-1', exp: Math.floor(at(3600).getTime() / 1000), p: 'reschedule' }),
    ).toString('base64url')
    const signature = signCancelToken({
      appointmentId: 'x',
      expiresAt: at(3600),
      secret: SECRET,
    }).split('.')[1]

    expect(
      verifyCancelToken({ now: NOW, secret: SECRET, token: `${encoded}.${signature}` }).state,
    ).toBe('invalid')
  })
})

describe('form tokens', () => {
  it('rejects a submission faster than a human can fill the form', () => {
    const token = issueFormToken(SECRET, NOW)

    expect(verifyFormToken({ now: NOW, secret: SECRET, token })).toBe('too_fast')
    expect(verifyFormToken({ now: at(2), secret: SECRET, token })).toBe('too_fast')
  })

  it('accepts the same token three seconds later', () => {
    // Why `too_fast` is its own state: the form waits and resubmits the same token rather
    // than fetching a new one, which would restart the three-second clock forever.
    const token = issueFormToken(SECRET, NOW)

    expect(verifyFormToken({ now: at(3), secret: SECRET, token })).toBe('valid')
    expect(verifyFormToken({ now: at(60), secret: SECRET, token })).toBe('valid')
  })

  it('expires a form left open overnight', () => {
    const token = issueFormToken(SECRET, NOW)

    expect(verifyFormToken({ now: at(FORM_TOKEN_MAX_AGE_SECONDS), secret: SECRET, token })).toBe(
      'valid',
    )
    expect(
      verifyFormToken({ now: at(FORM_TOKEN_MAX_AGE_SECONDS + 1), secret: SECRET, token }),
    ).toBe('expired')
  })

  it('rejects a forged issue time', () => {
    const token = issueFormToken(SECRET, NOW)
    const [, signature] = token.split('.')
    const backdated = `${Math.floor(NOW.getTime() / 1000) - 600}.${signature}`

    expect(verifyFormToken({ now: at(3), secret: SECRET, token: backdated })).toBe('invalid')
  })

  it('rejects a cancel token presented as a form token', () => {
    const cancelToken = signCancelToken({
      appointmentId: 'appt-1',
      expiresAt: at(3600),
      secret: SECRET,
    })

    expect(verifyFormToken({ now: at(10), secret: SECRET, token: cancelToken })).toBe('invalid')
  })

  it('rejects junk without throwing', () => {
    for (const bad of ['', '.', 'abc', '0.sig', '-1.sig', null, undefined, {}]) {
      expect(verifyFormToken({ now: NOW, secret: SECRET, token: bad })).toBe('invalid')
    }
  })

  it('reports when the token stops being usable', () => {
    const token = issueFormToken(SECRET, NOW)

    expect(formTokenExpiresAt(token)).toBe('2026-09-16T18:00:00.000Z')
  })
})

describe('hashIp', () => {
  it('is stable for one address and different for another', () => {
    expect(hashIp('203.0.113.7', SECRET)).toBe(hashIp('203.0.113.7', SECRET))
    expect(hashIp('203.0.113.7', SECRET)).not.toBe(hashIp('203.0.113.8', SECRET))
  })

  it('does not contain the address it came from', () => {
    expect(hashIp('203.0.113.7', SECRET)).not.toContain('203.0.113')
  })

  it('changes with the secret, so hashes cannot be correlated across deployments', () => {
    expect(hashIp('203.0.113.7', SECRET)).not.toBe(hashIp('203.0.113.7', OTHER_SECRET))
  })
})
