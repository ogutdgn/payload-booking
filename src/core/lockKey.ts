import { randomUUID } from 'node:crypto'

import { SLOT_HOLDING_STATUSES } from '../types.js'
import { toUtcIso } from './time.js'

/**
 * A relationship value is an id at depth 0, but a populated object when a host calls the
 * Local API with `depth > 0`. Both have to produce the same key.
 */
export const resourceId = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'object' && 'id' in value) {
    const { id } = value as { id: unknown }

    return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
  }

  // Anything else is not an identifier. Returning '' rather than '[object Object]' keeps a
  // malformed value from silently producing a lock key that collides with other malformed
  // values, which would look like a spurious double booking.
  return ''
}

/** The key that a slot-holding appointment occupies. Unique at the database level. */
export const slotLockKey = (args: {
  resource: unknown
  seat: number
  slotStart: Date | number | string
}): string => `${resourceId(args.resource)}#${toUtcIso(args.slotStart)}#${args.seat}`

/**
 * The value written when an appointment stops holding its slot.
 *
 * Not `null`: MongoDB's sparse indexes still index a field that exists with an explicit
 * null, and Payload's Mongo adapter always writes one, so the second cancellation in the
 * whole system would collide with the first. A per-document tombstone is unique on both
 * adapters (spec §8, F01).
 */
export const releasedLockKey = (documentId?: null | number | string): string =>
  `released#${documentId === null || documentId === undefined || documentId === '' ? randomUUID() : documentId}`

/** True when this status occupies its slot. Only `cancelled` releases one. */
export const holdsSlot = (status: unknown): boolean =>
  typeof status === 'string' && (SLOT_HOLDING_STATUSES as readonly string[]).includes(status)

export type LockKeyInput = {
  documentId?: null | number | string
  resource?: unknown
  seat?: null | number
  slotStart?: Date | null | number | string
  status?: unknown
}

/**
 * Derive the lock key from the merged document.
 *
 * Callers must merge `originalDoc` under `data` before calling: a partial update such as
 * `{ status: 'cancelled' }` otherwise carries no `slotStart`, and the key would be
 * rebuilt from nothing.
 */
export const deriveLockKey = (merged: LockKeyInput): string => {
  const seat = merged.seat ?? 0

  if (!holdsSlot(merged.status) || !merged.slotStart) {
    return releasedLockKey(merged.documentId)
  }

  return slotLockKey({ resource: merged.resource, seat, slotStart: merged.slotStart })
}

/** True when a key is a tombstone rather than a real slot. */
export const isReleasedLockKey = (key: unknown): boolean =>
  typeof key === 'string' && key.startsWith('released#')
