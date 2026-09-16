import type { PayloadHandler } from 'payload'

import type { ResolvedServerOptions } from '../options.js'

import { formTokenExpiresAt, issueFormToken } from '../../core/token.js'
import { computeAvailability, readSettings } from '../availability.js'
import { buildSiteUrl, errorResponse, jsonResponse } from '../options.js'
import { listActiveResources, resolveResource } from '../resource.js'

/**
 * The day and slot list a visitor picks from.
 *
 * Everything is computed here: the labels are rendered in the business timezone, and the
 * browser only ever echoes back the opaque `start` strings.
 */
export const createAvailabilityHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) => {
    const { payload } = req
    const requested = typeof req.query?.resource === 'string' ? req.query.resource : null
    const resolution = await resolveResource({ payload, resource: requested, server })

    if (resolution.state === 'required') {
      return errorResponse('resource_required', 400)
    }

    if (resolution.state === 'not_found') {
      return errorResponse('resource_not_found', 404)
    }

    const settings = await readSettings({ payload, server })

    // No active location is a configuration state, not an error: the form shows its empty
    // message with the phone number rather than a failure the visitor cannot act on.
    if (resolution.state === 'none_active') {
      return jsonResponse({
        days: [],
        meta: {
          labels: server.labels,
          phone: settings.phone ?? '',
          timezone: settings.timezone ?? 'UTC',
        },
      })
    }

    const { days } = await computeAvailability({
      payload,
      resource: resolution.resource,
      server,
      settings,
    })

    return jsonResponse({
      days,
      meta: {
        labels: server.labels,
        phone: settings.phone ?? '',
        resource: { id: resolution.resource.id, slug: resolution.resource.slug },
        timezone: settings.timezone ?? 'UTC',
      },
    })
  }

/** Just enough for a chooser: the collection itself stays owner-only. */
export const createResourcesHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  async (req) =>
    jsonResponse({ resources: await listActiveResources({ payload: req.payload, server }) })

/**
 * A fresh time-trap token per page load.
 *
 * Minting it during the page render would bake one token into a statically rendered page:
 * every visitor would share it, and it would expire six hours after the deploy.
 */
export const createFormTokenHandler =
  (server: ResolvedServerOptions): PayloadHandler =>
  () => {
    const formToken = issueFormToken(server.options.tokenSecret)

    return jsonResponse({ expiresAt: formTokenExpiresAt(formToken), formToken })
  }

export const buildBookUrl = (args: {
  payload: Parameters<typeof buildSiteUrl>[0]['payload']
  server: ResolvedServerOptions
}): string =>
  buildSiteUrl({
    options: args.server.options,
    path: args.server.options.routes.bookPath,
    payload: args.payload,
  }) ?? ''
