import { defaultTimezones } from 'payload/shared'

import type { BookingPluginOptions } from '../types.js'

export type TimezoneOption = { label: string; value: string }

/**
 * One timezone list, used by the settings select and by the companion field Payload
 * injects next to `slotStart`.
 *
 * They have to be the same list: the companion is a select validated against its options,
 * so a business zone missing from it would make every appointment write fail. Payload's
 * own list has 47 entries; a host needing another zone extends it through the option
 * rather than the plugin inventing a second list.
 *
 * Never derived from `Intl.supportedValuesOf('timeZone')`: on PostgreSQL a select becomes
 * an enum, and that list changes with the Node version, so the schema would drift on a
 * runtime upgrade.
 */
export const resolveTimezones = (
  supportedTimezones?: BookingPluginOptions['supportedTimezones'],
): TimezoneOption[] => {
  if (typeof supportedTimezones !== 'function') {
    return [...defaultTimezones]
  }

  const resolved = supportedTimezones({ defaultTimezones: [...defaultTimezones] })

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(
      '[payload-booking] supportedTimezones must return a non-empty array of { label, value }.',
    )
  }

  return resolved
}

/** Fail at init with a readable message rather than at the first booking. */
export const assertTimezoneSupported = (timezone: string, options: TimezoneOption[]): void => {
  if (!options.some((option) => option.value === timezone)) {
    throw new Error(
      `[payload-booking] timezone "${timezone}" is not in the supported list. ` +
        `Either pick one of the ${options.length} supported zones, or extend the list with the ` +
        `supportedTimezones option. The settings select and the appointment timezone field must ` +
        `use the same list.`,
    )
  }
}
