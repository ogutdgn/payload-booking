'use client'

import { useRowLabel } from '@payloadcms/ui'
import React from 'react'

/**
 * Shows the time on each collapsed row.
 *
 * Without it every row reads "Start time 01", so a day's schedule is unreadable until each
 * row is opened one at a time.
 */
export const SessionRowLabel: React.FC = () => {
  const { data, rowNumber } = useRowLabel<{ time?: string }>()
  const time = typeof data?.time === 'string' && data.time.length > 0 ? data.time : null

  return <span>{time ?? `Start time ${String((rowNumber ?? 0) + 1)}`}</span>
}

export default SessionRowLabel
