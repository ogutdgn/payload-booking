import type { Config, Plugin } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from './types.js'

import { appointmentsCollection } from './payload/collections/appointments.js'
import { blackoutDatesCollection } from './payload/collections/blackoutDates.js'
import { resourcesCollection } from './payload/collections/resources.js'
import { bookingSettingsGlobal } from './payload/globals/bookingSettings.js'
import {
  applyCollectionOverride,
  applyGlobalOverride,
  protectAppointments,
} from './payload/overrides.js'
import { seedBooking } from './payload/seed.js'
import { assertTimezoneSupported, resolveTimezones } from './payload/timezones.js'
import { buildBookingEndpoints } from './server/index.js'
import { DEFAULT_API_BASE_PATH, DEFAULT_SLUGS, PACKAGE_NAME } from './types.js'

export * from './core/index.js'
export * from './payload/overrides.js'
export * from './server/index.js'
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
    // Resolving also validates: a colliding apiBasePath throws here rather than 404ing
    // silently at runtime. The endpoint builder resolves its own copy.
    const { slugs } = resolveOptions(options, config)

    assertTimezoneSupported(
      options.defaults.settings.timezone,
      resolveTimezones(options.supportedTimezones),
    )

    const appointments = appointmentsCollection({
      options,
      slugs,
      statusActionsComponent: `${PACKAGE_NAME}/client#StatusActions`,
      statusLabelComponent: `${PACKAGE_NAME}/client#StatusLabel`,
    })

    config.collections = [
      ...(config.collections ?? []),
      // Appointments is the only one with rules an override must not weaken, so its merge
      // goes through a second step that checks them and puts them back.
      protectAppointments({
        base: appointments,
        merged: applyCollectionOverride(appointments, options.overrides?.appointments),
      }),
      applyCollectionOverride(
        blackoutDatesCollection({ options, slugs }),
        options.overrides?.blackoutDates,
      ),
      applyCollectionOverride(
        resourcesCollection({
          options,
          rowLabelComponent: `${PACKAGE_NAME}/client#SessionRowLabel`,
          slugs,
        }),
        options.overrides?.resources,
      ),
    ]

    config.globals = [
      ...(config.globals ?? []),
      applyGlobalOverride(
        bookingSettingsGlobal({
          options,
          previewComponent: `${PACKAGE_NAME}/client#WeekdayPreview`,
          rowLabelComponent: `${PACKAGE_NAME}/client#SessionRowLabel`,
          slugs,
        }),
        options.overrides?.settings,
      ),
    ]

    if (!options.disabled) {
      config.endpoints = [...(config.endpoints ?? []), ...buildBookingEndpoints(options)]
    }

    // Registered in object form so the components receive the plugin's own options: a
    // string-registered component gets only Payload's props and could not know the
    // appointments slug or whether the plugin is disabled.
    config.admin = config.admin ?? {}
    config.admin.components = config.admin.components ?? {}
    config.admin.components.afterNavLinks = [
      ...(config.admin.components.afterNavLinks ?? []),
      {
        clientProps: { appointmentsSlug: slugs.appointments, disabled: Boolean(options.disabled) },
        path: `${PACKAGE_NAME}/client#NavLinks`,
      },
    ]
    config.admin.components.beforeDashboard = [
      ...(config.admin.components.beforeDashboard ?? []),
      {
        path: `${PACKAGE_NAME}/rsc#TodayWidget`,
        serverProps: {
          disabled: Boolean(options.disabled),
          labels: options.labels,
          slugs,
        },
      },
    ]

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
