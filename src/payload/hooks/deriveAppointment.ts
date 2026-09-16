import type { CollectionBeforeChangeHook } from 'payload'

import type { BookingPluginOptions } from '../../types.js'

import { createFormatter } from '../../core/format.js'
import { deriveLockKey } from '../../core/lockKey.js'
import { generateReference } from '../../core/reference.js'

/**
 * Everything an appointment derives from its own data, in one hook.
 *
 * Two rules it must not break:
 *
 * 1. `originalDoc` is merged *under* `data`. A partial update such as
 *    `{ status: 'cancelled' }` carries no `slotStart`, and without the merge the lock key
 *    would be rebuilt from nothing and silently free a slot that is still booked.
 *
 * 2. The business timezone comes from the row's own stored companion field, never from the
 *    live settings global. Reading the global would re-derive the stored local date and
 *    time on the next unrelated update after a timezone change, quietly rewriting history
 *    for appointments that were booked under the old zone.
 */
export const deriveAppointmentFields = (args: {
  options: BookingPluginOptions
}): CollectionBeforeChangeHook => {
  const { options } = args

  return ({ data, operation, originalDoc }) => {
    const merged = { ...(originalDoc as Record<string, unknown>), ...data }

    data.seat = typeof merged.seat === 'number' ? merged.seat : 0

    if (operation === 'create' && !merged.reference) {
      data.reference = generateReference()
    }

    const slotStart = merged.slotStart as Date | number | string | undefined
    const timezone = merged.slotStart_tz as string | undefined

    if (slotStart && timezone) {
      const formatter = createFormatter(timezone, options.labels)
      const customer = merged.customer as { name?: string } | undefined

      data.slotLocalDate = formatter.localDate(slotStart)
      data.slotLocalTime = formatter.localTime(slotStart)
      data.title = formatter.title(customer?.name ?? 'Appointment', slotStart)
    }

    data.slotLockKey = deriveLockKey({
      documentId: (originalDoc as { id?: number | string })?.id,
      resource: merged.resource,
      seat: data.seat as number,
      slotStart,
      status: merged.status,
    })

    return data
  }
}
