import { describe, expect, it } from 'vitest'

import { CHICAGO } from './fixtures.js'
import { createFormatter, resolveLabelOptions } from './format.js'

const INSTANT = '2026-09-18T19:00:00.000Z'

describe('resolveLabelOptions', () => {
  it('defaults to US English, 12-hour', () => {
    expect(resolveLabelOptions()).toEqual({ hour12: true, locale: 'en-US' })
    expect(resolveLabelOptions({ hour12: false })).toEqual({ hour12: false, locale: 'en-US' })
  })
})

describe('createFormatter', () => {
  const formatter = createFormatter(CHICAGO)

  it('renders in the business zone regardless of the server zone', () => {
    expect(formatter.timeLabel(INSTANT)).toBe('2:00 PM')
    expect(formatter.dayLabel(INSTANT)).toBe('Fri, Sep 18')
    expect(formatter.dateLabel(INSTANT)).toBe('Friday, September 18, 2026')
    expect(formatter.localDate(INSTANT)).toBe('2026-09-18')
    expect(formatter.localTime(INSTANT)).toBe('14:00')
  })

  it('stores 24-hour time so the admin list column sorts correctly', () => {
    // "10:00 AM" would sort before "9:00 AM" as text; "09:00" and "10:00" do not.
    const morning = createFormatter(CHICAGO).localTime('2026-09-18T14:00:00.000Z')
    const later = createFormatter(CHICAGO).localTime('2026-09-18T15:00:00.000Z')

    expect(morning).toBe('09:00')
    expect(later).toBe('10:00')
    expect([later, morning].sort()).toEqual([morning, later])
  })

  it('builds the appointment title from the customer name and the local time', () => {
    expect(formatter.title('Jane Doe', INSTANT)).toBe('Jane Doe — Fri, Sep 18 2:00 PM')
  })

  it('follows the host label options', () => {
    const european = createFormatter(CHICAGO, { hour12: false, locale: 'en-GB' })

    expect(european.timeLabel(INSTANT)).toBe('14:00')
    // The locale also reorders the day heading: day before month.
    expect(european.dayLabel(INSTANT)).toBe('Fri 18 Sept')
    expect(european.dateLabel(INSTANT)).toBe('Friday, 18 September 2026')
    // Storage never changes with the label options.
    expect(european.localTime(INSTANT)).toBe('14:00')
    expect(european.localDate(INSTANT)).toBe('2026-09-18')
  })

  it('formats the same instant differently in another business zone', () => {
    expect(createFormatter('Europe/Istanbul').timeLabel(INSTANT)).toBe('10:00 PM')
    expect(createFormatter('UTC').timeLabel(INSTANT)).toBe('7:00 PM')
  })

  it('accepts a Date, a number or a string for every helper', () => {
    const asDate = new Date(INSTANT)

    expect(formatter.timeLabel(asDate)).toBe(formatter.timeLabel(INSTANT))
    expect(formatter.timeLabel(asDate.getTime())).toBe(formatter.timeLabel(INSTANT))
  })
})
