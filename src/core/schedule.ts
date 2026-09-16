import type { Weekday, WeeklySchedule } from '../types.js'

import { isValidTime, parseTime } from './time.js'

/** Index order matches `Date#getDay()` (0 = Sunday). */
export const WEEKDAYS: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

export const weekdayFromIndex = (index: number): Weekday => WEEKDAYS[index % 7]

const minutesOf = (time: string): number => {
  const { hour, minute } = parseTime(time)

  return hour * 60 + minute
}

export type DayScheduleIssue = {
  day: Weekday
  message: string
}

/**
 * The one schedule rule, used by the settings hook, the resource-override hook and the
 * admin preview (spec §6.1). Pure so all three agree and it is cheap to test.
 *
 * Rejects: malformed times, duplicates, starts closer together than the slot length, and
 * a session whose end would pass local midnight.
 *
 * Why spacing matters: capacity is counted per start instant, so 10:00 and 10:30 with
 * 60-minute slots would each sell at full capacity and double-staff the showroom (D10).
 */
export const validateDaySchedule = (
  day: Weekday,
  sessionStarts: string[],
  slotDurationMinutes: number,
): DayScheduleIssue[] => {
  const issues: DayScheduleIssue[] = []

  for (const time of sessionStarts) {
    if (!isValidTime(time)) {
      issues.push({ day, message: `"${time}" is not a valid time. Use 24-hour HH:mm, such as 09:00.` })
    }
  }

  if (issues.length > 0) {
    return issues
  }

  const sorted = [...sessionStarts].sort()

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      issues.push({ day, message: `${sorted[index]} is listed twice. Each start time appears once.` })
    }
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const gap = minutesOf(sorted[index]) - minutesOf(sorted[index - 1])

    if (gap > 0 && gap < slotDurationMinutes) {
      issues.push({
        day,
        message: `${sorted[index - 1]} and ${sorted[index]} overlap: slots are ${slotDurationMinutes} minutes long.`,
      })
    }
  }

  for (const time of sorted) {
    if (minutesOf(time) + slotDurationMinutes > 24 * 60) {
      issues.push({
        day,
        message: `${time} plus ${slotDurationMinutes} minutes crosses midnight. End the day earlier.`,
      })
    }
  }

  return issues
}

/** Run `validateDaySchedule` across a whole week. */
export const validateWeeklySchedule = (
  schedule: WeeklySchedule,
  slotDurationMinutes: number,
): DayScheduleIssue[] =>
  WEEKDAYS.flatMap((day) => {
    const entry = schedule?.[day]

    if (!entry?.open) {
      return []
    }

    return validateDaySchedule(
      day,
      (entry.sessionStarts ?? []).map((row) => row.time),
      slotDurationMinutes,
    )
  })

/** Sorted, de-duplicated start times for one day. Empty when the day is closed. */
export const startsForDay = (schedule: WeeklySchedule, day: Weekday): string[] => {
  const entry = schedule?.[day]

  if (!entry?.open) {
    return []
  }

  const seen = new Set<string>()

  for (const row of entry.sessionStarts ?? []) {
    if (row?.time && isValidTime(row.time)) {
      seen.add(row.time)
    }
  }

  return [...seen].sort()
}

/**
 * Which schedule applies to a location: its own override only when the override is
 * switched on, otherwise the global one.
 *
 * A Payload group has no "absent" state (it materialises as `{}`), so a checkbox is the
 * only honest way to distinguish "inherit" from "deliberately closed every day" (F33).
 */
export const resolveSchedule = (args: {
  globalSchedule: WeeklySchedule
  resource?: { scheduleOverride?: null | WeeklySchedule; useScheduleOverride?: boolean } | null
}): WeeklySchedule => {
  const { globalSchedule, resource } = args

  if (resource?.useScheduleOverride && resource.scheduleOverride) {
    return resource.scheduleOverride
  }

  return globalSchedule
}
