'use client'

import { useFormFields } from '@payloadcms/ui'
import React from 'react'

type Props = {
  day?: string
  path?: string
}

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number)

  return hour * 60 + minute
}

const addMinutes = (time: string, minutes: number): string => {
  const total = toMinutes(time) + minutes
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Shows the owner what they just configured: "09:00-10:00 · 10:00-11:00 …".
 *
 * A list of start times plus a separate duration is hard to read as a day's shape, and an
 * overlap is invisible until a visitor hits it. This renders the resulting sessions and
 * flags any pair that overlaps, which is the same rule the server enforces on save.
 *
 * It echoes the 24-hour values the owner typed rather than passing them through the label
 * formatter: it is a mirror of the inputs beside it, and it has no access to the business
 * timezone in form state.
 */
export const WeekdayPreview: React.FC<Props> = ({ path }) => {
  const prefix = path ? path.slice(0, path.lastIndexOf('.')) : ''

  const [times, duration, open] = useFormFields(([fields]) => {
    const collected: string[] = []

    for (const [key, field] of Object.entries(fields)) {
      if (key.startsWith(`${prefix}.sessionStarts.`) && key.endsWith('.time')) {
        const value = field?.value

        if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
          collected.push(value)
        }
      }
    }

    const durationValue = fields?.slotDurationMinutes?.value
    const openValue = fields?.[`${prefix}.open`]?.value

    return [
      collected.sort().join(','),
      typeof durationValue === 'number' ? durationValue : 60,
      openValue !== false,
    ] as const
  })

  if (!open) {
    return null
  }

  const starts = times ? times.split(',') : []

  if (starts.length === 0) {
    return (
      <p style={{ color: 'var(--theme-elevation-500)', fontSize: '0.8rem', margin: '0 0 1rem' }}>
        No start times yet, so nothing can be booked on this day.
      </p>
    )
  }

  const overlaps = starts.some((time, index) => {
    if (index === 0) {
      return false
    }

    return toMinutes(time) - toMinutes(starts[index - 1]) < duration
  })

  return (
    <div style={{ margin: '0 0 1rem' }}>
      <p style={{ color: 'var(--theme-elevation-500)', fontSize: '0.8rem', margin: '0 0 0.25rem' }}>
        Visitors will see {starts.length} {starts.length === 1 ? 'slot' : 'slots'}:
      </p>
      <p style={{ fontSize: '0.85rem', margin: 0 }}>
        {starts.map((time) => `${time}–${addMinutes(time, duration)}`).join('  ·  ')}
      </p>
      {overlaps ? (
        <p style={{ color: 'var(--theme-error-500)', fontSize: '0.8rem', margin: '0.35rem 0 0' }}>
          Some of these overlap. Saving will be refused until the gaps are at least{' '}
          {duration} minutes.
        </p>
      ) : null}
    </div>
  )
}

export default WeekdayPreview
