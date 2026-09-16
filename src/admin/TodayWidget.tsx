import type { ServerProps } from 'payload'

import { formatAdminURL } from 'payload/shared'
import React from 'react'

import type { BookingLabelOptions, ResolvedSlugs } from '../types.js'

import { createFormatter } from '../core/format.js'
import { shiftLocalDate, startOfLocalDayIso } from '../core/time.js'
import { collectionSlug, globalSlug } from '../payload/slugs.js'

type Props = {
  disabled?: boolean
  labels?: BookingLabelOptions
  slugs?: ResolvedSlugs
} & ServerProps

type UpcomingAppointment = {
  customer?: { name?: string; phone?: string }
  id: number | string
  slotStart: string
  slotStart_tz?: string
}

const cell: React.CSSProperties = {
  borderBottom: '1px solid var(--theme-elevation-100)',
  padding: '0.5rem 0.75rem 0.5rem 0',
  textAlign: 'left',
}

/**
 * Today and tomorrow, on the admin home page.
 *
 * A server component, so it reads the database directly. A client component in this slot
 * receives no Payload instance at all, and would need its own authenticated endpoint to
 * show the same thing.
 */
export const TodayWidget = async (props: Props): Promise<null | React.JSX.Element> => {
  const { disabled, labels, payload, slugs, user } = props

  if (disabled || !payload) {
    return null
  }

  const appointmentsSlug = slugs?.appointments ?? 'appointments'
  const settingsSlug = slugs?.settings ?? 'booking-settings'

  const settings = (await payload.findGlobal({
    slug: globalSlug(settingsSlug),
    depth: 0,
  })) as { timezone?: string }

  const timezone = settings?.timezone ?? 'UTC'
  const formatter = createFormatter(timezone, labels)
  const today = formatter.localDate(new Date())
  const from = startOfLocalDayIso(today, timezone)
  const to = startOfLocalDayIso(shiftLocalDate(today, 2, timezone), timezone)

  // Read as the signed-in user with access enabled, so someone without permission to see
  // appointments sees nothing here either.
  const { docs } = await payload.find({
    collection: collectionSlug(appointmentsSlug),
    depth: 0,
    overrideAccess: false,
    pagination: false,
    sort: 'slotStart',
    user,
    where: {
      slotStart: { greater_than_equal: from, less_than: to },
      status: { equals: 'confirmed' },
    },
  })

  const appointments = docs as unknown as UpcomingAppointment[]

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Today and tomorrow</h2>
      <p
        style={{
          color: 'var(--theme-elevation-500)',
          fontSize: '0.8rem',
          margin: '0 0 0.75rem',
        }}
      >
        Confirmed appointments, shown in {timezone}.
      </p>

      {appointments.length === 0 ? (
        <p style={{ margin: 0 }}>Nothing booked for today or tomorrow.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>When</th>
              <th style={cell}>Who</th>
              <th style={cell}>Phone</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((appointment) => {
              const zone = appointment.slotStart_tz ?? timezone
              const rowFormatter = createFormatter(zone, labels)
              const href = formatAdminURL({
                adminRoute: payload.config.routes.admin,
                path: `/collections/${appointmentsSlug}/${String(appointment.id)}`,
              })

              return (
                <tr key={String(appointment.id)}>
                  <td style={cell}>
                    {rowFormatter.dayLabel(appointment.slotStart)}{' '}
                    {rowFormatter.timeLabel(appointment.slotStart)}
                  </td>
                  <td style={cell}>
                    <a href={href}>{appointment.customer?.name ?? 'Appointment'}</a>
                  </td>
                  <td style={cell}>{appointment.customer?.phone ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default TodayWidget
