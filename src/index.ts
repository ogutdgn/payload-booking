import type { Config, Plugin } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from './types.js'

import { appointmentsCollection } from './payload/collections/appointments.js'
import { blackoutDatesCollection } from './payload/collections/blackoutDates.js'
import { resourcesCollection } from './payload/collections/resources.js'
import { bookingSettingsGlobal } from './payload/globals/bookingSettings.js'
import { seedBooking } from './payload/seed.js'
import { assertTimezoneSupported, resolveTimezones } from './payload/timezones.js'
import { DEFAULT_API_BASE_PATH, DEFAULT_SLUGS, PACKAGE_NAME } from './types.js'

export * from './core/index.js'
export * from './types.js'

export type ResolvedBookingOptions = {
  apiBasePath: string
  slugs: ResolvedSlugs
}

/** Resolve slugs and the API base path, and refuse a base path Payload would route elsewhere. */
export const resolveOptions = (
  options: BookingPluginOptions,
  config: Config,
): ResolvedBookingOptions => {
  const slugs: ResolvedSlugs = { ...DEFAULT_SLUGS, ...options.slugs }
  const apiBasePath = options.apiBasePath ?? DEFAULT_API_BASE_PATH

  const firstSegment = apiBasePath.replace(/^\/+/, '').split('/')[0]
  const takenSlugs = new Set([
    ...(config.collections ?? []).map((collection) => collection.slug),
    ...Object.values(slugs),
  ])

  if (takenSlugs.has(firstSegment)) {
    throw new Error(
      `[payload-booking] apiBasePath "${apiBasePath}" starts with "${firstSegment}", which is a registered collection or global slug. ` +
        `Payload routes those requests to that collection instead of the plugin, so every plugin endpoint would 404. Choose another apiBasePath.`,
    )
  }

  return { apiBasePath, slugs }
}

/**
 * Appointment booking for Payload CMS 3.x.
 *
 * Collections, globals and admin components are registered even when `disabled`, so the
 * host's database schema and generated import map are identical in every environment.
 * Only behaviour is switched off: endpoints, hook side effects, emails and seeding.
 */
export const bookingPlugin =
  (options: BookingPluginOptions): Plugin =>
  (config: Config): Config => {
    const { apiBasePath, slugs } = resolveOptions(options, config)

    assertTimezoneSupported(
      options.defaults.settings.timezone,
      resolveTimezones(options.supportedTimezones),
    )

    config.collections = [
      ...(config.collections ?? []),
      appointmentsCollection({
        options,
        slugs,
        statusActionsComponent: `${PACKAGE_NAME}/client#StatusActions`,
        statusLabelComponent: `${PACKAGE_NAME}/client#StatusLabel`,
      }),
      blackoutDatesCollection({ options, slugs }),
      resourcesCollection({ options, slugs }),
    ]

    config.globals = [
      ...(config.globals ?? []),
      bookingSettingsGlobal({
        options,
        previewComponent: `${PACKAGE_NAME}/client#WeekdayPreview`,
        slugs,
      }),
    ]

    // TODO(ring 3): push endpoints under `apiBasePath`.
    void apiBasePath

    // TODO(ring 4): push NavLinks and TodayWidget into admin.components.

    const incomingOnInit = config.onInit

    config.onInit = async (payload) => {
      if (incomingOnInit) {
        await incomingOnInit(payload)
      }

      if (options.disabled) {
        return
      }

      await seedBooking({ options, payload, slugs })
    }

    return config
  }

export default bookingPlugin
