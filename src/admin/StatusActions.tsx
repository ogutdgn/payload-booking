'use client'

import {
  Button,
  ConfirmationModal,
  toast,
  useConfig,
  useDocumentInfo,
  useModal,
  useRouteCache,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React, { useCallback, useState } from 'react'

const MODAL_SLUG = 'booking-cancel-confirm'

type Props = {
  apiBasePath?: string
}

/**
 * The only way to change an appointment's status.
 *
 * Each button calls a plugin endpoint, which is where the emails, the audit fields and the
 * host's callback live. A status changed any other way skips all three, so the server
 * refuses it; these buttons are what stop the owner needing to try.
 */
export const StatusActions: React.FC<Props> = ({ apiBasePath = '/booking' }) => {
  const { id, savedDocumentData } = useDocumentInfo()
  const { config } = useConfig()
  const { clearRouteCache } = useRouteCache()
  const { closeModal, openModal } = useModal()

  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')

  const status = (savedDocumentData?.status as string | undefined) ?? 'confirmed'
  const slotStart = savedDocumentData?.slotStart as string | undefined
  const hasStarted = slotStart ? Date.parse(slotStart) <= Date.now() : false

  const call = useCallback(
    async (path: string, body: Record<string, unknown>, successMessage: string) => {
      setBusy(true)

      try {
        const endpoint = `${apiBasePath}${path}` as `/${string}`
        const response = await fetch(
          formatAdminURL({ apiRoute: config.routes.api, path: endpoint }),
          {
            body: JSON.stringify(body),
            // The admin session is a cookie, so it has to be sent deliberately.
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          },
        )

        const result = (await response.json()) as { error?: string }

        if (!response.ok) {
          toast.error(
            result.error === 'invalid_transition'
              ? 'That appointment is no longer confirmed, so it cannot be changed.'
              : 'That did not work. Please try again.',
          )

          return
        }

        toast.success(successMessage)
        // Payload's own edit view refreshes this way: the server view rebuilds and the
        // form replaces its state, so the label and these buttons update in place. Using
        // the wrapper rather than Next's router keeps `next/*` out of the package.
        clearRouteCache()
      } catch {
        toast.error('That did not work. Please try again.')
      } finally {
        setBusy(false)
      }
    },
    [apiBasePath, clearRouteCache, config.routes.api],
  )

  const confirmCancel = useCallback(async () => {
    closeModal(MODAL_SLUG)

    await call(
      `/appointments/${String(id)}/cancel`,
      { reason: reason.trim() || undefined },
      'Cancelled. The customer has been emailed.',
    )

    setReason('')
  }, [call, closeModal, id, reason])

  // Nothing to act on before the document exists, or once it is no longer confirmed.
  if (!id || status !== 'confirmed') {
    return null
  }

  return (
    <div className="field-type" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <Button
          buttonStyle="secondary"
          disabled={busy}
          onClick={() => {
            openModal(MODAL_SLUG)
          }}
          size="small"
        >
          Cancel appointment
        </Button>

        <Button
          buttonStyle="secondary"
          disabled={busy || !hasStarted}
          onClick={() => {
            void call(
              `/appointments/${String(id)}/status`,
              { status: 'completed' },
              'Marked as completed.',
            )
          }}
          size="small"
        >
          Mark completed
        </Button>

        <Button
          buttonStyle="secondary"
          disabled={busy || !hasStarted}
          onClick={() => {
            void call(
              `/appointments/${String(id)}/status`,
              { status: 'no-show' },
              'Marked as a no-show.',
            )
          }}
          size="small"
        >
          Mark no-show
        </Button>
      </div>

      {hasStarted ? null : (
        <p
          style={{
            color: 'var(--theme-elevation-500)',
            fontSize: '0.8rem',
            marginTop: '0.5rem',
          }}
        >
          Completed and no-show can be set once the appointment time has passed.
        </p>
      )}

      <ConfirmationModal
        body={
          <div>
            <p>
              The customer will be emailed straight away, and the time becomes bookable
              again.
            </p>
            <label
              htmlFor="booking-cancel-reason"
              style={{ display: 'block', marginTop: '0.75rem' }}
            >
              Reason (optional, included in the email)
            </label>
            <textarea
              aria-label="Reason for cancelling"
              disabled={busy}
              id="booking-cancel-reason"
              onChange={(event) => {
                setReason(event.target.value)
              }}
              rows={3}
              style={{ marginTop: '0.25rem', width: '100%' }}
              value={reason}
            />
          </div>
        }
        confirmingLabel="Cancelling"
        confirmLabel="Cancel appointment"
        heading="Cancel this appointment?"
        modalSlug={MODAL_SLUG}
        onConfirm={confirmCancel}
      />
    </div>
  )
}

export default StatusActions
