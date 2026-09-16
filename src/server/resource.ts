import type { Payload, PayloadRequest } from 'payload'

import type { BookingResource } from './availability.js'
import type { ResolvedServerOptions } from './options.js'

import { collectionSlug } from '../payload/slugs.js'

export type ResourceResolution =
  | { resource: BookingResource; state: 'ok' }
  | { state: 'none_active' }
  | { state: 'not_found' }
  | { state: 'required' }

/**
 * Turn an optional `resource` parameter into a location.
 *
 * Accepts an id or a slug, because database ids are not portable between environments and
 * a host that wants to name a location in a link needs something stable.
 *
 * With one active location the parameter is unnecessary and omitting it resolves to that
 * one. With several, omitting it is ambiguous and refused rather than guessed.
 */
export const resolveResource = async (args: {
  payload: Payload
  req?: PayloadRequest
  resource?: null | string
  server: ResolvedServerOptions
}): Promise<ResourceResolution> => {
  const { payload, req, resource, server } = args
  const collection = collectionSlug(server.slugs.resources)

  if (resource) {
    const { docs } = await payload.find({
      collection,
      depth: 0,
      limit: 1,
      req,
      where: {
        active: { equals: true },
        or: [{ id: { equals: resource } }, { slug: { equals: resource } }],
      },
    })

    return docs[0]
      ? { resource: docs[0] as unknown as BookingResource, state: 'ok' }
      : { state: 'not_found' }
  }

  const { docs } = await payload.find({
    collection,
    depth: 0,
    limit: 2,
    req,
    sort: 'createdAt',
    where: { active: { equals: true } },
  })

  if (docs.length === 0) {
    return { state: 'none_active' }
  }

  if (docs.length > 1) {
    return { state: 'required' }
  }

  return { resource: docs[0] as unknown as BookingResource, state: 'ok' }
}

export const listActiveResources = async (args: {
  payload: Payload
  req?: PayloadRequest
  server: ResolvedServerOptions
}): Promise<{ id: number | string; name: string; slug: string }[]> => {
  const { docs } = await args.payload.find({
    collection: collectionSlug(args.server.slugs.resources),
    depth: 0,
    pagination: false,
    req: args.req,
    // Only what a chooser needs. The collection itself is owner-only, so the override
    // schedule and the capacity never reach the public.
    select: { name: true, slug: true },
    sort: 'name',
    where: { active: { equals: true } },
  })

  return (docs as { id: number | string; name?: string; slug?: string }[]).map((doc) => ({
    id: doc.id,
    name: doc.name ?? '',
    slug: doc.slug ?? '',
  }))
}
