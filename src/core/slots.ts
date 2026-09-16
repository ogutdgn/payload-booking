import { TZDate } from '@date-fns/tz'
import { addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'

import type { BookingLabelOptions, BookingWindow, WeeklySchedule } from '../types.js'

import { createFormatter } from './format.js'
import { startsForDay, weekdayFromIndex } from './schedule.js'
import {
  eachLocalDate,
  isBlackedOut,
  localTimeOf,
  parseLocalDate,
  parseTime,
  shiftLocalDate,
  startOfLocalDayIso,
  toUtcIso,
  weekdayIndexOf,
  zonedInstant,
} from './time.js'

export type Slot = {
  available: boolean
  /** UTC ISO instant. The only value the client sends back. */
  end: string
  /** Rendered server-side in the business zone, e.g. "10:00 AM". */
  label: string
  remaining: number
  /** UTC ISO instant. The only value the client sends back. */
  start: string
}

export type Day = {
  /** True when the day is closed: a blackout, or no session times configured. */
  closed: boolean
  /** YYYY-MM-DD in the business zone. */
  date: string
  label: string
  slots: Slot[]
}

export type GenerateSlotsInput = {
  blackouts: { endDate: string; startDate: string }[]
  /** Keyed by `toUtcIso(slotStart)`; the count of slot-holding appointments. */
  bookedCounts: Record<string, number>
  capacityPerSlot: number
  labels?: BookingLabelOptions
  minNoticeMinutes: number
  /** Injected. Core never reads the clock, so every test is deterministic. */
  now: Date
  schedule: WeeklySchedule
  slotDurationMinutes: number
  timezone: string
  window: BookingWindow
}

export type WindowBounds = {
  firstDay: string
  /** Canonical UTC ISO: the earliest instant of `firstDay`. */
  fromInstant: string
  lastDay: string
  /** Canonical UTC ISO: the earliest instant of the day after `lastDay`. */
  toInstantExclusive: string
}

/**
 * The booking window as local calendar days, plus the instant range to query the database
 * with.
 *
 * The two agree because sessions never cross local midnight (§6.1) and a slot belongs to
 * the local day of its start, so every slot-holding row whose `slotLocalDate` is inside
 * [firstDay, lastDay] has a `slotStart` inside [fromInstant, toInstantExclusive).
 */
export const windowBounds = (
  input: Pick<GenerateSlotsInput, 'now' | 'timezone' | 'window'>,
): WindowBounds => {
  const { now, timezone, window } = input
  const firstDay = format(new TZDate(new Date(now.getTime()), timezone), 'yyyy-MM-dd')

  let lastDay: string

  if (window.mode === 'rolling-days') {
    const days = Math.max(1, Math.trunc(window.rollingDays))

    lastDay = shiftLocalDate(firstDay, days - 1, timezone)
  } else {
    const weeks = Math.max(1, Math.trunc(window.calendarWeeks))
    // date-fns v4 keeps a TZDate's own zone through these helpers, so the week boundary
    // is the business week, not the server's.
    const anchor = new TZDate(new Date(now.getTime()), timezone)
    const weekStart = startOfWeek(anchor, { weekStartsOn: 1 })
    const end = endOfWeek(addWeeks(weekStart, weeks - 1), { weekStartsOn: 1 })

    lastDay = format(end, 'yyyy-MM-dd')

    // A window that ends before it starts is meaningless; clamp to at least today.
    if (lastDay < firstDay) {
      lastDay = firstDay
    }
  }

  return {
    firstDay,
    fromInstant: startOfLocalDayIso(firstDay, timezone),
    lastDay,
    toInstantExclusive: startOfLocalDayIso(shiftLocalDate(lastDay, 1, timezone), timezone),
  }
}

/**
 * Turn a schedule into the days and slots a visitor may pick.
 *
 * Pure: no I/O, no Payload imports, no clock. `server/availability.ts` gathers the inputs
 * and calls this.
 */
export const generateSlots = (input: GenerateSlotsInput): Day[] => {
  const {
    blackouts,
    bookedCounts,
    capacityPerSlot,
    labels,
    minNoticeMinutes,
    now,
    schedule,
    slotDurationMinutes,
    timezone,
  } = input

  const formatter = createFormatter(timezone, labels)
  const { firstDay, lastDay } = windowBounds(input)
  const earliestStart = now.getTime() + Math.max(0, minNoticeMinutes) * 60_000
  const capacity = Math.max(0, Math.trunc(capacityPerSlot))
  const durationMs = Math.max(1, Math.trunc(slotDurationMinutes)) * 60_000

  return eachLocalDate(firstDay, lastDay, timezone).map((date): Day => {
    const parts = parseLocalDate(date)
    const dayLabel = formatter.dayLabel(zonedInstant(parts, { hour: 12, minute: 0 }, timezone))

    if (isBlackedOut(date, blackouts)) {
      return { closed: true, date, label: dayLabel, slots: [] }
    }

    const weekday = weekdayFromIndex(weekdayIndexOf(date, timezone))
    const starts = startsForDay(schedule, weekday)

    if (starts.length === 0) {
      return { closed: true, date, label: dayLabel, slots: [] }
    }

    const slots: Slot[] = []

    for (const time of starts) {
      const startDate = zonedInstant(parts, parseTime(time), timezone)

      // Spring-forward gap: the configured wall time does not exist on this day, and
      // TZDate silently normalises it forward. Offering a slot whose label disagrees
      // with the configured time would be worse than not offering it.
      if (localTimeOf(startDate, timezone) !== time) {
        continue
      }

      const startMs = startDate.getTime()

      if (startMs < earliestStart) {
        continue
      }

      const start = toUtcIso(startMs)
      const booked = bookedCounts[start] ?? 0
      const remaining = Math.max(0, capacity - booked)

      slots.push({
        available: remaining > 0,
        end: toUtcIso(startMs + durationMs),
        label: formatter.timeLabel(startMs),
        remaining,
        start,
      })
    }

    return { closed: false, date, label: dayLabel, slots }
  })
}

/** Every start in the window, for the endpoint's membership re-check (spec §8). */
export const startsInWindow = (days: Day[]): Set<string> => {
  const starts = new Set<string>()

  for (const day of days) {
    for (const slot of day.slots) {
      starts.add(slot.start)
    }
  }

  return starts
}

/** The slot matching a submitted start, by verbatim string comparison. */
export const findSlot = (days: Day[], start: string): null | Slot => {
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.start === start) {
        return slot
      }
    }
  }

  return null
}
