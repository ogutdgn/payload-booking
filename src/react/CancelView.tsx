'use client'

import React, { useCallback, useEffect, useState } from 'react'

import type { Messages } from './messages.js'
import type { BookingClassNames, CancelLookup, CancelState } from './types.js'

import { fill, resolveMessages } from './messages.js'
import { cx } from './types.js'

export type CancelViewProps = {
  /** Full prefix of the plugin's endpoints, e.g. '/api/booking'. */
  apiUrl?: string
  classNames?: BookingClassNames
  messages?: Partial<Messages>
  onCancelled?: () => void
  /** The token from the page's own URL. */
  token: string
}

/**
 * The page a cancellation link opens.
 *
 * Reading is a GET and cancelling is a POST, deliberately. Mail clients and link scanners
 * open links to check them, so a cancellation that happened on GET would cancel
 * appointments nobody clicked.
 *
 * Every state renders something useful with the business phone number, including the ones
 * where the link is unusable.
 */
export const CancelView: React.FC<CancelViewProps> = ({
  apiUrl = '/api/booking',
  classNames = {},
  messages,
  onCancelled,
  token,
}) => {
  const copy = resolveMessages(messages)
  const [lookup, setLookup] = useState<CancelLookup | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const response = await fetch(
        `${apiUrl}/appointment-by-token?token=${encodeURIComponent(token)}`,
        { headers: { Accept: 'application/json' } },
      )

      setLookup((await response.json()) as CancelLookup)
    } catch {
      setLookup({ bookUrl: '', phone: '', state: 'invalid' })
    } finally {
      setLoading(false)
    }
  }, [apiUrl, token])

  useEffect(() => {
    void load()
  }, [load])

  const confirm = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`${apiUrl}/cancel-by-token`, {
        body: JSON.stringify({ token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json()) as { error?: string; state?: CancelState }

      if (response.ok) {
        setLookup((previous) =>
          previous ? { ...previous, state: 'cancelled' } : previous,
        )
        onCancelled?.()

        return
      }

      if (body.error === 'too_late') {
        setLookup((previous) => (previous ? { ...previous, state: 'past' } : previous))

        return
      }

      if (body.error === 'token_expired') {
        setLookup((previous) => (previous ? { ...previous, state: 'expired' } : previous))

        return
      }

      if (body.error === 'token_invalid') {
        setLookup((previous) => (previous ? { ...previous, state: 'invalid' } : previous))

        return
      }

      setError(fill(copy.genericError, { phone: lookup?.phone }))
    } catch {
      setError(fill(copy.genericError, { phone: lookup?.phone }))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !lookup) {
    return (
      <p aria-live="polite" className={classNames.notice}>
        {copy.busy}
      </p>
    )
  }

  const { appointment, bookUrl, phone, state } = lookup

  const when = appointment ? `${appointment.localDate} at ${appointment.localTime}` : null

  const bookAgain = bookUrl ? (
    <p>
      <a className={classNames.button} href={bookUrl}>
        {copy.bookAnother}
      </a>
    </p>
  ) : null

  const callUs = <p>Questions? Call {phone}.</p>

  return (
    <div className={cx('booking-cancel', classNames.root)}>
      {state === 'valid' && appointment ? (
        <>
          <h1>{copy.cancelHeading}</h1>
          <p>
            {appointment.customerName}, your appointment is on <strong>{when}</strong> (
            {appointment.timezone}).
          </p>
          <p aria-live="assertive" className={classNames.error} role="alert">
            {error}
          </p>
          <button
            className={cx('booking-submit', classNames.button)}
            disabled={submitting}
            onClick={() => {
              void confirm()
            }}
            type="button"
          >
            {submitting ? copy.busy : copy.cancelConfirm}
          </button>
          {callUs}
        </>
      ) : null}

      {state === 'cancelled' ? (
        <>
          <h1>{copy.cancelHeading}</h1>
          <p role="status">{when ? `${copy.cancelledNow} (${when})` : copy.cancelledNow}</p>
          {bookAgain}
          {callUs}
        </>
      ) : null}

      {state === 'expired' ? (
        <>
          <h1>{copy.cancelHeading}</h1>
          <p role="status">{fill(copy.expiredLink, { phone })}</p>
          {bookAgain}
        </>
      ) : null}

      {state === 'invalid' ? (
        <>
          <h1>{copy.cancelHeading}</h1>
          <p role="status">{fill(copy.invalidLink, { phone })}</p>
          {bookAgain}
        </>
      ) : null}

      {state === 'past' ? (
        <>
          <h1>{copy.cancelHeading}</h1>
          <p role="status">
            {when ? `${copy.pastAppointment} (${when})` : copy.pastAppointment}
          </p>
          {bookAgain}
          {callUs}
        </>
      ) : null}
    </div>
  )
}

export default CancelView
