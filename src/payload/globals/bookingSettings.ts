import type { GlobalConfig } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs, WeeklySchedule } from '../../types.js'

import { validateWeeklySchedule } from '../../core/schedule.js'
import { weeklyScheduleField } from '../fields/weeklySchedule.js'
import { throwScheduleError, validateResourceOverrides } from '../hooks/validateSchedule.js'
import { resolveTimezones } from '../timezones.js'

export const bookingSettingsGlobal = (args: {
  options: BookingPluginOptions
  previewComponent?: string
  rowLabelComponent?: string
  slugs: ResolvedSlugs
}): GlobalConfig => {
  const { options, previewComponent, rowLabelComponent, slugs } = args
  const timezones = resolveTimezones(options.supportedTimezones)

  return {
    slug: slugs.settings,
    access: {
      // No public read: availability uses the Local API, which bypasses access control.
      // Without this, any logged-in user of any auth collection on the host could rewrite
      // the schedule and the notification addresses through the REST API.
      read: options.access.manage,
      update: options.access.configure,
    },
    admin: {
      description: 'When you take appointments, how long they are, and who is told about them.',
      group: 'Bookings',
    },
    fields: [
      {
        name: 'timezone',
        type: 'select',
        admin: {
          description:
            'The timezone your business runs in. Every time on this page, on your website and in emails is shown in this zone.',
        },
        label: 'Timezone',
        options: timezones,
        required: true,
      },
      {
        name: 'slotDurationMinutes',
        type: 'number',
        admin: {
          description: 'How long one appointment lasts, in minutes.',
          step: 5,
        },
        defaultValue: 60,
        label: 'Appointment length (minutes)',
        min: 5,
        required: true,
      },
      {
        name: 'capacityPerSlot',
        type: 'number',
        admin: {
          description:
            'How many appointments can share one start time. Leave at 1 unless you can genuinely see more than one visitor at once.',
        },
        defaultValue: 1,
        label: 'Appointments per start time',
        min: 1,
        required: true,
      },
      {
        name: 'minNoticeMinutes',
        type: 'number',
        admin: {
          description:
            'How far ahead someone must book, in minutes. 120 means the next two hours are never offered. Set 0 to allow booking a slot starting in a minute.',
          step: 15,
        },
        defaultValue: 120,
        label: 'Minimum notice (minutes)',
        min: 0,
        required: true,
      },
      {
        name: 'cancellationCutoffMinutes',
        type: 'number',
        admin: {
          description:
            'How long before the appointment a customer can still cancel themselves, in minutes. 0 lets them cancel right up to the start time.',
          step: 15,
        },
        defaultValue: 0,
        label: 'Cancellation cutoff (minutes)',
        min: 0,
        required: true,
      },
      {
        name: 'bookingWindow',
        type: 'group',
        admin: { description: 'How far into the future visitors can book.' },
        fields: [
          {
            name: 'mode',
            type: 'select',
            admin: {
              description:
                'Rolling days always offers the same number of days ahead. Calendar weeks offers whole weeks, so the last bookable day moves only when a new week starts.',
            },
            defaultValue: 'rolling-days',
            label: 'Window type',
            options: [
              { label: 'A number of days ahead', value: 'rolling-days' },
              { label: 'Whole calendar weeks', value: 'calendar-weeks' },
            ],
            required: true,
          },
          {
            name: 'rollingDays',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.mode !== 'calendar-weeks',
              description: 'Including today. 14 means today plus the next 13 days.',
            },
            defaultValue: 14,
            label: 'Days ahead',
            min: 1,
          },
          {
            name: 'calendarWeeks',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.mode === 'calendar-weeks',
              description: 'Including this week. 2 means this week and next week. Weeks start Monday.',
            },
            defaultValue: 2,
            label: 'Weeks ahead',
            min: 1,
          },
        ],
        label: 'Booking window',
      },
      weeklyScheduleField({
        name: 'weeklySchedule',
        dbPrefix: 'bs',
        label: 'Opening times',
        previewComponent,
        rowLabelComponent,
      }),
      {
        name: 'location',
        type: 'text',
        admin: {
          description:
            'The address customers should come to. Shown in the confirmation email and in the calendar invitation.',
        },
        label: 'Address',
        required: true,
      },
      {
        name: 'phone',
        type: 'text',
        admin: {
          description:
            'The number customers should call. Shown on the cancellation page and in emails.',
        },
        label: 'Business phone',
        required: true,
      },
      {
        name: 'notificationEmails',
        type: 'array',
        admin: {
          description: 'Everyone here is emailed when a booking is made or cancelled.',
        },
        dbName: 'bs_notify',
        fields: [
          {
            name: 'email',
            type: 'email',
            label: 'Email address',
            required: true,
          },
        ],
        label: 'Who to notify',
        labels: { plural: 'addresses', singular: 'address' },
        minRows: 1,
        required: true,
      },
      {
        name: 'confirmationNote',
        type: 'textarea',
        admin: {
          description:
            'Added to the end of the confirmation email. Use it for parking directions, what to bring, and so on.',
        },
        label: 'Note for the confirmation email',
      },
    ],
    hooks: {
      beforeValidate: [
        async ({ data, originalDoc, req }) => {
          if (!data) {
            return data
          }

          const merged = { ...originalDoc, ...data } as {
            slotDurationMinutes?: number
            weeklySchedule?: WeeklySchedule
          }
          const duration = merged.slotDurationMinutes ?? 60

          if (merged.weeklySchedule) {
            const issues = validateWeeklySchedule(merged.weeklySchedule, duration)

            if (issues.length > 0) {
              throwScheduleError({ field: 'weeklySchedule', issues, req })
            }
          }

          const durationChanged =
            typeof data.slotDurationMinutes === 'number' &&
            originalDoc &&
            (originalDoc as { slotDurationMinutes?: number }).slotDurationMinutes !==
              data.slotDurationMinutes

          if (durationChanged && req) {
            await validateResourceOverrides({
              req,
              resourcesSlug: slugs.resources,
              slotDurationMinutes: duration,
            })
          }

          return data
        },
      ],
    },
    label: 'Booking Settings',
  }
}
