import type { Weekday, WeeklySchedule } from '../types.js'

import { WEEKDAYS } from './schedule.js'

export const CHICAGO = 'America/Chicago'

/**
 * Daylight-saving transitions in the business zone. Both are Sundays.
 *
 * 2026-03-08: clocks jump 02:00 -> 03:00, so 02:30 does not exist that day.
 * 2026-11-01: clocks fall 02:00 -> 01:00, so 01:30 happens twice.
 *
 * These are fixtures rather than ad-hoc dates because the bugs they catch are seasonal:
 * code that adds 86 400 000 ms to get "tomorrow" is an hour wrong for a week, twice a year.
 */
export const SPRING_FORWARD_DAY = '2026-03-08'
export const FALL_BACK_DAY = '2026-11-01'

/** Build a schedule where the listed days share the same start times. */
export const scheduleOf = (
  starts: string[],
  openDays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
): WeeklySchedule =>
  WEEKDAYS.reduce((schedule, day) => {
    const open = openDays.includes(day)

    schedule[day] = {
      open,
      sessionStarts: open ? starts.map((time) => ({ time })) : [],
    }

    return schedule
  }, {} as WeeklySchedule)

/** Every day open, same times. Keeps window tests free of weekday noise. */
export const everyDay = (starts: string[]): WeeklySchedule => scheduleOf(starts, [...WEEKDAYS])

export const BUSINESS_HOURS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00']
