'use client'

import { useBookingFlow } from '@ogutdgn/payload-booking/react'
import React, { useState } from 'react'

/**
 * A deliberately different booking page, built on the same hook as the shipped form.
 *
 * It exists to prove the hook bends: one day at a time instead of a long list, three steps
 * instead of one page, its own wording, its own markup, no plugin CSS. If a layout this
 * different needs no change to `useBookingFlow`, the hook is doing its job.
 *
 * It is also a worked example for a host designing their own.
 */
export const BookingWizard: React.FC = () => {
  const flow = useBookingFlow({ apiUrl: '/api/booking' })
  const [dayIndex, setDayIndex] = useState(0)
  const [step, setStep] = useState<'details' | 'time'>('time')

  const openDays = flow.days.filter((day) => day.slots.length > 0)
  const day = openDays[dayIndex]

  if (flow.loadingAvailability) {
    return <p>Checking what is free…</p>
  }

  if (flow.success) {
    return (
      <section>
        <h1>See you then</h1>
        <p>
          {flow.success.label}. Reference <strong>{flow.success.reference}</strong>.
        </p>
        <button onClick={flow.reset} type="button">
          Book another
        </button>
      </section>
    )
  }

  if (openDays.length === 0) {
    return <p>Nothing free right now. Please call {flow.meta.phone}.</p>
  }

  return (
    <section>
      <h1>Book a visit</h1>

      {step === 'time' ? (
        <>
          <nav style={{ alignItems: 'center', display: 'flex', gap: '1rem' }}>
            <button
              disabled={dayIndex === 0}
              onClick={() => {
                setDayIndex((index) => index - 1)
              }}
              type="button"
            >
              ←
            </button>
            <strong style={{ flex: 1, textAlign: 'center' }}>{day.label}</strong>
            <button
              disabled={dayIndex >= openDays.length - 1}
              onClick={() => {
                setDayIndex((index) => index + 1)
              }}
              type="button"
            >
              →
            </button>
          </nav>

          <ul style={{ display: 'grid', gap: '0.5rem', listStyle: 'none', padding: 0 }}>
            {day.slots.map((slot) => {
              const gone = !slot.available || flow.unavailableStarts.includes(slot.start)

              return (
                <li key={slot.start}>
                  <button
                    disabled={gone}
                    onClick={() => {
                      flow.select(slot)
                      setStep('details')
                    }}
                    style={{ padding: '0.75rem', width: '100%' }}
                    type="button"
                  >
                    {slot.label} {gone ? '(gone)' : ''}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <>
          <p>
            <strong>{flow.selected?.label}</strong> on {day.label}.{' '}
            <button
              onClick={() => {
                setStep('time')
              }}
              type="button"
            >
              change
            </button>
          </p>

          {['name', 'email', 'phone'].map((name) => (
            <p key={name}>
              <label htmlFor={`wizard-${name}`} style={{ display: 'block' }}>
                {name}
              </label>
              <input
                aria-label={name}
                id={`wizard-${name}`}
                onChange={(event) => {
                  flow.setValue(name, event.target.value)
                }}
                value={flow.values[name] ?? ''}
              />
              {flow.fieldErrors[name] ? (
                <span style={{ color: '#a11' }}> {flow.fieldErrors[name]}</span>
              ) : null}
            </p>
          ))}

          {flow.errorCode ? (
            <p role="alert" style={{ color: '#a11' }}>
              {flow.errorCode === 'slot_taken' || flow.errorCode === 'slot_unavailable'
                ? 'That time just went. Pick another; your details are still here.'
                : `Could not book (${flow.errorCode}). Call ${flow.meta.phone}.`}
            </p>
          ) : null}

          <button
            disabled={!flow.canSubmit}
            onClick={() => {
              void flow.submit().then(() => {
                if (!flow.selected) {
                  setStep('time')
                }
              })
            }}
            type="button"
          >
            {flow.submitting ? 'Booking…' : 'Confirm'}
          </button>
        </>
      )}
    </section>
  )
}

export default BookingWizard
