'use client'

import React from 'react'

import type { Messages } from './messages.js'
import type { BookingClassNames } from './types.js'
import type { CancelFlow } from './useCancelFlow.js'

import { fill, resolveMessages } from './messages.js'
import { cx } from './types.js'
import { useCancelFlow } from './useCancelFlow.js'

export type CancelViewProps = {
  /** Full prefix of the plugin's endpoints, e.g. '/api/booking'. */
  apiUrl?: string
  classNames?: BookingClassNames
  /** An externally managed flow, when the page needs to drive it itself. */
  flow?: CancelFlow
  messages?: Partial<Messages>
  onCancelled?: () => void
  /** The token from the page's own URL. */
  token: string
}

/**
 * A ready-made cancellation page.
 *
 * All of its behaviour comes from `useCancelFlow`; this is one possible shape. For a
 * different design, call the hook and branch on its five states yourself.
 */
export const CancelView: React.FC<CancelViewProps> = ({
  apiUrl = '/api/booking',
  classNames = {},
  flow: providedFlow,
  messages,
  onCancelled,
  token,
}) => {
  const copy = resolveMessages(messages)
  const ownFlow = useCancelFlow({ apiUrl, token })
  const flow = providedFlow ?? ownFlow

  const { appointment, bookUrl, confirming, errorCode, loading, phone, state } = flow

  if (loading || !state) {
    return (
      <p aria-live="polite" className={classNames.notice}>
        {copy.busy}
      </p>
    )
  }

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
      <h1>{copy.cancelHeading}</h1>

      {state === 'valid' && appointment ? (
        <>
          <p>
            {appointment.customerName}, your appointment is on <strong>{when}</strong> (
            {appointment.timezone}).
          </p>
          <p aria-live="assertive" className={classNames.error} role="alert">
            {errorCode ? fill(copy.genericError, { phone }) : null}
          </p>
          <button
            className={cx('booking-submit', classNames.button)}
            disabled={confirming}
            onClick={() => {
              void flow.confirm().then(() => {
                onCancelled?.()
              })
            }}
            type="button"
          >
            {confirming ? copy.busy : copy.cancelConfirm}
          </button>
          {callUs}
        </>
      ) : null}

      {state === 'cancelled' ? (
        <>
          <p role="status">{when ? `${copy.cancelledNow} (${when})` : copy.cancelledNow}</p>
          {bookAgain}
          {callUs}
        </>
      ) : null}

      {state === 'expired' ? (
        <>
          <p role="status">{fill(copy.expiredLink, { phone })}</p>
          {bookAgain}
        </>
      ) : null}

      {state === 'invalid' ? (
        <>
          <p role="status">{fill(copy.invalidLink, { phone })}</p>
          {bookAgain}
        </>
      ) : null}

      {state === 'past' ? (
        <>
          <p role="status">{when ? `${copy.pastAppointment} (${when})` : copy.pastAppointment}</p>
          {bookAgain}
          {callUs}
        </>
      ) : null}
    </div>
  )
}

export default CancelView
