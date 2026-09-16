'use client'

import { useField } from '@payloadcms/ui'
import React from 'react'

const TONE: Record<string, { background: string; color: string; label: string }> = {
  cancelled: { background: '#fdecea', color: '#8a1c11', label: 'Cancelled' },
  completed: { background: '#e8f4ec', color: '#1d5c33', label: 'Completed' },
  confirmed: { background: '#e8f0fb', color: '#17417e', label: 'Confirmed' },
  'no-show': { background: '#fdf3e2', color: '#8a5a06', label: 'No-show' },
}

/**
 * Status shown as a label, not a dropdown.
 *
 * Changing it by hand would free the slot while skipping the emails and the audit trail,
 * so the buttons below are the only way to change it. The server refuses a hand-made
 * change regardless; this is what stops the owner trying.
 */
export const StatusLabel: React.FC<{ path?: string }> = ({ path }) => {
  const { value } = useField<string>({ path: path ?? 'status' })
  const tone = TONE[value ?? 'confirmed'] ?? {
    background: '#eee',
    color: '#333',
    label: value ?? '',
  }

  return (
    <div className="field-type">
      <div className="field-label">Status</div>
      <div
        style={{
          background: tone.background,
          borderRadius: '4px',
          color: tone.color,
          display: 'inline-block',
          fontSize: '0.8rem',
          fontWeight: 600,
          letterSpacing: '0.02em',
          padding: '4px 10px',
        }}
      >
        {tone.label}
      </div>
    </div>
  )
}

export default StatusLabel
