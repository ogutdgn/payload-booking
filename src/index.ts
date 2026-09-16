import type { Config, Plugin } from 'payload'

import type { BookingPluginOptions, ResolvedSlugs } from './types.js'

import { DEFAULT_API_BASE_PATH, DEFAULT_SLUGS } from './types.js'

export * from './types.js'

/** Resolve slugs and the API base path, and refuse a base path that Payload would route elsewhere. */
export const resolveOptions = (options: BookingPluginOptions, config: Config) => {
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
        `Payload would route those requests to that collection instead of the plugin. Choose another apiBasePath.`,
    )
  }

  return { apiBasePath, slugs }
}

/**
 * Appointment booking for Payload CMS 3.x.
 *
 * Build order (spec §4.2): collections and globals, then endpoints, then admin
 * components, then the exported booking UI. This entry only wires them together.
 */
export const bookingPlugin =
  (options: BookingPluginOptions): Plugin =>
  (config: Config): Config => {
    const { apiBasePath, slugs } = resolveOptions(options, config)

    // Collections and globals are registered even when `disabled`, so the host's
    // database schema and import map stay identical in every environment (spec §5).
    config.collections = config.collections ?? []
    config.globals = config.globals ?? []

    // TODO(ring 2): push appointments, booking-resources, booking-blackout-dates, booking-settings.
    // TODO(ring 3): push endpoints under `apiBasePath` and wire onInit seeding.
    // TODO(ring 4): push admin components in object form with clientProps/serverProps.
    void apiBasePath
    void slugs

    return config
  }

export default bookingPlugin
