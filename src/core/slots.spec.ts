import { TZDate } from '@date-fns/tz'
import { describe, expect, it } from 'vitest'

import {
  BUSINESS_HOURS,
  CHICAGO,
  everyDay,
  FALL_BACK_DAY,
  scheduleOf,
  SPRING_FORWARD_DAY,
} from './fixtures.js'
import { findSlot, generateSlots, startsInWindow, windowBounds } from './slots.js'
import { isCanonicalUtcIso, localTimeOf } from './time.js'

const base = {
  blackouts: [],
  bookedCounts: {},
  capacityPerSlot: 1,
  minNoticeMinutes: 0,
  slotDurationMinutes: 60,
  timezone: CHICAGO,
  window: { mode: 'rolling-days', rollingDays: 3 } as const,
}

/** An instant from a business-zone wall clock, so tests read in the owner's terms. */
const chicago = (date: string, time = '00:00'): Date => {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)

  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, CHICAGO).getTime())
}

describe('windowBounds', () => {
  it('starts on the business-zone day, not the server-zone day', () => {
    // 04:30 UTC on 8 March is still 7 March in Chicago. A server-side `format(now)` would
    // start the window a day early for the last six hours of every local day.
    const bounds = windowBounds({
      now: new Date('2026-03-08T04:30:00.000Z'),
      timezone: CHICAGO,
      window: { mode: 'rolling-days', rollingDays: 14 },
    })

    expect(bounds.firstDay).toBe('2026-03-07')
    expect(bounds.lastDay).toBe('2026-03-20')
  })

  it('covers exactly N local days for a rolling window', () => {
    const bounds = windowBounds({
      now: chicago('2026-09-16', '09:00'),
      timezone: CHICAGO,
      window: { mode: 'rolling-days', rollingDays: 14 },
    })

    expect(bounds.firstDay).toBe('2026-09-16')
    expect(bounds.lastDay).toBe('2026-09-29')
  })

  it('runs to the end of the last calendar week, weeks starting Monday', () => {
    // Wednesday 16 September 2026. Two weeks means this week plus next, ending Sunday 27th.
    const bounds = windowBounds({
      now: chicago('2026-09-16', '09:00'),
      timezone: CHICAGO,
      window: { calendarWeeks: 2, mode: 'calendar-weeks' },
    })

    expect(bounds.firstDay).toBe('2026-09-16')
    expect(bounds.lastDay).toBe('2026-09-27')
  })

  it('handles a Monday, where the week has only just started', () => {
    const bounds = windowBounds({
      now: chicago('2026-09-14', '09:00'),
      timezone: CHICAGO,
      window: { calendarWeeks: 2, mode: 'calendar-weeks' },
    })

    expect(bounds.firstDay).toBe('2026-09-14')
    expect(bounds.lastDay).toBe('2026-09-27')
  })

  it('exposes an instant range that brackets the local days', () => {
    const bounds = windowBounds({
      now: chicago('2026-09-16', '09:00'),
      timezone: CHICAGO,
      window: { mode: 'rolling-days', rollingDays: 2 },
    })

    expect(bounds.fromInstant).toBe('2026-09-16T05:00:00.000Z')
    expect(bounds.toInstantExclusive).toBe('2026-09-18T05:00:00.000Z')
    expect(isCanonicalUtcIso(bounds.fromInstant)).toBe(true)
  })

  it('brackets correctly across the spring-forward day, where the offset changes', () => {
    const bounds = windowBounds({
      now: chicago('2026-03-07', '09:00'),
      timezone: CHICAGO,
      window: { mode: 'rolling-days', rollingDays: 3 },
    })

    // 7 March is CST (-06:00), 10 March is CDT (-05:00).
    expect(bounds.fromInstant).toBe('2026-03-07T06:00:00.000Z')
    expect(bounds.toInstantExclusive).toBe('2026-03-10T05:00:00.000Z')
  })
})

describe('generateSlots', () => {
  it('renders instants and labels in the business zone, in summer and in winter', () => {
    const july = generateSlots({
      ...base,
      now: chicago('2026-07-15', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    expect(july[0].slots[0].start).toBe('2026-07-15T15:00:00.000Z')
    expect(july[0].slots[0].label).toBe('10:00 AM')

    const january = generateSlots({
      ...base,
      now: chicago('2026-01-15', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    // Same wall clock, one hour later in UTC: the whole reason labels are server-rendered.
    expect(january[0].slots[0].start).toBe('2026-01-15T16:00:00.000Z')
    expect(january[0].slots[0].label).toBe('10:00 AM')
  })

  it('emits every start and end in the canonical UTC form', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(BUSINESS_HOURS),
      window: { mode: 'rolling-days', rollingDays: 7 },
    })

    const all = days.flatMap((day) => day.slots)

    expect(all.length).toBeGreaterThan(0)

    for (const slot of all) {
      expect(isCanonicalUtcIso(slot.start)).toBe(true)
      expect(isCanonicalUtcIso(slot.end)).toBe(true)
    }
  })

  it('keeps every slot at its configured wall-clock time, including across a transition', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-03-05', '06:00'),
      schedule: everyDay(['09:00', '14:00']),
      window: { mode: 'rolling-days', rollingDays: 10 },
    })

    for (const day of days) {
      for (const slot of day.slots) {
        // The invariant that catches silently normalised instants.
        expect(['09:00', '14:00']).toContain(localTimeOf(slot.start, CHICAGO))
      }
    }
  })

  it('drops a session whose wall-clock time does not exist on the spring-forward day', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-03-08', '00:10'),
      schedule: everyDay(['02:30', '09:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    const day = days.find((entry) => entry.date === SPRING_FORWARD_DAY)

    expect(day?.slots.map((slot) => slot.label)).toEqual(['9:00 AM'])
  })

  it('keeps the first occurrence of an ambiguous time on the fall-back day', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-11-01', '00:10'),
      schedule: everyDay(['01:30']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    const day = days.find((entry) => entry.date === FALL_BACK_DAY)

    // 01:30 CDT (-05:00), the earlier of the two, not 01:30 CST.
    expect(day?.slots[0].start).toBe('2026-11-01T06:30:00.000Z')
  })

  it('keeps a 60-minute slot 60 minutes long across the fall-back hour', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-11-01', '00:10'),
      schedule: everyDay(['01:30']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    const slot = days[0].slots[0]
    const minutes = (Date.parse(slot.end) - Date.parse(slot.start)) / 60_000

    expect(minutes).toBe(60)
  })

  it('offers the same wall-clock times every day of the week after a transition', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-03-08', '00:10'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 7 },
    })

    expect(days).toHaveLength(7)

    for (const day of days) {
      expect(day.slots).toHaveLength(1)
      expect(day.slots[0].label).toBe('10:00 AM')
    }
  })

  it('drops slots inside the minimum notice period', () => {
    const days = generateSlots({
      ...base,
      minNoticeMinutes: 120,
      now: chicago('2026-09-16', '09:30'),
      schedule: everyDay(['09:00', '10:00', '11:00', '12:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    // 09:00 has passed, 10:00 and 11:00 are inside two hours, 12:00 survives (11:30 cutoff).
    expect(days[0].slots.map((slot) => slot.label)).toEqual(['12:00 PM'])
  })

  it('treats minimum notice of zero as "any slot that has not started"', () => {
    const days = generateSlots({
      ...base,
      minNoticeMinutes: 0,
      now: chicago('2026-09-16', '09:59'),
      schedule: everyDay(['09:00', '10:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    expect(days[0].slots.map((slot) => slot.label)).toEqual(['10:00 AM'])
  })

  it('subtracts booked appointments and marks a full slot unavailable', () => {
    const days = generateSlots({
      ...base,
      bookedCounts: { '2026-09-16T15:00:00.000Z': 2 },
      capacityPerSlot: 2,
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['10:00', '11:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    const [ten, eleven] = days[0].slots

    expect(ten).toMatchObject({ available: false, remaining: 0 })
    expect(eleven).toMatchObject({ available: true, remaining: 2 })
  })

  it('never reports negative remaining when capacity is lowered below existing bookings', () => {
    const days = generateSlots({
      ...base,
      bookedCounts: { '2026-09-16T15:00:00.000Z': 3 },
      capacityPerSlot: 1,
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    expect(days[0].slots[0]).toMatchObject({ available: false, remaining: 0 })
  })

  it('closes a blackout day but still returns it, so the UI can say so', () => {
    const days = generateSlots({
      ...base,
      blackouts: [{ endDate: '2026-09-18', startDate: '2026-09-17' }],
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 4 },
    })

    expect(days.map((day) => day.closed)).toEqual([false, true, true, false])
  })

  it('scopes a single-day blackout to that day only', () => {
    const days = generateSlots({
      ...base,
      blackouts: [{ endDate: '2026-09-17', startDate: '2026-09-17' }],
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 3 },
    })

    expect(days.map((day) => day.closed)).toEqual([false, true, false])
  })

  it('closes days the weekly schedule marks shut', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-09-18', '06:00'),
      // Friday 18th open, Saturday and Sunday closed, Monday open again.
      schedule: scheduleOf(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 4 },
    })

    expect(days.map((day) => `${day.date}:${day.closed}`)).toEqual([
      '2026-09-18:false',
      '2026-09-19:true',
      '2026-09-20:true',
      '2026-09-21:false',
    ])
  })

  it('returns days in order and covers the whole window', () => {
    const days = generateSlots({
      ...base,
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['10:00']),
      window: { mode: 'rolling-days', rollingDays: 14 },
    })

    expect(days).toHaveLength(14)
    expect(days[0].date).toBe('2026-09-16')
    expect(days[13].date).toBe('2026-09-29')
    expect([...days].map((day) => day.date).sort()).toEqual(days.map((day) => day.date))
  })

  it('renders 24-hour labels when the host turns off 12-hour time', () => {
    const days = generateSlots({
      ...base,
      labels: { hour12: false, locale: 'en-GB' },
      now: chicago('2026-09-16', '06:00'),
      schedule: everyDay(['14:00']),
      window: { mode: 'rolling-days', rollingDays: 1 },
    })

    expect(days[0].slots[0].label).toBe('14:00')
  })
})

describe('membership helpers', () => {
  const days = generateSlots({
    ...base,
    now: chicago('2026-09-16', '06:00'),
    schedule: everyDay(['10:00', '11:00']),
    window: { mode: 'rolling-days', rollingDays: 1 },
  })

  it('collects every generated start', () => {
    expect(startsInWindow(days)).toEqual(
      new Set(['2026-09-16T15:00:00.000Z', '2026-09-16T16:00:00.000Z']),
    )
  })

  it('matches a submitted start verbatim, rejecting equivalent spellings', () => {
    expect(findSlot(days, '2026-09-16T15:00:00.000Z')).not.toBeNull()

    // Same instant, different spelling. Accepting these would make the match depend on the
    // server's timezone, so the endpoint compares strings, never parsed dates.
    expect(findSlot(days, '2026-09-16T15:00:00Z')).toBeNull()
    expect(findSlot(days, '2026-09-16T10:00:00.000-05:00')).toBeNull()
    expect(findSlot(days, '2026-09-16T10:00:00')).toBeNull()
  })
})
