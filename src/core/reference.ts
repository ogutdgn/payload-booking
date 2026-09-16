import { randomBytes } from 'node:crypto'

/** Crockford base32: no I, L, O or U, so a code read over the phone cannot be misheard. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const REFERENCE_LENGTH = 8

/**
 * Short human code for phone conversations ("your reference is K4RT9P2M").
 *
 * Eight characters from a 32-symbol alphabet is 40 bits, so collisions are negligible in
 * practice. The field is still `unique` in the database, and the book endpoint retries on
 * the uniqueness error, because "negligible" is not "impossible" (spec §6.4, F10).
 */
export const generateReference = (length: number = REFERENCE_LENGTH): string => {
  const bytes = randomBytes(length)
  let out = ''

  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[bytes[index] % ALPHABET.length]
  }

  return out
}

export const isReference = (value: unknown): boolean =>
  typeof value === 'string' &&
  value.length === REFERENCE_LENGTH &&
  [...value].every((character) => ALPHABET.includes(character))
