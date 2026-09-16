import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'

/**
 * Normalise any instant to the canonical UTC ISO form Payload's adapters return.
 *
 * `TZDate#toISOString()` returns the *offset* form ('…T10:00:00.000-05:00'), while both
 * database adapters hand back `Date.prototype.toISOString()` ('…T15:00:00.000Z'). Slot
 * starts, `bookedCounts` keys, the lock key and the membership re-check all compare these
 * strings verbatim, so every one of them goes through this function. `getTime()` is the
 * true epoch for a TZDate, so the conversion is lossless.
 */
export const toUtcIso = (value: Date | number | string): string =>
  new Date(value instanceof Date ? value.getTime() : value).toISOString()

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** True when a string is exactly the canonical form `toUtcIso` produces. */
export const isCanonicalUtcIso = (value: string): boolean => ISO_UTC.test(value)

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export type LocalDateParts = { day: number; month: number; year: number }

/** Parse a `YYYY-MM-DD` string. Throws on any other shape, including missing zero padding. */
export const parseLocalDate = (date: string): LocalDateParts => {
  const match = LOCAL_DATE.exec(date)

  if (!match) {
    throw new Error(`[payload-booking] Expected a YYYY-MM-DD date, received "${date}".`)
  }

  return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) }
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

export type TimeParts = { hour: number; minute: number }

/** Parse an `HH:mm` string. Throws on any other shape. */
export const parseTime = (time: string): TimeParts => {
  const match = HH_MM.exec(time)

  if (!match) {
    throw new Error(`[payload-booking] Expected an HH:mm time, received "${time}".`)
  }

  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** True when a string is a valid zero-padded `HH:mm`. */
export const isValidTime = (time: string): boolean => HH_MM.test(time)

/** True when a string is a valid zero-padded `YYYY-MM-DD` naming a real calendar day. */
export const isValidLocalDate = (date: string): boolean => {
  const match = LOCAL_DATE.exec(date)

  if (!match) {
    return false
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/**
 * Build the instant for a wall-clock time in a timezone.
 *
 * Always the numeric-parts constructor: `new TZDate('2026-07-15T10:00', zone)` parses an
 * offset-less string in the *process* timezone, which is wrong on a UTC server.
 */
export const zonedInstant = (
  date: LocalDateParts,
  time: TimeParts,
  timezone: string,
): TZDate => new TZDate(date.year, date.month - 1, date.day, time.hour, time.minute, 0, timezone)

/** Midday in the given zone. Used for day iteration, where midnight can be a DST gap. */
export const zonedMidday = (date: LocalDateParts, timezone: string): TZDate =>
  zonedInstant(date, { hour: 12, minute: 0 }, timezone)

/** The local calendar date of an instant, in the given zone. */
export const localDateOf = (instant: Date | number | string, timezone: string): string =>
  format(new TZDate(new Date(instant instanceof Date ? instant.getTime() : instant), timezone), 'yyyy-MM-dd')

/** The local 24-hour wall time of an instant, in the given zone. */
export const localTimeOf = (instant: Date | number | string, timezone: string): string =>
  format(new TZDate(new Date(instant instanceof Date ? instant.getTime() : instant), timezone), 'HH:mm')

/** Weekday index (0 = Sunday) of a local date in the given zone. */
export const weekdayIndexOf = (date: string, timezone: string): number =>
  zonedMidday(parseLocalDate(date), timezone).getDay()

/** Shift a local date by whole days, staying on the calendar rather than adding milliseconds. */
export const shiftLocalDate = (date: string, days: number, timezone: string): string => {
  const shifted = addDays(zonedMidday(parseLocalDate(date), timezone), days)

  return format(shifted, 'yyyy-MM-dd')
}

/** Inclusive list of local dates from `first` to `last`. */
export const eachLocalDate = (first: string, last: string, timezone: string): string[] => {
  if (last < first) {
    return []
  }

  const dates: string[] = []
  let cursor = first

  // Bounded so a malformed range can never spin: the longest window the plugin offers is
  // a year, and anything beyond that is a configuration error rather than a schedule.
  for (let guard = 0; guard < 400 && cursor <= last; guard += 1) {
    dates.push(cursor)
    cursor = shiftLocalDate(cursor, 1, timezone)
  }

  return dates
}

/** The earliest instant of a local day, as canonical UTC ISO. */
export const startOfLocalDayIso = (date: string, timezone: string): string =>
  toUtcIso(zonedInstant(parseLocalDate(date), { hour: 0, minute: 0 }, timezone))

/** True when `date` falls inside any inclusive blackout range. Plain string comparison. */
export const isBlackedOut = (
  date: string,
  blackouts: { endDate: string; startDate: string }[],
): boolean => blackouts.some((range) => date >= range.startDate && date <= range.endDate)
