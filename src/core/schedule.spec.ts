import { describe, expect, it } from 'vitest'

import type { WeeklySchedule } from '../types.js'

import { everyDay, scheduleOf } from './fixtures.js'
import {
  resolveSchedule,
  startsForDay,
  validateDaySchedule,
  validateWeeklySchedule,
  weekdayFromIndex,
} from './schedule.js'

describe('weekdayFromIndex', () => {
  it('matches Date#getDay, where 0 is Sunday', () => {
    expect(weekdayFromIndex(0)).toBe('sunday')
    expect(weekdayFromIndex(1)).toBe('monday')
    expect(weekdayFromIndex(6)).toBe('saturday')
  })
})

describe('validateDaySchedule', () => {
  it('accepts hourly starts with hour-long slots', () => {
    expect(validateDaySchedule('monday', ['09:00', '10:00', '11:00'], 60)).toEqual([])
  })

  it('rejects starts closer together than the slot length', () => {
    // The case the rule exists for: both would sell at full capacity and the showroom
    // would be double-staffed at 10:30.
    const issues = validateDaySchedule('monday', ['10:00', '10:30'], 60)

    expect(issues).toHaveLength(1)
    expect(issues[0].message).toBe('10:00 and 10:30 overlap: slots are 60 minutes long.')
  })

  it('accepts the same starts once the slot length fits', () => {
    expect(validateDaySchedule('monday', ['10:00', '10:30'], 30)).toEqual([])
  })

  it('reports the offending pair in a sentence the owner can act on', () => {
    const [issue] = validateDaySchedule('tuesday', ['09:00', '09:15', '11:00'], 60)

    expect(issue.message).toContain('09:00 and 09:15')
    expect(issue.day).toBe('tuesday')
  })

  it('rejects a duplicate start time', () => {
    const issues = validateDaySchedule('monday', ['10:00', '10:00'], 60)

    expect(issues.some((issue) => issue.message.includes('listed twice'))).toBe(true)
  })

  it('rejects a session that would run past midnight', () => {
    const issues = validateDaySchedule('monday', ['23:30'], 60)

    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('crosses midnight')
  })

  it('allows a session that ends exactly at midnight', () => {
    expect(validateDaySchedule('monday', ['23:00'], 60)).toEqual([])
  })

  it('rejects malformed times before looking at spacing', () => {
    const issues = validateDaySchedule('monday', ['9:00', '25:00', 'noon'], 60)

    expect(issues).toHaveLength(3)
    expect(issues.every((issue) => issue.message.includes('24-hour HH:mm'))).toBe(true)
  })

  it('is order-independent, because the admin can add rows in any order', () => {
    expect(validateDaySchedule('monday', ['10:30', '10:00'], 60)).toHaveLength(1)
  })

  it('accepts an empty day', () => {
    expect(validateDaySchedule('sunday', [], 60)).toEqual([])
  })
})

describe('validateWeeklySchedule', () => {
  it('ignores closed days, however they are filled in', () => {
    const schedule = everyDay(['10:00', '10:30'])

    schedule.sunday = { open: false, sessionStarts: [{ time: '10:00' }, { time: '10:30' }] }

    const days = new Set(validateWeeklySchedule(schedule, 60).map((issue) => issue.day))

    expect(days.has('sunday')).toBe(false)
    expect(days.size).toBe(6)
  })

  it('passes a realistic showroom week', () => {
    const schedule = scheduleOf(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'])

    expect(validateWeeklySchedule(schedule, 60)).toEqual([])
  })

  it('catches a duration change that makes an existing week overlap', () => {
    // What happens when the owner raises the slot length from 30 to 60 minutes.
    const schedule = scheduleOf(['09:00', '09:30'])

    expect(validateWeeklySchedule(schedule, 30)).toEqual([])
    expect(validateWeeklySchedule(schedule, 60).length).toBeGreaterThan(0)
  })
})

describe('startsForDay', () => {
  it('sorts and de-duplicates', () => {
    const schedule = everyDay([])

    schedule.monday = {
      open: true,
      sessionStarts: [{ time: '11:00' }, { time: '09:00' }, { time: '11:00' }],
    }

    expect(startsForDay(schedule, 'monday')).toEqual(['09:00', '11:00'])
  })

  it('returns nothing for a closed day', () => {
    expect(startsForDay(scheduleOf(['10:00']), 'sunday')).toEqual([])
  })

  it('skips malformed rows rather than throwing', () => {
    const schedule = everyDay([])

    schedule.monday = { open: true, sessionStarts: [{ time: '10:00' }, { time: 'nope' }] }

    expect(startsForDay(schedule, 'monday')).toEqual(['10:00'])
  })

  it('tolerates a missing day entry', () => {
    expect(startsForDay({} as WeeklySchedule, 'monday')).toEqual([])
  })
})

describe('resolveSchedule', () => {
  const globalSchedule = everyDay(['09:00'])
  const override = everyDay(['14:00'])

  it('uses the global schedule when the location does not override', () => {
    expect(resolveSchedule({ globalSchedule, resource: null })).toBe(globalSchedule)
    expect(resolveSchedule({ globalSchedule, resource: { useScheduleOverride: false } })).toBe(
      globalSchedule,
    )
  })

  it('uses the override only when the switch is on', () => {
    // A Payload group always materialises as an object, so "is it present" cannot be
    // asked; the checkbox is the only honest way to express "inherit".
    expect(
      resolveSchedule({
        globalSchedule,
        resource: { scheduleOverride: override, useScheduleOverride: false },
      }),
    ).toBe(globalSchedule)

    expect(
      resolveSchedule({
        globalSchedule,
        resource: { scheduleOverride: override, useScheduleOverride: true },
      }),
    ).toBe(override)
  })

  it('distinguishes a deliberately closed location from an inheriting one', () => {
    const closed = scheduleOf([], [])

    expect(
      resolveSchedule({
        globalSchedule,
        resource: { scheduleOverride: closed, useScheduleOverride: true },
      }),
    ).toBe(closed)
  })
})
