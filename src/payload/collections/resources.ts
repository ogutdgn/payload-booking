import type { CollectionConfig } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs, WeeklySchedule } from '../../types.js'

import { validateWeeklySchedule } from '../../core/schedule.js'
import { weeklyScheduleField } from '../fields/weeklySchedule.js'
import { throwScheduleError } from '../hooks/validateSchedule.js'
import { globalSlug } from '../slugs.js'

/** URL-safe, stable, and predictable enough for a host to reference as 'showroom'. */
export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    // Strip combining marks left by the decomposition, so "Şişli" becomes "sisli".
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'location'

/**
 * What gets booked. Version 1 has exactly one row; the model carries the seam for more.
 *
 * Kept visible in the admin rather than hidden, so the data model is honest about there
 * being a location at all, and adding a second one later is a row rather than a migration.
 */
export const resourcesCollection = (args: {
  options: BookingPluginOptions
  slugs: ResolvedSlugs
}): CollectionConfig => {
  const { options, slugs } = args

  return {
    slug: slugs.resources,
    access: {
      // Nothing public reads this: availability uses the Local API, and the booking form
      // gets id, slug and name from the plugin's own endpoint. Public read here would
      // expose the override schedule and the capacity to anyone.
      create: options.access.configure,
      delete: options.access.configure,
      read: options.access.configure,
      update: options.access.configure,
    },
    admin: {
      defaultColumns: ['name', 'slug', 'active'],
      description: 'The places or people that appointments are booked with.',
      group: 'Bookings',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        admin: { description: 'What customers see, such as "Showroom".' },
        label: 'Name',
        required: true,
      },
      {
        name: 'slug',
        type: 'text',
        admin: {
          description:
            'A short identifier used in links. Filled in from the name if you leave it blank.',
          position: 'sidebar',
        },
        index: true,
        label: 'Identifier',
        unique: true,
      },
      {
        name: 'active',
        type: 'checkbox',
        admin: {
          description: 'Untick to stop offering appointments here without deleting anything.',
          position: 'sidebar',
        },
        defaultValue: true,
        label: 'Taking bookings',
      },
      {
        name: 'capacityPerSlot',
        type: 'number',
        admin: {
          description:
            'Leave blank to use the number from Booking Settings. Set it only if this location differs.',
        },
        label: 'Appointments per start time (override)',
        min: 1,
      },
      {
        name: 'useScheduleOverride',
        type: 'checkbox',
        admin: {
          description:
            'Tick if this location has its own opening times. Otherwise it follows Booking Settings.',
        },
        defaultValue: false,
        label: 'Use different opening times',
      },
      {
        ...weeklyScheduleField({
          name: 'scheduleOverride',
          dbPrefix: 'br',
          label: 'Opening times for this location',
        }),
        admin: {
          condition: (data) => Boolean(data?.useScheduleOverride),
          description: 'Used instead of the times in Booking Settings.',
        },
      },
    ],
    hooks: {
      beforeValidate: [
        async ({ data, originalDoc, req }) => {
          if (!data) {
            return data
          }

          if (!data.slug && (data.name || (originalDoc as { name?: string })?.name)) {
            data.slug = slugify(String(data.name ?? (originalDoc as { name?: string }).name))
          }

          const merged = { ...originalDoc, ...data } as {
            scheduleOverride?: WeeklySchedule
            useScheduleOverride?: boolean
          }

          if (merged.useScheduleOverride && merged.scheduleOverride && req) {
            const settings = (await req.payload.findGlobal({
              slug: globalSlug(slugs.settings),
              depth: 0,
              req,
            })) as { slotDurationMinutes?: number }

            const issues = validateWeeklySchedule(
              merged.scheduleOverride,
              settings?.slotDurationMinutes ?? 60,
            )

            if (issues.length > 0) {
              throwScheduleError({ field: 'scheduleOverride', issues, req })
            }
          }

          return data
        },
      ],
    },
    labels: { plural: 'Bookable Locations', singular: 'Bookable Location' },
  }
}
