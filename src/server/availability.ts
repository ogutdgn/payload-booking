import type { Payload, PayloadRequest } from 'payload'

import type { Day, GenerateSlotsInput } from '../core/slots.js'
import type { BookingWindow, WeeklySchedule } from '../types.js'
import type { ResolvedServerOptions } from './options.js'

import { resolveSchedule } from '../core/schedule.js'
import { generateSlots, windowBounds } from '../core/slots.js'
import { toUtcIso } from '../core/time.js'
import { collectionSlug, globalSlug } from '../payload/slugs.js'
import { SLOT_HOLDING_STATUSES } from '../types.js'

export type BookingSettings = {
  bookingWindow?: BookingWindow
  cancellationCutoffMinutes?: number
  capacityPerSlot?: number
  confirmationNote?: string
  location?: string
  minNoticeMinutes?: number
  notificationEmails?: { email: string }[]
  phone?: string
  slotDurationMinutes?: number
  timezone?: string
  weeklySchedule?: WeeklySchedule
}

export type BookingResource = {
  active?: boolean
  capacityPerSlot?: null | number
  id: number | string
  name?: string
  scheduleOverride?: null | WeeklySchedule
  slug?: string
  useScheduleOverride?: boolean
}

export const readSettings = async (args: {
  payload: Payload
  req?: PayloadRequest
  server: ResolvedServerOptions
}): Promise<BookingSettings> =>
  (await args.payload.findGlobal({
    slug: globalSlug(args.server.slugs.settings),
    depth: 0,
    req: args.req,
  })) as BookingSettings

const DEFAULT_WINDOW: BookingWindow = { mode: 'rolling-days', rollingDays: 14 }

/** Settings plus the location's own overrides, resolved once so nothing re-derives them. */
export const resolveSlotConfig = (args: {
  resource?: BookingResource | null
  settings: BookingSettings
}): {
  capacityPerSlot: number
  minNoticeMinutes: number
  schedule: WeeklySchedule
  slotDurationMinutes: number
  timezone: string
  window: BookingWindow
} => {
  const { resource, settings } = args

  return {
    capacityPerSlot: resource?.capacityPerSlot ?? settings.capacityPerSlot ?? 1,
    minNoticeMinutes: settings.minNoticeMinutes ?? 0,
    schedule: resolveSchedule({
      globalSchedule: settings.weeklySchedule ?? ({} as WeeklySchedule),
      resource,
    }),
    // Duration is global-only in v1. A future appointment-types collection would sit in
    // front of this lookup, which is why every consumer goes through here.
    slotDurationMinutes: settings.slotDurationMinutes ?? 60,
    timezone: settings.timezone ?? 'UTC',
    window: settings.bookingWindow ?? DEFAULT_WINDOW,
  }
}

/**
 * Gather what the pure slot generator needs, then call it.
 *
 * Three database reads, each bounded: the settings global, the closed dates overlapping
 * the window, and the slot-holding appointments inside it. All three use the Local API, so
 * none of them depends on public read access.
 */
export const computeAvailability = async (args: {
  now?: Date
  payload: Payload
  req?: PayloadRequest
  resource: BookingResource
  server: ResolvedServerOptions
  settings?: BookingSettings
}): Promise<{
  days: Day[]
  input: GenerateSlotsInput
  settings: BookingSettings
}> => {
  const { payload, req, resource, server } = args
  const now = args.now ?? new Date()
  const settings = args.settings ?? (await readSettings({ payload, req, server }))
  const config = resolveSlotConfig({ resource, settings })
  const { firstDay, fromInstant, lastDay, toInstantExclusive } = windowBounds({
    now,
    timezone: config.timezone,
    window: config.window,
  })

  const { docs: blackoutDocs } = await payload.find({
    collection: collectionSlug(server.slugs.blackoutDates),
    depth: 0,
    // Without this, Payload's default limit of ten silently truncates the closed dates and
    // a blacked-out day would be offered for booking.
    pagination: false,
    req,
    select: { endDate: true, startDate: true },
    where: {
      endDate: { greater_than_equal: firstDay },
      or: [{ resource: { exists: false } }, { resource: { equals: resource.id } }],
      startDate: { less_than_equal: lastDay },
    },
  })

  const { docs: bookedDocs } = await payload.find({
    collection: collectionSlug(server.slugs.appointments),
    depth: 0,
    pagination: false,
    req,
    select: { slotStart: true },
    where: {
      resource: { equals: resource.id },
      slotStart: { greater_than_equal: fromInstant, less_than: toInstantExclusive },
      status: { in: [...SLOT_HOLDING_STATUSES] },
    },
  })

  const bookedCounts: Record<string, number> = {}

  for (const doc of bookedDocs as { slotStart?: Date | string }[]) {
    if (!doc.slotStart) {
      continue
    }

    // Both adapters hand back their own representation, so the key is normalised the same
    // way the generator builds it. A mismatch here would show taken slots as available.
    const key = toUtcIso(doc.slotStart)

    bookedCounts[key] = (bookedCounts[key] ?? 0) + 1
  }

  const input: GenerateSlotsInput = {
    blackouts: (blackoutDocs as { endDate: string; startDate: string }[]).map((row) => ({
      endDate: row.endDate,
      startDate: row.startDate,
    })),
    bookedCounts,
    capacityPerSlot: config.capacityPerSlot,
    labels: server.labels,
    minNoticeMinutes: config.minNoticeMinutes,
    now,
    schedule: config.schedule,
    slotDurationMinutes: config.slotDurationMinutes,
    timezone: config.timezone,
    window: config.window,
  }

  return { days: generateSlots(input), input, settings }
}
