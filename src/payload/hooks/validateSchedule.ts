import type { PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import type { Weekday, WeeklySchedule } from '../../types.js'

import { validateWeeklySchedule } from '../../core/schedule.js'
import { collectionSlug } from '../slugs.js'

const titleCase = (day: Weekday): string => day.charAt(0).toUpperCase() + day.slice(1)

/** Turn schedule issues into one readable sentence, prefixed by the day. */
export const scheduleErrorMessage = (
  issues: { day: Weekday; message: string }[],
  prefix?: string,
): string => {
  const [first] = issues
  const lead = prefix ? `${prefix}: ` : ''

  if (issues.length === 1) {
    return `${lead}${titleCase(first.day)} — ${first.message}`
  }

  return `${lead}${titleCase(first.day)} — ${first.message} (${issues.length - 1} more to fix)`
}

export const throwScheduleError = (args: {
  field: string
  issues: { day: Weekday; message: string }[]
  prefix?: string
  req?: PayloadRequest
}): never => {
  throw new ValidationError(
    {
      errors: [{ message: scheduleErrorMessage(args.issues, args.prefix), path: args.field }],
    },
    args.req?.t,
  )
}

/**
 * Re-check every location override when the slot duration changes.
 *
 * The overrides are validated when their own document saves, but nothing re-runs that when
 * the duration changes on the settings global. Raising the duration would otherwise leave
 * an override selling starts closer together than a slot is long, which is exactly what
 * the spacing rule exists to prevent (D10).
 */
export const validateResourceOverrides = async (args: {
  req: PayloadRequest
  resourcesSlug: string
  slotDurationMinutes: number
}): Promise<void> => {
  const { req, resourcesSlug, slotDurationMinutes } = args

  const { docs } = await req.payload.find({
    collection: collectionSlug(resourcesSlug),
    depth: 0,
    limit: 500,
    pagination: false,
    req,
    where: { useScheduleOverride: { equals: true } },
  })

  for (const doc of docs as { name?: string; scheduleOverride?: WeeklySchedule }[]) {
    if (!doc.scheduleOverride) {
      continue
    }

    const issues = validateWeeklySchedule(doc.scheduleOverride, slotDurationMinutes)

    if (issues.length > 0) {
      throwScheduleError({
        field: 'slotDurationMinutes',
        issues,
        prefix: doc.name ?? 'A location',
        req,
      })
    }
  }
}
