import type { Payload } from 'payload'

import { formatAdminURL } from 'payload/shared'

import type { EmailViewModelBase, EmailViewModels } from '../../types.js'
import type { BookingSettings } from '../availability.js'
import type { ResolvedServerOptions } from '../options.js'

import { createFormatter } from '../../core/format.js'
import { buildSiteUrl } from '../options.js'

export type AppointmentRecord = {
  cancellationReason?: null | string
  customer?: { email?: string; name?: string; phone?: string } & Record<string, unknown>
  id: number | string
  message?: null | string
  reference?: string
  slotEnd?: Date | string
  slotStart: Date | string
  slotStart_tz?: string
}

/**
 * Templates receive a plain object, never the document.
 *
 * It keeps a host's override from depending on the collection's shape, and it means the
 * dates are formatted once, in the business zone, by the same formatter the booking page
 * used.
 */
export const buildBaseViewModel = (args: {
  appointment: AppointmentRecord
  options: { bookUrl: null | string }
  server: ResolvedServerOptions
  settings: BookingSettings
}): EmailViewModelBase => {
  const { appointment, options, server, settings } = args
  const timezone = appointment.slotStart_tz ?? settings.timezone ?? 'UTC'
  const formatter = createFormatter(timezone, server.labels)

  return {
    bookUrl: options.bookUrl ?? '',
    customerName: appointment.customer?.name ?? '',
    localDate: formatter.dateLabel(appointment.slotStart),
    localTime: formatter.timeLabel(appointment.slotStart),
    location: settings.location ?? '',
    phone: settings.phone ?? '',
    timezone,
  }
}

/** Host-defined customer fields, flattened to label/value pairs for the business email. */
const customFieldValues = (args: {
  appointment: AppointmentRecord
  server: ResolvedServerOptions
}): Record<string, string> => {
  const declared = args.server.options.customerFields ?? []
  const values: Record<string, string> = {}

  for (const field of declared) {
    const name = 'name' in field ? field.name : undefined

    if (!name) {
      continue
    }

    const raw = args.appointment.customer?.[name]
    const isPrimitive =
      typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'

    if (isPrimitive && raw !== '') {
      const label = 'label' in field && typeof field.label === 'string' ? field.label : name

      values[label] = String(raw)
    }
  }

  return values
}

export const buildConfirmedViewModel = (args: {
  appointment: AppointmentRecord
  cancelUrl: string
  icsContent: string
  server: ResolvedServerOptions
  settings: BookingSettings
}): EmailViewModels['customer.confirmed'] => ({
  ...buildBaseViewModel({
    appointment: args.appointment,
    options: { bookUrl: null },
    server: args.server,
    settings: args.settings,
  }),
  cancelUrl: args.cancelUrl,
  icsContent: args.icsContent,
  note: args.settings.confirmationNote ?? undefined,
})

export const buildBookedViewModel = (args: {
  appointment: AppointmentRecord
  payload: Payload
  server: ResolvedServerOptions
  settings: BookingSettings
}): EmailViewModels['business.booked'] => {
  const { appointment, payload, server, settings } = args

  // Built from the host's configured admin route, never a hardcoded /admin: both the route
  // and a Next base path are host-configurable.
  const adminUrl = payload.config.serverURL
    ? formatAdminURL({
        adminRoute: payload.config.routes.admin,
        path: `/collections/${server.slugs.appointments}/${String(appointment.id)}`,
        serverURL: payload.config.serverURL,
      })
    : undefined

  return {
    ...buildBaseViewModel({
      appointment,
      options: { bookUrl: null },
      server,
      settings,
    }),
    adminUrl,
    customerEmail: appointment.customer?.email ?? '',
    customerPhone: appointment.customer?.phone ?? '',
    customFields: customFieldValues({ appointment, server }),
    message: appointment.message ?? undefined,
  }
}

export const buildCancelledByCustomerViewModel = (args: {
  appointment: AppointmentRecord
  server: ResolvedServerOptions
  settings: BookingSettings
}): EmailViewModels['business.cancelledByCustomer'] =>
  buildBaseViewModel({
    appointment: args.appointment,
    options: { bookUrl: null },
    server: args.server,
    settings: args.settings,
  })

export const buildCancelledByBusinessViewModel = (args: {
  appointment: AppointmentRecord
  payload: Payload
  server: ResolvedServerOptions
  settings: BookingSettings
}): EmailViewModels['customer.cancelledByBusiness'] => ({
  ...buildBaseViewModel({
    appointment: args.appointment,
    options: {
      bookUrl: buildSiteUrl({
        options: args.server.options,
        path: args.server.options.routes.bookPath,
        payload: args.payload,
      }),
    },
    server: args.server,
    settings: args.settings,
  }),
  reason: args.appointment.cancellationReason ?? undefined,
})
