import type { CollectionConfig } from 'payload'

import { ValidationError } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from '../../types.js'

import { isValidLocalDate } from '../../core/time.js'
import { SLOT_HOLDING_STATUSES } from '../../types.js'
import { collectionSlug } from '../slugs.js'

const dateValidator = (value: unknown): string | true =>
  typeof value === 'string' && isValidLocalDate(value)
  ? true
  : 'Use a date in the form 2026-10-21.'

/** "3 appointments fall on 21–22 Oct. Cancel them first, or pick other dates." */
const formatRange = (startDate: string, endDate: string): string =>
  startDate === endDate ? startDate : `${startDate} to ${endDate}`

/**
 * Days the business is closed. Whole local days only.
 *
 * Dates are stored as text, not as a date field: a date-only value must never shift with a
 * timezone, and "21 October" has to mean the same day whatever the server or the admin
 * user's browser thinks.
 */
export const blackoutDatesCollection = (args: {
  options: BookingPluginOptions
  slugs: ResolvedSlugs
}): CollectionConfig => {
  const { options, slugs } = args

  return {
    slug: slugs.blackoutDates,
    access: {
      create: options.access.configure,
      delete: options.access.configure,
      read: options.access.configure,
      update: options.access.configure,
    },
    admin: {
      defaultColumns: ['startDate', 'endDate', 'reason'],
      description: 'Days you are closed. These are removed from what visitors can book.',
      group: 'Bookings',
      useAsTitle: 'startDate',
    },
    fields: [
      {
        name: 'startDate',
        type: 'text',
        admin: {
          description: 'First closed day, in the form 2026-10-21.',
          placeholder: '2026-10-21',
        },
        index: true,
        label: 'From',
        required: true,
        validate: dateValidator,
      },
      {
        name: 'endDate',
        type: 'text',
        admin: {
          description: 'Last closed day. Use the same date as "From" to close a single day.',
          placeholder: '2026-10-22',
        },
        index: true,
        label: 'To',
        required: true,
        validate: (value: unknown, { siblingData }: { siblingData?: { startDate?: string } }) => {
          const base = dateValidator(value)

          if (base !== true) {
            return base
          }

          const start = siblingData?.startDate

          if (typeof start === 'string' && typeof value === 'string' && value < start) {
            return 'The last closed day cannot be before the first one.'
          }

          return true
        },
      },
      {
        name: 'reason',
        type: 'text',
        admin: { description: 'For your own reference. Customers never see this.' },
        label: 'Reason',
      },
      {
        name: 'resource',
        type: 'relationship',
        admin: {
          description: 'Leave blank to close every location.',
        },
        label: 'Location',
        relationTo: collectionSlug(slugs.resources),
      },
    ],
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, req }) => {
          const merged = { ...originalDoc, ...data } as {
            endDate?: string
            resource?: unknown
            startDate?: string
          }

          if (!merged.startDate || !merged.endDate || !req) {
            return data
          }

          const resourceValue =
            merged.resource && typeof merged.resource === 'object' && 'id' in merged.resource
              ? (merged.resource as { id: unknown }).id
              : merged.resource

          // Compare on the stored local date, never on the UTC instant: at a day boundary
          // the instant belongs to the neighbouring local day and the guard would miss it.
          const { totalDocs } = await req.payload.count({
            collection: collectionSlug(slugs.appointments),
            req,
            where: {
              slotLocalDate: {
                greater_than_equal: merged.startDate,
                less_than_equal: merged.endDate,
              },
              status: { in: [...SLOT_HOLDING_STATUSES] },
              ...(resourceValue ? { resource: { equals: resourceValue } } : {}),
            },
          })

          if (totalDocs > 0) {
            const plural = totalDocs === 1 ? 'appointment falls' : 'appointments fall'

            throw new ValidationError(
              {
                errors: [
                  {
                    message:
                      `${totalDocs} ${plural} on ${formatRange(merged.startDate, merged.endDate)}. ` +
                      `Cancel them first, or pick other dates.`,
                    path: 'startDate',
                  },
                ],
              },
              req.t,
            )
          }

          return data
        },
      ],
    },
    labels: { plural: 'Closed Dates', singular: 'Closed Date' },
  }
}
