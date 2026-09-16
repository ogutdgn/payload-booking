import { describe, expect, it } from 'vitest'

import { generateReference, isReference, REFERENCE_LENGTH } from './reference.js'

describe('generateReference', () => {
  it('produces a code of the documented length', () => {
    expect(generateReference()).toHaveLength(REFERENCE_LENGTH)
  })

  it('omits the letters that are misheard over the phone', () => {
    // Crockford base32: no I, L, O or U, so "your reference is..." survives a phone call.
    const sample = Array.from({ length: 200 }, () => generateReference()).join('')

    expect(/[ILOU]/.test(sample)).toBe(false)
    expect(/^[0-9A-Z]+$/.test(sample)).toBe(true)
  })

  it('does not repeat itself in normal volumes', () => {
    const codes = new Set(Array.from({ length: 5000 }, () => generateReference()))

    expect(codes.size).toBe(5000)
  })

  it('recognises its own output and rejects near misses', () => {
    expect(isReference(generateReference())).toBe(true)
    expect(isReference('TOO-SHORT')).toBe(false)
    expect(isReference('IIIIIIII')).toBe(false)
    expect(isReference(null)).toBe(false)
  })
})
