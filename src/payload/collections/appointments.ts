import type { CollectionConfig, Field } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from '../../types.js'

import { SLOT_HOLDING_STATUSES } from '../../types.js'
import { CONTEXT_EMAIL_LOG, CONTEXT_STATUS_CHANGE, never, onlyPluginWrites } from '../access.js'
import { deriveAppointmentFields } from '../hooks/deriveAppointment.js'
import { collectionSlug } from '../slugs.js'
import { resolveTimezones } from '../timezones.js'

const MAX_EMAIL_LENGTH = 254

export const appointmentsCollection = (args: {
  options: BookingPluginOptions
  slugs: ResolvedSlugs
  statusActionsComponent?: string
  statusLabelComponent?: string
}): CollectionConfig => {
  const { options, slugs, statusActionsComponent, statusLabelComponent } = args
  const timezones = resolveTimezones(options.supportedTimezones)

  const customerFields: Field[] = [
    {
      name: 'name',
      type: 'text',
      access: { update: never },
      admin: { description: 'As the customer typed it.', readOnly: true },
      label: 'Name',
      maxLength: 120,
      required: true,
    },
    {
      name: 'email',
      type: 'email',
      access: { update: never },
      admin: { readOnly: true },
      index: true,
      label: 'Email',
      required: true,
      // The email field type has no maxLength, so the bound lives in a validate. The
      // endpoint's schema applies the same limit before anything is written.
      validate: (value: unknown): string | true =>
        typeof value === 'string' && value.length > MAX_EMAIL_LENGTH
          ? `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`
          : true,
    },
    {
      name: 'phone',
      type: 'text',
      access: { update: never },
      admin: { readOnly: true },
      label: 'Phone',
      maxLength: 40,
      required: true,
    },
    ...(options.customerFields ?? []),
  ]

  return {
    slug: slugs.appointments,
    access: {
      // Closed for everyone, including staff. Payload's generic create runs none of the
      // availability, notice, blackout or seat checks, so every appointment enters through
      // the plugin's endpoint, which writes with the Local API.
      create: () => false,
      delete: options.access.configure,
      read: options.access.manage,
      update: options.access.manage,
    },
    admin: {
      defaultColumns: ['slotStart', 'title', 'customer.phone', 'status', 'reference'],
      description: 'Every appointment, past and future.',
      // Hidden from the sidebar: the Upcoming and Past links are the way in, so the owner
      // never lands on a list mixing next week with last year. Routes stay enabled.
      group: false,
      listSearchableFields: ['customer.name', 'customer.email', 'customer.phone', 'reference'],
      useAsTitle: 'title',
    },
    defaultSort: '-slotStart',
    fields: [
      {
        name: 'title',
        type: 'text',
        access: { update: never },
        admin: { hidden: true },
        label: 'Customer',
      },
      {
        name: 'reference',
        type: 'text',
        access: { update: never },
        admin: {
          description: 'Quote this when the customer calls.',
          position: 'sidebar',
          readOnly: true,
        },
        index: true,
        label: 'Reference',
        unique: true,
      },
      {
        name: 'resource',
        type: 'relationship',
        access: { update: never },
        admin: { readOnly: true },
        index: true,
        label: 'Location',
        relationTo: collectionSlug(slugs.resources),
        required: true,
      },
      {
        name: 'slotStart',
        type: 'date',
        access: { update: never },
        admin: {
          // Without this the picker shows the date alone, so the owner would have to open
          // the list or read the title to find out what time the appointment is.
          date: { displayFormat: 'd MMM yyyy, h:mm a', pickerAppearance: 'dayAndTime' },
          readOnly: true,
        },
        index: true,
        label: 'Starts',
        required: true,
        // Payload injects a companion field holding the zone, and renders this date in it
        // everywhere: the list column and the edit view. Without it the admin shows times
        // in the viewer's browser zone, which is wrong the moment the owner travels.
        timezone: {
          override: ({ baseField }) => ({
            ...baseField,
            access: { update: never },
          }),
          required: true,
          supportedTimezones: timezones,
        },
      },
      {
        name: 'slotEnd',
        type: 'date',
        access: { update: never },
        admin: { hidden: true },
        label: 'Ends',
      },
      {
        name: 'slotLocalDate',
        type: 'text',
        access: { update: never },
        admin: { hidden: true },
        index: true,
        label: 'Date',
      },
      {
        name: 'slotLocalTime',
        type: 'text',
        access: { update: never },
        admin: { hidden: true },
        label: 'Time',
      },
      {
        name: 'seat',
        type: 'number',
        access: { update: never },
        admin: { hidden: true },
        defaultValue: 0,
        label: 'Seat',
      },
      {
        name: 'slotLockKey',
        type: 'text',
        access: { update: never },
        admin: { hidden: true },
        index: true,
        label: 'Slot lock key',
        // The whole correctness story. Two slot-holding appointments cannot share a value,
        // and the database enforces it, so two simultaneous bookings cannot both win.
        unique: true,
      },
      {
        name: 'status',
        type: 'select',
        access: { update: never },
        admin: {
          components: statusLabelComponent
            ? { Field: { clientProps: {}, path: statusLabelComponent } }
            : undefined,
          position: 'sidebar',
          readOnly: true,
        },
        defaultValue: 'confirmed',
        index: true,
        label: 'Status',
        options: [
          { label: 'Confirmed', value: 'confirmed' },
          { label: 'Cancelled', value: 'cancelled' },
          { label: 'Completed', value: 'completed' },
          { label: 'No-show', value: 'no-show' },
        ],
        required: true,
        // The buttons are the front door; this is the lock. A status change that did not
        // come from a plugin endpoint skips the emails and the audit fields, so it is
        // refused rather than silently accepted.
        validate: (value: unknown, validateArgs: unknown): string | true => {
          const { operation, previousValue, req } = validateArgs as {
            operation?: string
            previousValue?: unknown
            req?: { context?: Record<string, unknown> }
          }

          if (operation !== 'update' || value === previousValue) {
            return true
          }

          if (req?.context?.[CONTEXT_STATUS_CHANGE] === true) {
            return true
          }

          return 'Use the buttons on this page so the customer is notified.'
        },
      },
      ...(statusActionsComponent
        ? ([
            {
              name: 'statusActions',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    clientProps: { apiBasePath: options.apiBasePath ?? '/booking' },
                    path: statusActionsComponent,
                  },
                },
                condition: (_data: unknown, _sibling: unknown, ctx: { operation?: string }) =>
                  ctx?.operation === 'update',
                disableListColumn: true,
              },
              label: false,
            },
          ] as Field[])
        : []),
      {
        name: 'customer',
        type: 'group',
        admin: { description: 'What the customer entered when booking. Not editable.' },
        fields: customerFields,
        label: 'Customer',
      },
      {
        name: 'message',
        type: 'textarea',
        access: { update: never },
        admin: { readOnly: true },
        label: 'Message from the customer',
        maxLength: 2000,
      },
      {
        name: 'internalNotes',
        type: 'textarea',
        admin: {
          description: 'Only your team sees this. The customer never does.',
        },
        label: 'Internal notes',
      },
      {
        name: 'cancelledAt',
        type: 'date',
        // Written by the cancel endpoints, which carry the context flag. `never` would make
        // Payload silently drop these three on a staff cancel, leaving a cancelled
        // appointment with no record of who did it or why.
        access: { update: onlyPluginWrites(CONTEXT_STATUS_CHANGE) },
        admin: { position: 'sidebar', readOnly: true },
        label: 'Cancelled at',
      },
      {
        name: 'cancelledBy',
        type: 'select',
        access: { update: onlyPluginWrites(CONTEXT_STATUS_CHANGE) },
        admin: { position: 'sidebar', readOnly: true },
        label: 'Cancelled by',
        options: [
          { label: 'Customer', value: 'customer' },
          { label: 'Business', value: 'business' },
        ],
      },
      {
        name: 'cancellationReason',
        type: 'text',
        access: { update: onlyPluginWrites(CONTEXT_STATUS_CHANGE) },
        admin: { readOnly: true },
        label: 'Reason for cancelling',
        maxLength: 500,
      },
      {
        name: 'emailLog',
        type: 'array',
        access: { update: onlyPluginWrites(CONTEXT_EMAIL_LOG, CONTEXT_STATUS_CHANGE) },
        admin: {
          description: 'What was sent, and whether it went out.',
          readOnly: true,
        },
        dbName: 'appt_email_log',
        fields: [
          { name: 'event', type: 'text' },
          { name: 'to', type: 'text' },
          { name: 'sentAt', type: 'date' },
          { name: 'providerId', type: 'text' },
          { name: 'error', type: 'text' },
        ],
        label: 'Emails',
      },
      {
        name: 'source',
        type: 'group',
        access: { update: never },
        admin: { description: 'Where the booking came from.', readOnly: true },
        fields: [
          { name: 'page', type: 'text', maxLength: 2048 },
          { name: 'referrer', type: 'text', maxLength: 2048 },
          { name: 'utmSource', type: 'text', maxLength: 200 },
          { name: 'utmMedium', type: 'text', maxLength: 200 },
          { name: 'utmCampaign', type: 'text', maxLength: 200 },
          // Hashed, never the raw address. Indexed because every booking counts against it.
          { name: 'ipHash', type: 'text', index: true },
          { name: 'userAgent', type: 'text', maxLength: 512 },
        ],
        label: 'Source',
      },
      {
        name: 'googleEventId',
        type: 'text',
        access: { update: never },
        admin: { hidden: true },
      },
      {
        name: 'googleCalendarSyncedAt',
        type: 'date',
        access: { update: never },
        admin: { hidden: true },
      },
    ],
    hooks: {
      beforeChange: [deriveAppointmentFields({ options })],
    },
    labels: { plural: 'Appointments', singular: 'Appointment' },
    // Audit trail without drafts. Capped low: an appointment accrues a version per status
    // change and per email-log write, and only the recent ones are ever useful.
    versions: { drafts: false, maxPerDoc: 20 },
  }
}

export { SLOT_HOLDING_STATUSES }
