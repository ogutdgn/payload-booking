'use client'

import React, { useRef } from 'react'

import type { Messages } from './messages.js'
import type {
  BookingClassNames,
  BookingSuccess,
  CustomerFieldDescriptor,
  Slot,
} from './types.js'
import type { BookingFlow } from './useBookingFlow.js'

import { fill, resolveMessages } from './messages.js'
import { cx } from './types.js'
import {
  CORE_CUSTOMER_FIELDS,
  FIELD_ERROR_INVALID_EMAIL,
  FIELD_ERROR_REQUIRED,
  useBookingFlow,
} from './useBookingFlow.js'

export type BookingFormProps = {
  /** Full prefix of the plugin's endpoints, e.g. '/api/booking'. */
  apiUrl?: string
  /** Rendered above the submit button, for a challenge widget such as Turnstile. */
  challenge?: React.ReactNode
  /** Token from that widget, sent with the booking. */
  challengeToken?: string
  classNames?: BookingClassNames
  /** Extra customer fields, from `toCustomerFieldDescriptors(options.customerFields)`. */
  fields?: CustomerFieldDescriptor[]
  /** An externally managed flow, when the page needs to drive it itself. */
  flow?: BookingFlow
  /** Server-minted token. Omit and the form fetches its own, which is the safer default. */
  formToken?: string
  messages?: Partial<Messages>
  onSuccess?: (booking: BookingSuccess) => void
  resource?: string
}

/**
 * A ready-made booking page.
 *
 * Every piece of behaviour comes from `useBookingFlow`, and nothing here is privileged:
 * this component is one possible shape, not the shape. For a different layout, call the
 * hook and write your own markup. What follows is only rendering.
 */
export const BookingForm: React.FC<BookingFormProps> = ({
  apiUrl = '/api/booking',
  challenge,
  challengeToken,
  classNames = {},
  fields = [],
  flow: providedFlow,
  formToken,
  messages,
  onSuccess,
  resource,
}) => {
  const copy = resolveMessages(messages)
  const gridRef = useRef<HTMLDivElement>(null)

  const ownFlow = useBookingFlow({
    apiUrl,
    challengeToken,
    fields,
    formToken,
    onSuccess,
    resource,
  })
  const flow = providedFlow ?? ownFlow

  const allFields = [...CORE_CUSTOMER_FIELDS, ...fields]
  const openDays = flow.days.filter((day) => day.slots.length > 0)
  const hasAnySlot = openDays.some((day) => day.slots.some((slot) => slot.available))

  const describeField = (value: string): string => {
    if (value === FIELD_ERROR_REQUIRED) {
      return copy.fieldRequired
    }

    if (value === FIELD_ERROR_INVALID_EMAIL) {
      return copy.invalidEmail
    }

    return value
  }

  const formError = ((): null | string => {
    switch (flow.errorCode) {
      case 'already_booked':
        return copy.alreadyBooked
      case null:
      case 'validation':
        return null
      case 'slot_taken':
      case 'slot_unavailable':
        return `${copy.slotTaken} ${copy.keepDetails}`
      case 'too_many':
        return fill(copy.tooManyBookings, { phone: flow.meta.phone })
      default:
        return fill(copy.genericError, { phone: flow.meta.phone })
    }
  })()

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()

    const before = flow.selected

    await flow.submit()

    // Bring the grid back into view when the chosen slot went, so the visitor sees why.
    if (before && !flow.selected) {
      gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (flow.success) {
    return (
      <div className={cx('booking-success', classNames.success)} role="status">
        <h2>{copy.successHeading}</h2>
        <p>
          {flow.success.label} — {copy.successBody}
        </p>
        <p>
          Reference: <strong>{flow.success.reference}</strong>
        </p>
        <p>
          {flow.success.icsContent ? (
            <a
              className={classNames.button}
              download="appointment.ics"
              href={`data:text/calendar;charset=utf-8,${encodeURIComponent(flow.success.icsContent)}`}
            >
              Add to calendar
            </a>
          ) : null}{' '}
          {flow.success.googleCalendarUrl ? (
            <a
              className={classNames.button}
              href={flow.success.googleCalendarUrl}
              rel="noreferrer"
              target="_blank"
            >
              Add to Google Calendar
            </a>
          ) : null}
        </p>
      </div>
    )
  }

  return (
    <form className={cx('booking-form', classNames.form)} noValidate onSubmit={handleSubmit}>
      <div ref={gridRef}>
        <h2>{copy.chooseTime}</h2>

        {flow.loadingAvailability ? (
          <p aria-live="polite" className={classNames.notice}>
            {copy.loading}
          </p>
        ) : flow.availabilityError ? (
          <p className={classNames.error} role="alert">
            {fill(copy.genericError, { phone: flow.meta.phone })}
          </p>
        ) : hasAnySlot ? (
          <div className={cx('booking-picker', classNames.dayList)}>
            {openDays.map((day) => (
              <section className={cx('booking-day', classNames.day)} key={day.date}>
                <h3 className={cx('booking-day__heading', classNames.dayHeading)}>{day.label}</h3>
                <ul className={cx('booking-slots', classNames.slotGrid)}>
                  {day.slots.map((slot) => (
                    <SlotButton
                      classNames={classNames}
                      fullLabel={copy.fullSlot}
                      key={slot.start}
                      onSelect={flow.select}
                      selected={flow.selected?.start === slot.start}
                      slot={slot}
                      unavailable={!slot.available || flow.unavailableStarts.includes(slot.start)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className={classNames.notice} role="status">
            {fill(copy.emptyWindow, { days: flow.days.length, phone: flow.meta.phone })}
          </p>
        )}
      </div>

      <h2>{copy.yourDetails}</h2>

      {allFields.map((field) => (
        <FieldRow
          classNames={classNames}
          error={
            flow.fieldErrors[field.name] ? describeField(flow.fieldErrors[field.name]) : undefined
          }
          field={field}
          key={field.name}
          onChange={flow.setValue}
          value={flow.values[field.name] ?? ''}
        />
      ))}

      <div className={cx('booking-field', classNames.field)}>
        <label className={classNames.label} htmlFor="booking-message">
          Anything we should know? (optional)
        </label>
        <textarea
          aria-label="Anything we should know"
          className={classNames.input}
          id="booking-message"
          onChange={(event) => {
            flow.setMessage(event.target.value)
          }}
          rows={3}
          value={flow.message}
        />
      </div>

      {/* Never shown to a person; a filled value marks the submission as automated. */}
      <div aria-hidden="true" style={{ left: '-9999px', position: 'absolute' }}>
        <label htmlFor="booking-website">Leave this empty</label>
        <input
          aria-label="Leave this empty"
          autoComplete="off"
          id="booking-website"
          name="website"
          onChange={(event) => {
            flow.setHoneypot(event.target.value)
          }}
          tabIndex={-1}
          type="text"
          value={flow.honeypot}
        />
      </div>

      {challenge}

      <p aria-live="assertive" className={classNames.error} role="alert">
        {formError}
      </p>

      <button
        className={cx('booking-submit', classNames.button)}
        disabled={!flow.canSubmit}
        type="submit"
      >
        {flow.submitting ? copy.busy : copy.submit}
      </button>
    </form>
  )
}

const SlotButton: React.FC<{
  classNames: BookingClassNames
  fullLabel: string
  onSelect: (slot: null | Slot) => void
  selected: boolean
  slot: Slot
  unavailable: boolean
}> = ({ classNames, fullLabel, onSelect, selected, slot, unavailable }) => (
  <li>
    <button
      aria-pressed={selected}
      className={cx(
        'booking-slot',
        classNames.slot,
        selected && classNames.slotSelected,
        unavailable && classNames.slotUnavailable,
      )}
      data-selected={selected ? 'true' : undefined}
      data-unavailable={unavailable ? 'true' : undefined}
      disabled={unavailable}
      onClick={() => {
        onSelect(selected ? null : slot)
      }}
      type="button"
    >
      {slot.label}
      {unavailable ? <span className="booking-slot__note"> — {fullLabel}</span> : null}
    </button>
  </li>
)

const FieldRow: React.FC<{
  classNames: BookingClassNames
  error?: string
  field: CustomerFieldDescriptor
  onChange: (name: string, value: string) => void
  value: string
}> = ({ classNames, error, field, onChange, value }) => {
  const id = `booking-${field.name}`
  const errorId = `${id}-error`

  const shared = {
    id,
    name: field.name,
    'aria-describedby': error ? errorId : undefined,
    'aria-invalid': error ? (true as const) : undefined,
    className: classNames.input,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => {
      onChange(field.name, event.target.value)
    },
    required: field.required,
    value,
  }

  return (
    <div className={cx('booking-field', classNames.field)}>
      <label className={classNames.label} htmlFor={id}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>

      {field.type === 'textarea' ? (
        <textarea {...shared} rows={3} />
      ) : field.type === 'select' ? (
        <select {...shared}>
          <option value="">Please choose</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          autoComplete={
            field.name === 'email' ? 'email' : field.name === 'phone' ? 'tel' : undefined
          }
          placeholder={field.placeholder}
          type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
        />
      )}

      {error ? (
        <span className={cx('booking-field__error', classNames.fieldError)} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

export default BookingForm
