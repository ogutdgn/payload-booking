import type { Field, GroupField } from 'payload'

import type { Weekday } from '../../types.js'

import { WEEKDAYS } from '../../core/schedule.js'
import { isValidTime } from '../../core/time.js'

/** Monday first for the admin, even though WEEKDAYS is indexed Sunday-first for `getDay()`. */
export const ADMIN_WEEK_ORDER: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const titleCase = (day: Weekday): string => day.charAt(0).toUpperCase() + day.slice(1)

/**
 * PostgreSQL truncates identifiers at 63 characters, and the generated index names for a
 * nested array run to about 14 characters beyond the table name. `weeklySchedule.wednesday
 * .sessionStarts` under a long slug overflows that, and the truncated name reads as a diff
 * on every boot, so the schema push drops and recreates the indexes each time.
 *
 * Short explicit names keep every derived identifier inside the limit (C03).
 */
const DAY_ABBREVIATIONS: Record<Weekday, string> = {
  friday: 'fri',
  monday: 'mon',
  saturday: 'sat',
  sunday: 'sun',
  thursday: 'thu',
  tuesday: 'tue',
  wednesday: 'wed',
}

export type WeeklyScheduleFieldArgs = {
  /** Short prefix for array table names, e.g. 'bs' for settings, 'br' for resources. */
  dbPrefix: string
  /** Rendered under each day, showing the resulting slots. Omitted where it cannot work. */
  previewComponent?: string
}

const dayGroup = (day: Weekday, args: WeeklyScheduleFieldArgs): GroupField => {
  const label = titleCase(day)
  const fields: Field[] = [
    {
      name: 'open',
      type: 'checkbox',
      admin: {
        description: `Tick if you take appointments on ${label}s.`,
      },
      defaultValue: day !== 'sunday',
      label: `Open on ${label}s`,
    },
    {
      name: 'sessionStarts',
      type: 'array',
      admin: {
        condition: (_, siblingData) => Boolean(siblingData?.open),
        description:
          'The times an appointment can start, in 24-hour form such as 09:00 or 14:30. ' +
          'To skip a lunch hour, simply leave that time out.',
      },
      dbName: `${args.dbPrefix}_${DAY_ABBREVIATIONS[day]}_starts`,
      fields: [
        {
          name: 'time',
          type: 'text',
          label: 'Start time',
          required: true,
          validate: (value: unknown) =>
            typeof value === 'string' && isValidTime(value)
              ? true
              : 'Use a 24-hour time such as 09:00 or 14:30.',
        },
      ],
      label: `${label} start times`,
      labels: { plural: 'start times', singular: 'start time' },
    },
  ]

  if (args.previewComponent) {
    fields.push({
      name: 'preview',
      type: 'ui',
      admin: {
        components: {
          Field: {
            clientProps: { day },
            path: args.previewComponent,
          },
        },
        disableListColumn: true,
      },
    })
  }

  return {
    name: day,
    type: 'group',
    fields,
    label,
  }
}

/**
 * Seven named groups, not an array: a day cannot then be deleted, duplicated or reordered,
 * and "is Monday open?" is a lookup rather than a search.
 *
 * Start times are listed explicitly rather than derived from opening hours plus a step,
 * so skipping a lunch hour is a deleted row instead of a rule the owner has to express.
 */
export const weeklyScheduleField = (
  args: { label: string; name: string } & WeeklyScheduleFieldArgs,
): GroupField => ({
  name: args.name,
  type: 'group',
  admin: {
    description:
      'Which days you are open, and the times an appointment can start on each day.',
  },
  fields: ADMIN_WEEK_ORDER.map((day) => dayGroup(day, args)),
  label: args.label,
})

/** Every weekday, in the order Payload stores them. */
export const scheduleWeekdays = (): Weekday[] => [...WEEKDAYS]
