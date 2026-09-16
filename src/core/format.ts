import type { BookingLabelOptions } from '../types.js'

import { localDateOf, localTimeOf } from './time.js'

export const DEFAULT_LABEL_OPTIONS: Required<BookingLabelOptions> = {
  hour12: true,
  locale: 'en-US',
}

export type ResolvedLabelOptions = Required<BookingLabelOptions>

export const resolveLabelOptions = (labels?: BookingLabelOptions): ResolvedLabelOptions => ({
  ...DEFAULT_LABEL_OPTIONS,
  ...labels,
})

/**
 * Every human-readable time and date in the plugin comes from here: slot buttons, day
 * headings, the appointment title, the email view models and the cancel page. One
 * formatter means the label on a button and the time in the confirmation email can never
 * disagree (spec §7, D14).
 *
 * Storage is separate and deliberately not localised: `slotLocalDate` is `YYYY-MM-DD` and
 * `slotLocalTime` is 24-hour `HH:mm`, so both sort correctly as text in the admin list.
 */
export const createFormatter = (timezone: string, labels?: BookingLabelOptions) => {
  const { hour12, locale } = resolveLabelOptions(labels)

  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12,
    minute: '2-digit',
    timeZone: timezone,
  })

  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
    weekday: 'short',
  })

  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
  })

  const asDate = (instant: Date | number | string): Date =>
    new Date(instant instanceof Date ? instant.getTime() : instant)

  return {
    /** Human date for emails and the cancel page: "Thursday, 18 September 2026". */
    dateLabel: (instant: Date | number | string): string => date.format(asDate(instant)),

    /** Day strip heading: "Thu, 18 Sep". */
    dayLabel: (instant: Date | number | string): string => day.format(asDate(instant)),

    /** Stored, sortable local date: "2026-09-18". */
    localDate: (instant: Date | number | string): string => localDateOf(instant, timezone),

    /** Stored, sortable local time: "14:00". */
    localTime: (instant: Date | number | string): string => localTimeOf(instant, timezone),

    /** Slot button and email time: "2:00 PM" (or "14:00" when hour12 is false). */
    timeLabel: (instant: Date | number | string): string => time.format(asDate(instant)),

    timezone,

    /** `admin.useAsTitle` value: "Jane Doe — Thu, 18 Sep 2:00 PM". */
    title: (customerName: string, instant: Date | number | string): string =>
      `${customerName} — ${day.format(asDate(instant))} ${time.format(asDate(instant))}`,
  }
}

export type BookingFormatter = ReturnType<typeof createFormatter>
