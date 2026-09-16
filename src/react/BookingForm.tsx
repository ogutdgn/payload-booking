'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Messages } from './messages.js'
import type {
  BookingClassNames,
  BookingSuccess,
  CustomerFieldDescriptor,
  Day,
  Slot,
} from './types.js'

import { AvailabilityPicker } from './AvailabilityPicker.js'
import { fill, resolveMessages } from './messages.js'
import { cx } from './types.js'

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
  /** Server-minted token. Omit and the form fetches its own, which is the safer default. */
  formToken?: string
  messages?: Partial<Messages>
  onSuccess?: (booking: BookingSuccess) => void
  resource?: string
}

type FieldErrors = Record<string, string>

const CORE_FIELDS: CustomerFieldDescriptor[] = [
  { name: 'name', type: 'text', label: 'Name', required: true },
  { name: 'email', type: 'email', label: 'Email', required: true },
  { name: 'phone', type: 'text', label: 'Phone', required: true },
]

/** The three-second trap measures from page load, so a retry has to respect it. */
const MIN_TOKEN_AGE_MS = 3100

const tokenIssuedAt = (token: string): number => {
  const seconds = Number(token.slice(0, token.indexOf('.')))

  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Pick a time, fill in three fields, submit.
 *
 * The rule that shapes everything here: a visitor never loses what they typed. A slot
 * taken by someone else, an expired anti-bot token, a network blip; each of them re-runs
 * the request or asks for one more click, and the form fields stay exactly as they were.
 */
export const BookingForm: React.FC<BookingFormProps> = ({
  apiUrl = '/api/booking',
  challenge,
  challengeToken,
  classNames = {},
  fields = [],
  formToken,
  messages,
  onSuccess,
  resource,
}) => {
  const copy = resolveMessages(messages)
  const allFields = useMemo(() => [...CORE_FIELDS, ...fields], [fields])

  const [values, setValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [selected, setSelected] = useState<null | Slot>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<null | string>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<BookingSuccess | null>(null)
  const [blockedStarts, setBlockedStarts] = useState<string[]>([])
  const [phone, setPhone] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const token = useRef<null | string>(formToken ?? null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Fetched on mount rather than rendered into the page. A token minted during render is
  // baked into a statically built page, so every visitor would share one, issued at deploy
  // time and expired six hours later.
  const fetchToken = useCallback(async (): Promise<null | string> => {
    try {
      const response = await fetch(`${apiUrl}/form-token`, {
        headers: { Accept: 'application/json' },
      })
      const body = (await response.json()) as { formToken?: string }

      token.current = body.formToken ?? null

      return token.current
    } catch {
      return null
    }
  }, [apiUrl])

  useEffect(() => {
    if (!formToken) {
      void fetchToken()
    }
  }, [fetchToken, formToken])

  // Taken from the availability response rather than fetched again: the phone number
  // appears in several error messages, and one source keeps them consistent.
  const handleMeta = useCallback((meta: { phone: string }) => {
    setPhone(meta.phone)
  }, [])

  const setValue = (name: string, value: string): void => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => {
      if (!previous[name]) {
        return previous
      }

      const next = { ...previous }

      delete next[name]

      return next
    })
  }

  const validate = (): boolean => {
    const found: FieldErrors = {}

    for (const field of allFields) {
      const value = (values[field.name] ?? '').trim()

      if (field.required && value === '') {
        found[field.name] = copy.fieldRequired
      }

      if (field.type === 'email' && value !== '' && !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(value)) {
        found[field.name] = copy.invalidEmail
      }
    }

    setErrors(found)

    return Object.keys(found).length === 0
  }

  const post = useCallback(
    async (slot: Slot): Promise<Response> =>
      await fetch(`${apiUrl}/book`, {
        body: JSON.stringify({
          challengeToken,
          customer: Object.fromEntries(
            allFields.map((field) => [field.name, (values[field.name] ?? '').trim()]),
          ),
          formToken: token.current ?? '',
          message: message.trim() || undefined,
          resource,
          source: {
            page: typeof window === 'undefined' ? undefined : window.location.pathname,
            referrer: typeof document === 'undefined' ? undefined : document.referrer || undefined,
          },
          start: slot.start,
          website: honeypot,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    [allFields, apiUrl, challengeToken, honeypot, message, resource, values],
  )

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()

    if (!selected || submitting) {
      return
    }

    if (!validate()) {
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      let response = await post(selected)
      let body = (await response.json()) as {
        error?: string
        errors?: { message: string; path: string }[]
      } & BookingSuccess

      // One retry for the anti-bot token. Too fast means waiting out the remaining seconds
      // and resubmitting the same token; invalid or expired means fetching a new one and
      // waiting for it to age past the minimum.
      if (
        response.status === 400 &&
        ['token_expired', 'token_invalid', 'token_too_fast'].includes(body.error ?? '')
      ) {
        if (body.error === 'token_too_fast' && token.current) {
          const age = Date.now() - tokenIssuedAt(token.current)

          await wait(Math.max(0, MIN_TOKEN_AGE_MS - age))
        } else {
          await fetchToken()
          await wait(MIN_TOKEN_AGE_MS)
        }

        response = await post(selected)
        body = (await response.json()) as typeof body
      }

      if (response.ok) {
        setSuccess(body)
        onSuccess?.(body)

        return
      }

      if (body.error === 'already_booked') {
        setFormError(copy.alreadyBooked)

        return
      }

      // The slot went while they were typing. Grey it out, re-fetch, say so plainly, and
      // leave every field exactly as it was.
      if (body.error === 'slot_taken' || body.error === 'slot_unavailable') {
        setBlockedStarts((previous) => [...previous, selected.start])
        setSelected(null)
        setReloadKey((previous) => previous + 1)
        setFormError(`${copy.slotTaken} ${copy.keepDetails}`)
        gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

        return
      }

      if (body.error === 'too_many') {
        setFormError(fill(copy.tooManyBookings, { phone }))

        return
      }

      if (response.status === 422 && Array.isArray(body.errors)) {
        const found: FieldErrors = {}

        for (const entry of body.errors) {
          const name = entry.path.replace(/^customer\./, '')

          found[name] = entry.message
        }

        setErrors(found)

        return
      }

      setFormError(fill(copy.genericError, { phone }))
    } catch {
      setFormError(fill(copy.genericError, { phone }))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className={cx('booking-success', classNames.success)} role="status">
        <h2>{copy.successHeading}</h2>
        <p>
          {success.label} — {copy.successBody}
        </p>
        <p>
          Reference: <strong>{success.reference}</strong>
        </p>
        <p>
          {success.icsContent ? (
            <a
              className={classNames.button}
              download="appointment.ics"
              href={`data:text/calendar;charset=utf-8,${encodeURIComponent(success.icsContent)}`}
            >
              Add to calendar
            </a>
          ) : null}{' '}
          {success.googleCalendarUrl ? (
            <a
              className={classNames.button}
              href={success.googleCalendarUrl}
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
    <form className={cx('booking-form', classNames.form)} noValidate onSubmit={submit}>
      <div ref={gridRef}>
        <h2>{copy.chooseTime}</h2>
        <AvailabilityPicker
          apiUrl={apiUrl}
          classNames={classNames}
          key={reloadKey}
          messages={messages}
          onMeta={handleMeta}
          onSelect={(slot) => {
            setSelected(slot)
            setFormError(null)
          }}
          resource={resource}
          selected={selected?.start ?? null}
          unavailableStarts={blockedStarts}
        />
      </div>

      <h2>{copy.yourDetails}</h2>

      {allFields.map((field) => (
        <FieldRow
          classNames={classNames}
          error={errors[field.name]}
          field={field}
          key={field.name}
          onChange={setValue}
          value={values[field.name] ?? ''}
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
            setMessage(event.target.value)
          }}
          rows={3}
          value={message}
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
            setHoneypot(event.target.value)
          }}
          tabIndex={-1}
          type="text"
          value={honeypot}
        />
      </div>

      {challenge}

      <p aria-live="assertive" className={cx(classNames.error)} role="alert">
        {formError}
      </p>

      <button
        className={cx('booking-submit', classNames.button)}
        disabled={submitting || !selected}
        type="submit"
      >
        {submitting ? copy.busy : copy.submit}
      </button>
    </form>
  )
}

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

export type { Day }
export default BookingForm
