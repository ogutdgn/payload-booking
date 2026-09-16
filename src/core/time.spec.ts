import { addDays } from 'date-fns'
import { describe, expect, it } from 'vitest'

import { CHICAGO } from './fixtures.js'
import {
  eachLocalDate,
  isBlackedOut,
  isCanonicalUtcIso,
  isValidLocalDate,
  isValidTime,
  localDateOf,
  localTimeOf,
  parseLocalDate,
  parseTime,
  shiftLocalDate,
  startOfLocalDayIso,
  toUtcIso,
  weekdayIndexOf,
  zonedInstant,
  zonedMidday,
} from './time.js'

describe('toUtcIso', () => {
  it('produces the canonical form the database adapters return', () => {
    expect(toUtcIso('2026-09-16T15:00:00Z')).toBe('2026-09-16T15:00:00.000Z')
    expect(toUtcIso('2026-09-16T10:00:00.000-05:00')).toBe('2026-09-16T15:00:00.000Z')
    expect(toUtcIso(new Date('2026-09-16T15:00:00Z'))).toBe('2026-09-16T15:00:00.000Z')
  })

  it('normalises a zoned date, whose own toISOString returns the offset form', () => {
    const zoned = zonedInstant({ day: 16, month: 9, year: 2026 }, { hour: 10, minute: 0 }, CHICAGO)

    expect(zoned.toISOString()).toContain('-05:00')
    expect(toUtcIso(zoned)).toBe('2026-09-16T15:00:00.000Z')
    expect(isCanonicalUtcIso(toUtcIso(zoned))).toBe(true)
  })
})

describe('isCanonicalUtcIso', () => {
  it('accepts only the exact shape used for slot keys', () => {
    expect(isCanonicalUtcIso('2026-09-16T15:00:00.000Z')).toBe(true)
    expect(isCanonicalUtcIso('2026-09-16T15:00:00Z')).toBe(false)
    expect(isCanonicalUtcIso('2026-09-16T10:00:00.000-05:00')).toBe(false)
  })
})

describe('parsers', () => {
  it('reads a padded date and time', () => {
    expect(parseLocalDate('2026-09-16')).toEqual({ day: 16, month: 9, year: 2026 })
    expect(parseTime('09:05')).toEqual({ hour: 9, minute: 5 })
  })

  it('refuses unpadded or impossible values, which would sort wrongly as text', () => {
    expect(() => parseLocalDate('2026-9-16')).toThrow()
    expect(() => parseTime('9:00')).toThrow()
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('23:60')).toBe(false)
    expect(isValidLocalDate('2026-02-30')).toBe(false)
    expect(isValidLocalDate('2026-13-01')).toBe(false)
    expect(isValidLocalDate('2028-02-29')).toBe(true)
  })
})

describe('zoned construction', () => {
  it('is independent of the server timezone', () => {
    // The bug this prevents: `new Date(2026, 6, 15, 10)` means 10:00 wherever the server is.
    expect(toUtcIso(zonedInstant({ day: 15, month: 7, year: 2026 }, { hour: 10, minute: 0 }, CHICAGO))).toBe(
      '2026-07-15T15:00:00.000Z',
    )
    expect(toUtcIso(zonedInstant({ day: 15, month: 1, year: 2026 }, { hour: 10, minute: 0 }, CHICAGO))).toBe(
      '2026-01-15T16:00:00.000Z',
    )
  })

  it('reads back the local date and time it was built from', () => {
    const instant = zonedInstant({ day: 16, month: 9, year: 2026 }, { hour: 14, minute: 30 }, CHICAGO)

    expect(localDateOf(instant, CHICAGO)).toBe('2026-09-16')
    expect(localTimeOf(instant, CHICAGO)).toBe('14:30')
  })

  it('reports the local date of an instant, not the server date', () => {
    // 04:30 UTC is still the previous evening in Chicago.
    expect(localDateOf('2026-03-08T04:30:00.000Z', CHICAGO)).toBe('2026-03-07')
    expect(localDateOf('2026-03-08T04:30:00.000Z', 'UTC')).toBe('2026-03-08')
  })
})

describe('day arithmetic', () => {
  it('keeps the wall clock across the spring-forward day', () => {
    // Adding 86 400 000 ms here lands on 11:00, which is the seasonal bug.
    const tenAm = zonedMidday({ day: 7, month: 3, year: 2026 }, CHICAGO)
    const naive = new Date(tenAm.getTime() + 86_400_000)

    expect(localTimeOf(addDays(tenAm, 1), CHICAGO)).toBe('12:00')
    expect(localTimeOf(naive, CHICAGO)).toBe('13:00')
  })

  it('keeps the wall clock across the fall-back day', () => {
    const noon = zonedMidday({ day: 31, month: 10, year: 2026 }, CHICAGO)

    expect(localTimeOf(addDays(noon, 1), CHICAGO)).toBe('12:00')
  })

  it('shifts calendar dates, including over month and year ends', () => {
    expect(shiftLocalDate('2026-03-07', 1, CHICAGO)).toBe('2026-03-08')
    expect(shiftLocalDate('2026-09-30', 1, CHICAGO)).toBe('2026-10-01')
    expect(shiftLocalDate('2026-12-31', 1, CHICAGO)).toBe('2027-01-01')
    expect(shiftLocalDate('2028-02-28', 1, CHICAGO)).toBe('2028-02-29')
    expect(shiftLocalDate('2026-09-16', -1, CHICAGO)).toBe('2026-09-15')
  })

  it('lists an inclusive range of local dates', () => {
    expect(eachLocalDate('2026-03-06', '2026-03-10', CHICAGO)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ])
  })

  it('returns a single day when first and last match, and nothing when reversed', () => {
    expect(eachLocalDate('2026-09-16', '2026-09-16', CHICAGO)).toEqual(['2026-09-16'])
    expect(eachLocalDate('2026-09-17', '2026-09-16', CHICAGO)).toEqual([])
  })

  it('reports the weekday of a local date', () => {
    expect(weekdayIndexOf('2026-09-16', CHICAGO)).toBe(3)
    expect(weekdayIndexOf('2026-09-20', CHICAGO)).toBe(0)
  })
})

describe('startOfLocalDayIso', () => {
  it('follows the offset in force on that day', () => {
    expect(startOfLocalDayIso('2026-03-07', CHICAGO)).toBe('2026-03-07T06:00:00.000Z')
    expect(startOfLocalDayIso('2026-03-09', CHICAGO)).toBe('2026-03-09T05:00:00.000Z')
  })
})

describe('isBlackedOut', () => {
  const ranges = [
    { endDate: '2026-10-22', startDate: '2026-10-21' },
    { endDate: '2026-12-25', startDate: '2026-12-25' },
  ]

  it('covers the whole inclusive range', () => {
    expect(isBlackedOut('2026-10-20', ranges)).toBe(false)
    expect(isBlackedOut('2026-10-21', ranges)).toBe(true)
    expect(isBlackedOut('2026-10-22', ranges)).toBe(true)
    expect(isBlackedOut('2026-10-23', ranges)).toBe(false)
  })

  it('handles a single-day closure', () => {
    expect(isBlackedOut('2026-12-25', ranges)).toBe(true)
    expect(isBlackedOut('2026-12-26', ranges)).toBe(false)
  })

  it('is false when nothing is closed', () => {
    expect(isBlackedOut('2026-10-21', [])).toBe(false)
  })
})
