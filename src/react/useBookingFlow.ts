'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AvailabilityResponse,
  BookingSuccess,
  CustomerFieldDescriptor,
  Day,
  Slot,
} from './types.js'

/**
 * The behaviour behind a booking page, with no markup and no opinions about what to show.
 *
 * Three layers, so you are never stuck:
 *
 *   1. the endpoints, which constrain nothing;
 *   2. `useAvailability`, `useFormToken` and `useBooking`, each doing one thing;
 *   3. `useBookingFlow`, which composes them for the common case.
 *
 * If this hook does not suit your page, use the three below it. If those do not suit it,
 * call the endpoints yourself. Nothing here needs to be forked.
 *
 * Everything returned is a fact or an action, never a decision. The hook reports that a
 * slot is unavailable and that the last attempt failed with `slot_taken`; whether that
 * becomes a greyed-out button and a red sentence is yours.
 */

export type BookingErrorCode =
  | 'already_booked'
  | 'challenge_failed'
  | 'network'
  | 'resource_not_found'
  | 'resource_required'
  | 'slot_taken'
  | 'slot_unavailable'
  | 'token_expired'
  | 'token_invalid'
  | 'token_too_fast'
  | 'too_many'
  | 'unknown'
  | 'validation'

/** Client-side codes, alongside any message the server sent back verbatim. */
export const FIELD_ERROR_REQUIRED = 'required'
export const FIELD_ERROR_INVALID_EMAIL = 'invalid_email'

export type AvailabilityMeta = {
  labels: { hour12: boolean; locale: string }
  phone: string
  timezone: string
}

const EMPTY_META: AvailabilityMeta = {
  labels: { hour12: true, locale: 'en-US' },
  phone: '',
  timezone: 'UTC',
}

export type UseAvailabilityResult = {
  days: Day[]
  error: BookingErrorCode | null
  loading: boolean
  meta: AvailabilityMeta
  reload: () => Promise<void>
}

/** Days and slots, kept fresh. */
export const useAvailability = (args: {
  apiUrl: string
  resource?: string
}): UseAvailabilityResult => {
  const { apiUrl, resource } = args
  const [days, setDays] = useState<Day[]>([])
  const [meta, setMeta] = useState<AvailabilityMeta>(EMPTY_META)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BookingErrorCode | null>(null)

  // A slow first response must not overwrite a later one, or the page would show stale
  // availability as though it were current.
  const requestId = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1

    requestId.current = id
    setLoading(true)

    try {
      const query = resource ? `?resource=${encodeURIComponent(resource)}` : ''
      const response = await fetch(`${apiUrl}/availability${query}`, {
        headers: { Accept: 'application/json' },
      })
      const body = (await response.json()) as { error?: BookingErrorCode } & AvailabilityResponse

      if (requestId.current !== id) {
        return
      }

      if (!response.ok) {
        setError(body.error ?? 'unknown')
        setLoading(false)

        return
      }

      setDays(body.days)
      setMeta({
        labels: body.meta?.labels ?? EMPTY_META.labels,
        phone: body.meta?.phone ?? '',
        timezone: body.meta?.timezone ?? 'UTC',
      })
      setError(null)
      setLoading(false)
    } catch {
      if (requestId.current === id) {
        setError('network')
        setLoading(false)
      }
    }
  }, [apiUrl, resource])

  useEffect(() => {
    void reload()
  }, [reload])

  return { days, error, loading, meta, reload }
}

/** Seconds a token must age before the server accepts it, plus a little slack. */
const MIN_TOKEN_AGE_MS = 3100

const issuedAt = (token: string): number => {
  const seconds = Number(token.slice(0, token.indexOf('.')))

  return Number.isFinite(seconds) ? seconds * 1000 : 0
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export type UseFormTokenResult = {
  /** Resolves once the current token is old enough for the server to accept it. */
  ready: () => Promise<void>
  refresh: () => Promise<null | string>
  token: null | string
}

/**
 * The anti-bot token.
 *
 * Fetched when the page loads rather than rendered into it: a token minted during render
 * is baked into a statically built page, so every visitor would share one, issued at
 * deploy time and expired six hours later.
 */
export const useFormToken = (args: {
  apiUrl: string
  initial?: string
}): UseFormTokenResult => {
  const { apiUrl, initial } = args
  const token = useRef<null | string>(initial ?? null)
  const [, setVersion] = useState(0)

  const refresh = useCallback(async (): Promise<null | string> => {
    try {
      const response = await fetch(`${apiUrl}/form-token`, {
        headers: { Accept: 'application/json' },
      })
      const body = (await response.json()) as { formToken?: string }

      token.current = body.formToken ?? null
      setVersion((previous) => previous + 1)

      return token.current
    } catch {
      return null
    }
  }, [apiUrl])

  useEffect(() => {
    if (!initial) {
      void refresh()
    }
  }, [initial, refresh])

  const ready = useCallback(async (): Promise<void> => {
    if (!token.current) {
      await refresh()
    }

    const age = token.current ? Date.now() - issuedAt(token.current) : 0

    if (age < MIN_TOKEN_AGE_MS) {
      await wait(MIN_TOKEN_AGE_MS - age)
    }
  }, [refresh])

  return { ready, refresh, token: token.current }
}

export type BookingPayload = {
  challengeToken?: string
  customer: Record<string, string>
  honeypot?: string
  message?: string
  resource?: string
  source?: Record<string, string | undefined>
  start: string
}

export type BookingAttempt =
  | { booking: BookingSuccess; state: 'success' }
  | { code: BookingErrorCode; fieldErrors?: Record<string, string>; state: 'error' }

export type UseBookingResult = {
  book: (payload: BookingPayload) => Promise<BookingAttempt>
  submitting: boolean
}

/**
 * One booking attempt, including the retry an expired anti-bot token needs.
 *
 * A token that is refused as too fast is retried with the same token after waiting; one
 * that is invalid or expired is replaced and then waited out. Either way the caller's
 * state is untouched, which is what lets a page keep everything the visitor typed.
 */
export const useBooking = (args: {
  apiUrl: string
  formToken: UseFormTokenResult
  honeypotField?: string
}): UseBookingResult => {
  const { apiUrl, formToken, honeypotField = 'website' } = args
  const [submitting, setSubmitting] = useState(false)

  const post = useCallback(
    async (payload: BookingPayload): Promise<Response> =>
      await fetch(`${apiUrl}/book`, {
        body: JSON.stringify({
          challengeToken: payload.challengeToken,
          customer: payload.customer,
          formToken: formToken.token ?? '',
          [honeypotField]: payload.honeypot ?? '',
          message: payload.message,
          resource: payload.resource,
          source: payload.source,
          start: payload.start,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    [apiUrl, formToken, honeypotField],
  )

  const book = useCallback(
    async (payload: BookingPayload): Promise<BookingAttempt> => {
      setSubmitting(true)

      try {
        await formToken.ready()

        let response = await post(payload)
        let body = (await response.json()) as {
          error?: BookingErrorCode
          errors?: { message: string; path: string }[]
        } & BookingSuccess

        if (
          response.status === 400 &&
          ['token_expired', 'token_invalid', 'token_too_fast'].includes(body.error ?? '')
        ) {
          if (body.error !== 'token_too_fast') {
            await formToken.refresh()
          }

          await formToken.ready()

          response = await post(payload)
          body = (await response.json()) as typeof body
        }

        if (response.ok) {
          return { booking: body, state: 'success' }
        }

        if (response.status === 422 && Array.isArray(body.errors)) {
          const fieldErrors: Record<string, string> = {}

          for (const entry of body.errors) {
            fieldErrors[entry.path.replace(/^customer\./, '')] = entry.message
          }

          return { code: 'validation', fieldErrors, state: 'error' }
        }

        return { code: body.error ?? 'unknown', state: 'error' }
      } catch {
        return { code: 'network', state: 'error' }
      } finally {
        setSubmitting(false)
      }
    },
    [formToken, post],
  )

  return { book, submitting }
}

export type BookingFlowOptions = {
  apiUrl?: string
  challengeToken?: string
  /** Extra customer fields, so required checks and the payload cover them. */
  fields?: CustomerFieldDescriptor[]
  formToken?: string
  honeypotField?: string
  onSuccess?: (booking: BookingSuccess) => void
  resource?: string
}

export type BookingFlow = {
  availabilityError: BookingErrorCode | null
  canSubmit: boolean
  days: Day[]
  errorCode: BookingErrorCode | null
  fieldErrors: Record<string, string>
  honeypot: string
  loadingAvailability: boolean
  message: string
  meta: AvailabilityMeta
  reloadAvailability: () => Promise<void>
  reset: () => void
  select: (slot: null | Slot) => void
  selected: null | Slot
  setHoneypot: (value: string) => void
  setMessage: (value: string) => void
  setValue: (name: string, value: string) => void
  submit: () => Promise<void>
  submitting: boolean
  success: BookingSuccess | null
  /** Starts to show as gone, beyond what the last availability response said. */
  unavailableStarts: string[]
  values: Record<string, string>
}

export const CORE_CUSTOMER_FIELDS: CustomerFieldDescriptor[] = [
  { name: 'name', type: 'text', label: 'Name', required: true },
  { name: 'email', type: 'email', label: 'Email', required: true },
  { name: 'phone', type: 'text', label: 'Phone', required: true },
]

const EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

/**
 * Everything a booking page needs, composed from the three hooks above.
 *
 * Draw it however you like: a grid calendar, a wizard, one dropdown. The hook never
 * assumes there is a form element, that slots are chosen before details, or that any of
 * this happens on a single page.
 */
export const useBookingFlow = (options: BookingFlowOptions = {}): BookingFlow => {
  const {
    apiUrl = '/api/booking',
    challengeToken,
    fields = [],
    formToken: providedToken,
    honeypotField,
    onSuccess,
    resource,
  } = options

  const allFields = useMemo(() => [...CORE_CUSTOMER_FIELDS, ...fields], [fields])
  const availability = useAvailability({ apiUrl, resource })
  const formToken = useFormToken({ apiUrl, initial: providedToken })
  const { book, submitting } = useBooking({ apiUrl, formToken, honeypotField })

  const [values, setValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [selected, setSelected] = useState<null | Slot>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorCode, setErrorCode] = useState<BookingErrorCode | null>(null)
  const [success, setSuccess] = useState<BookingSuccess | null>(null)
  const [unavailableStarts, setUnavailableStarts] = useState<string[]>([])

  const setValue = useCallback((name: string, value: string): void => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setFieldErrors((previous) => {
      if (!previous[name]) {
        return previous
      }

      const next = { ...previous }

      delete next[name]

      return next
    })
  }, [])

  const select = useCallback((slot: null | Slot): void => {
    setSelected(slot)
    setErrorCode(null)
  }, [])

  const reset = useCallback((): void => {
    setValues({})
    setMessage('')
    setHoneypot('')
    setSelected(null)
    setFieldErrors({})
    setErrorCode(null)
    setSuccess(null)
    setUnavailableStarts([])
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    if (!selected || submitting) {
      return
    }

    // Client-side checks report codes, not sentences, so the page owns its wording.
    const found: Record<string, string> = {}

    for (const field of allFields) {
      const value = (values[field.name] ?? '').trim()

      if (field.required && value === '') {
        found[field.name] = FIELD_ERROR_REQUIRED
      } else if (field.type === 'email' && value !== '' && !EMAIL.test(value)) {
        found[field.name] = FIELD_ERROR_INVALID_EMAIL
      }
    }

    setFieldErrors(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setErrorCode(null)

    const attempt = await book({
      challengeToken,
      customer: Object.fromEntries(
        allFields.map((field) => [field.name, (values[field.name] ?? '').trim()]),
      ),
      honeypot,
      message: message.trim() || undefined,
      resource,
      source: {
        page: typeof window === 'undefined' ? undefined : window.location.pathname,
        referrer: typeof document === 'undefined' ? undefined : document.referrer || undefined,
      },
      start: selected.start,
    })

    if (attempt.state === 'success') {
      setSuccess(attempt.booking)
      onSuccess?.(attempt.booking)

      return
    }

    if (attempt.fieldErrors) {
      setFieldErrors(attempt.fieldErrors)
    }

    setErrorCode(attempt.code)

    // The slot went while they were typing. Mark it, refresh, and clear the selection.
    // Nothing they typed is touched, which is the whole point.
    if (attempt.code === 'slot_taken' || attempt.code === 'slot_unavailable') {
      setUnavailableStarts((previous) => [...previous, selected.start])
      setSelected(null)
      void availability.reload()
    }
  }, [
    allFields,
    availability,
    book,
    challengeToken,
    honeypot,
    message,
    onSuccess,
    resource,
    selected,
    submitting,
    values,
  ])

  return {
    availabilityError: availability.error,
    canSubmit: Boolean(selected) && !submitting && !success,
    days: availability.days,
    errorCode,
    fieldErrors,
    honeypot,
    loadingAvailability: availability.loading,
    message,
    meta: availability.meta,
    reloadAvailability: availability.reload,
    reset,
    select,
    selected,
    setHoneypot,
    setMessage,
    setValue,
    submit,
    submitting,
    success,
    unavailableStarts,
    values,
  }
}
