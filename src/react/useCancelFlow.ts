'use client'

import { useCallback, useEffect, useState } from 'react'

import type { CancelLookup, CancelState } from './types.js'

export type CancelErrorCode = 'network' | 'token_expired' | 'token_invalid' | 'too_late' | 'unknown'

export type CancelFlow = {
  appointment: CancelLookup['appointment']
  bookUrl: string
  /** Ask the server to cancel. Only meaningful while `state` is 'valid'. */
  confirm: () => Promise<void>
  confirming: boolean
  errorCode: CancelErrorCode | null
  loading: boolean
  phone: string
  reload: () => Promise<void>
  state: CancelState | null
}

/**
 * The behaviour behind a cancellation page, with no markup.
 *
 * Reading is a GET and cancelling is a POST, deliberately. Mail clients and link scanners
 * open links to check them, so a cancellation that happened on GET would cancel
 * appointments nobody clicked.
 *
 * `state` is the only thing a page needs to branch on, and it is always one of five
 * values, including for links that are unusable. There is no error state to design
 * around: an unrecognised link is just another thing to render.
 */
export const useCancelFlow = (args: { apiUrl?: string; token: string }): CancelFlow => {
  const { apiUrl = '/api/booking', token } = args

  const [lookup, setLookup] = useState<CancelLookup | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [errorCode, setErrorCode] = useState<CancelErrorCode | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)

    try {
      const response = await fetch(
        `${apiUrl}/appointment-by-token?token=${encodeURIComponent(token)}`,
        { headers: { Accept: 'application/json' } },
      )

      setLookup((await response.json()) as CancelLookup)
    } catch {
      setLookup({ bookUrl: '', phone: '', state: 'invalid' })
      setErrorCode('network')
    } finally {
      setLoading(false)
    }
  }, [apiUrl, token])

  useEffect(() => {
    void reload()
  }, [reload])

  const confirm = useCallback(async (): Promise<void> => {
    setConfirming(true)
    setErrorCode(null)

    try {
      const response = await fetch(`${apiUrl}/cancel-by-token`, {
        body: JSON.stringify({ token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json()) as { error?: CancelErrorCode }

      if (response.ok) {
        setLookup((previous) => (previous ? { ...previous, state: 'cancelled' } : previous))

        return
      }

      // A refusal is usually not an error to apologise for, it is a different state to
      // render: the link expired, or the appointment has already started.
      const nextState: Partial<Record<CancelErrorCode, CancelState>> = {
        token_expired: 'expired',
        token_invalid: 'invalid',
        too_late: 'past',
      }
      const mapped = body.error ? nextState[body.error] : undefined

      if (mapped) {
        setLookup((previous) => (previous ? { ...previous, state: mapped } : previous))

        return
      }

      setErrorCode(body.error ?? 'unknown')
    } catch {
      setErrorCode('network')
    } finally {
      setConfirming(false)
    }
  }, [apiUrl, token])

  return {
    appointment: lookup?.appointment,
    bookUrl: lookup?.bookUrl ?? '',
    confirm,
    confirming,
    errorCode,
    loading,
    phone: lookup?.phone ?? '',
    reload,
    state: lookup?.state ?? null,
  }
}
