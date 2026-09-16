import type { Payload } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from '../types.js'

import { CONTEXT_SEED } from './access.js'
import { slugify } from './collections/resources.js'
import { collectionSlug, globalSlug } from './slugs.js'

const isUniqueViolation = (error: unknown, path: string): boolean => {
  const errors = (error as { data?: { errors?: { path?: string }[] } })?.data?.errors

  return Array.isArray(errors) && errors.some((entry) => entry.path === path)
}

/**
 * Write the starting values once, so a fresh install has a working schedule instead of an
 * empty form the owner has to guess at. Never overwrites anything the owner has edited.
 *
 * The Local API's generated types narrow slugs and document shapes to the host's own
 * collections, which a plugin cannot know at build time, so the calls below cast at that
 * boundary. Everything the casts hide is validated by the collection configs at runtime.
 */
export const seedBooking = async (args: {
  options: BookingPluginOptions
  payload: Payload
  slugs: ResolvedSlugs
}): Promise<void> => {
  const { options, payload, slugs } = args
  const { resource, settings } = options.defaults
  const slug = resource.slug ?? slugify(resource.name)

  // Resource first: the settings global is useless without something to book.
  const existing = await payload.count({
    collection: collectionSlug(slugs.resources),
    where: { slug: { equals: slug } },
  })

  if (existing.totalDocs === 0) {
    try {
      await payload.create({
        collection: collectionSlug(slugs.resources),
        context: { [CONTEXT_SEED]: true },
        data: {
          name: resource.name,
          slug,
          active: true,
          useScheduleOverride: false,
        } as unknown as Record<string, unknown>,
      } as Parameters<Payload['create']>[0])
    } catch (error) {
      // Two instances booting together both see zero and both create. The unique index
      // settles it; the loser treats its own error as "already seeded".
      if (!isUniqueViolation(error, 'slug')) {
        throw error
      }
    }
  }

  // An unsaved global reads back as `{}`, not null, so emptiness is tested on a required
  // field rather than on the document itself.
  const current = (await payload.findGlobal({
    slug: globalSlug(slugs.settings),
    depth: 0,
  })) as { timezone?: string }

  if (current?.timezone) {
    return
  }

  await payload.updateGlobal({
    slug: globalSlug(slugs.settings),
    context: { [CONTEXT_SEED]: true },
    data: {
      bookingWindow: settings.bookingWindow,
      cancellationCutoffMinutes: settings.cancellationCutoffMinutes,
      capacityPerSlot: settings.capacityPerSlot,
      confirmationNote: settings.confirmationNote,
      location: settings.location,
      minNoticeMinutes: settings.minNoticeMinutes,
      // The seed takes plain strings because a config literal full of `{ time: '09:00' }`
      // rows is unreadable; the stored shape is Payload's array rows.
      notificationEmails: settings.notificationEmails.map((email) => ({ email })),
      phone: settings.phone,
      slotDurationMinutes: settings.slotDurationMinutes,
      timezone: settings.timezone,
      weeklySchedule: Object.fromEntries(
        Object.entries(settings.weeklySchedule).map(([day, entry]) => [
          day,
          { open: entry.open, sessionStarts: entry.sessionStarts.map((time) => ({ time })) },
        ]),
      ),
    } as unknown as Record<string, unknown>,
  } as Parameters<Payload['updateGlobal']>[0])
}
