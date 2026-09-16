'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Messages } from './messages.js'
import type { AvailabilityResponse, BookingClassNames, Day, Slot } from './types.js'

import { fill, resolveMessages } from './messages.js'
import { cx } from './types.js'

export type AvailabilityPickerProps = {
  /** Full prefix of the plugin's endpoints, e.g. '/api/booking'. */
  apiUrl?: string
  classNames?: BookingClassNames
  messages?: Partial<Messages>
  /** Called once availability loads, so a parent can reuse the phone without re-fetching. */
  onMeta?: (meta: { phone: string; timezone: string }) => void
  onSelect?: (slot: null | Slot) => void
  /** Location id or identifier. Omit when the business has one. */
  resource?: string
  selected?: null | string
  /** Slots to grey out beyond what the server said, used after a 409. */
  unavailableStarts?: string[]
}

export type AvailabilityState = {
  days: Day[]
  error: null | string
  loading: boolean
  phone: string
  timezone: string
}

/**
 * Fetch availability and expose it, so the picker and the form share one copy.
 *
 * Exported because the form needs to re-fetch after a slot is taken, and two independent
 * fetches would disagree with each other.
 */
export const useAvailability = (args: {
  apiUrl: string
  resource?: string
}): { reload: () => Promise<AvailabilityResponse | null> } & AvailabilityState => {
  const { apiUrl, resource } = args
  const [state, setState] = useState<AvailabilityState>({
    days: [],
    error: null,
    loading: true,
    phone: '',
    timezone: 'UTC',
  })

  // Guards against a slow first response landing after a later one, which would show stale
  // availability as if it were current.
  const requestId = useRef(0)

  const reload = useCallback(async (): Promise<AvailabilityResponse | null> => {
    const id = requestId.current + 1

    requestId.current = id

    setState((previous) => ({ ...previous, loading: true }))

    try {
      const query = resource ? `?resource=${encodeURIComponent(resource)}` : ''
      const response = await fetch(`${apiUrl}/availability${query}`, {
        headers: { Accept: 'application/json' },
      })
      const body = (await response.json()) as { error?: string } & AvailabilityResponse

      if (requestId.current !== id) {
        return null
      }

      if (!response.ok) {
        setState((previous) => ({ ...previous, error: body.error ?? 'error', loading: false }))

        return null
      }

      setState({
        days: body.days,
        error: null,
        loading: false,
        phone: body.meta?.phone ?? '',
        timezone: body.meta?.timezone ?? 'UTC',
      })

      return body
    } catch {
      if (requestId.current === id) {
        setState((previous) => ({ ...previous, error: 'error', loading: false }))
      }

      return null
    }
  }, [apiUrl, resource])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}

/**
 * The day strip and slot grid.
 *
 * Renders only what the server sent. It never formats a time, never computes a timezone
 * and never decides what is bookable, so a visitor in another country sees exactly the
 * showroom's own hours.
 */
export const AvailabilityPicker: React.FC<AvailabilityPickerProps> = ({
  apiUrl = '/api/booking',
  classNames = {},
  messages,
  onMeta,
  onSelect,
  resource,
  selected = null,
  unavailableStarts = [],
}) => {
  const copy = resolveMessages(messages)
  const { days, error, loading, phone, timezone } = useAvailability({ apiUrl, resource })

  useEffect(() => {
    if (!loading && !error) {
      onMeta?.({ phone, timezone })
    }
  }, [error, loading, onMeta, phone, timezone])

  const blocked = useMemo(() => new Set(unavailableStarts), [unavailableStarts])
  const openDays = days.filter((day) => day.slots.length > 0)
  const hasAnySlot = openDays.some((day) => day.slots.some((slot) => slot.available))

  if (loading) {
    return (
      <p aria-live="polite" className={classNames.notice}>
        {copy.loading}
      </p>
    )
  }

  if (error) {
    return (
      <p className={cx(classNames.error)} role="alert">
        {fill(copy.genericError, { phone })}
      </p>
    )
  }

  if (!hasAnySlot) {
    return (
      <p className={classNames.notice} role="status">
        {fill(copy.emptyWindow, { days: days.length, phone })}
      </p>
    )
  }

  return (
    <div className={cx('booking-picker', classNames.dayList)}>
      {openDays.map((day) => (
        <section className={cx('booking-day', classNames.day)} key={day.date}>
          <h3 className={cx('booking-day__heading', classNames.dayHeading)}>{day.label}</h3>
          <ul className={cx('booking-slots', classNames.slotGrid)}>
            {day.slots.map((slot) => {
              const unavailable = !slot.available || blocked.has(slot.start)
              const isSelected = selected === slot.start

              return (
                <li key={slot.start}>
                  <button
                    aria-pressed={isSelected}
                    className={cx(
                      'booking-slot',
                      classNames.slot,
                      isSelected && classNames.slotSelected,
                      unavailable && classNames.slotUnavailable,
                    )}
                    data-selected={isSelected ? 'true' : undefined}
                    data-unavailable={unavailable ? 'true' : undefined}
                    disabled={unavailable}
                    onClick={() => {
                      onSelect?.(isSelected ? null : slot)
                    }}
                    type="button"
                  >
                    {slot.label}
                    {unavailable ? (
                      <span className="booking-slot__note"> — {copy.fullSlot}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default AvailabilityPicker
