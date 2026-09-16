import { describe, expect, it } from 'vitest'

import {
  deriveLockKey,
  holdsSlot,
  isReleasedLockKey,
  releasedLockKey,
  resourceId,
  slotLockKey,
} from './lockKey.js'

describe('resourceId', () => {
  it('reads an id whether the relationship is populated or not', () => {
    // Depth 0 gives an id; a host calling the Local API with depth > 0 gives the document.
    expect(resourceId('abc')).toBe('abc')
    expect(resourceId(7)).toBe('7')
    expect(resourceId({ id: 'abc', name: 'Showroom' })).toBe('abc')
    expect(resourceId({ id: 7 })).toBe('7')
  })

  it('returns an empty string for a missing relationship rather than "undefined"', () => {
    expect(resourceId(null)).toBe('')
    expect(resourceId(undefined)).toBe('')
  })
})

describe('slotLockKey', () => {
  it('joins location, instant and seat', () => {
    expect(
      slotLockKey({ resource: 'showroom', seat: 0, slotStart: '2026-09-16T15:00:00.000Z' }),
    ).toBe('showroom#2026-09-16T15:00:00.000Z#0')
  })

  it('normalises equivalent spellings of the same instant to one key', () => {
    const canonical = slotLockKey({
      resource: 'r',
      seat: 0,
      slotStart: '2026-09-16T15:00:00.000Z',
    })

    expect(slotLockKey({ resource: 'r', seat: 0, slotStart: '2026-09-16T15:00:00Z' })).toBe(canonical)
    expect(
      slotLockKey({ resource: 'r', seat: 0, slotStart: '2026-09-16T10:00:00.000-05:00' }),
    ).toBe(canonical)
    expect(
      slotLockKey({ resource: 'r', seat: 0, slotStart: new Date('2026-09-16T15:00:00.000Z') }),
    ).toBe(canonical)
  })

  it('separates seats, so capacity above one is possible', () => {
    const args = { resource: 'r', slotStart: '2026-09-16T15:00:00.000Z' }

    expect(slotLockKey({ ...args, seat: 0 })).not.toBe(slotLockKey({ ...args, seat: 1 }))
  })

  it('separates locations, so two showrooms can both sell 10:00', () => {
    const args = { seat: 0, slotStart: '2026-09-16T15:00:00.000Z' }

    expect(slotLockKey({ ...args, resource: 'a' })).not.toBe(
      slotLockKey({ ...args, resource: 'b' }),
    )
  })
})

describe('holdsSlot', () => {
  it('counts confirmed, completed and no-show; only cancelled releases', () => {
    expect(holdsSlot('confirmed')).toBe(true)
    expect(holdsSlot('completed')).toBe(true)
    expect(holdsSlot('no-show')).toBe(true)
    expect(holdsSlot('cancelled')).toBe(false)
    expect(holdsSlot(undefined)).toBe(false)
  })
})

describe('releasedLockKey', () => {
  it('is unique per document, never null', () => {
    // MongoDB sparse indexes still index an explicit null, and Payload's Mongo adapter
    // always writes one, so a null release would let only the first cancellation in the
    // whole system succeed.
    expect(releasedLockKey('abc')).toBe('released#abc')
    expect(isReleasedLockKey(releasedLockKey('abc'))).toBe(true)
  })

  it('falls back to a random value when there is no document id yet', () => {
    const first = releasedLockKey()
    const second = releasedLockKey()

    expect(first).not.toBe(second)
    expect(isReleasedLockKey(first)).toBe(true)
  })

  it('treats an empty id as missing', () => {
    expect(releasedLockKey('')).not.toBe('released#')
  })
})

describe('deriveLockKey', () => {
  const confirmed = {
    documentId: 'doc-1',
    resource: 'showroom',
    seat: 0,
    slotStart: '2026-09-16T15:00:00.000Z',
    status: 'confirmed',
  }

  it('holds the slot while the appointment is confirmed', () => {
    expect(deriveLockKey(confirmed)).toBe('showroom#2026-09-16T15:00:00.000Z#0')
  })

  it('keeps holding the slot when marked completed or no-show', () => {
    expect(deriveLockKey({ ...confirmed, status: 'completed' })).toBe(deriveLockKey(confirmed))
    expect(deriveLockKey({ ...confirmed, status: 'no-show' })).toBe(deriveLockKey(confirmed))
  })

  it('releases the slot on cancel, with a per-document tombstone', () => {
    expect(deriveLockKey({ ...confirmed, status: 'cancelled' })).toBe('released#doc-1')
  })

  it('survives a partial update, which is why callers merge originalDoc under data', () => {
    // What the hook actually sees on `payload.update({ data: { status: 'cancelled' } })`.
    const merged = { ...confirmed, status: 'cancelled' }

    expect(deriveLockKey(merged)).toBe('released#doc-1')

    // And the failure mode the merge prevents: without originalDoc there is no slotStart,
    // so a still-confirmed appointment would silently release its slot.
    expect(deriveLockKey({ documentId: 'doc-1', status: 'confirmed' })).toBe('released#doc-1')
  })

  it('defaults a missing seat to zero so the stored key always matches', () => {
    expect(deriveLockKey({ ...confirmed, seat: null })).toBe(deriveLockKey(confirmed))
  })

  it('gives two cancelled appointments for the same slot different keys', () => {
    // The case that breaks a null release: both rows must coexist.
    const a = deriveLockKey({ ...confirmed, documentId: 'doc-1', status: 'cancelled' })
    const b = deriveLockKey({ ...confirmed, documentId: 'doc-2', status: 'cancelled' })

    expect(a).not.toBe(b)
  })
})
