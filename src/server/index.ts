import type { Endpoint } from 'payload'

import type { BookingPluginOptions } from '../types.js'

import { createBookHandler } from './endpoints/book.js'
import {
  createAppointmentByTokenHandler,
  createBusinessCancelHandler,
  createCancelByTokenHandler,
  createMarkStatusHandler,
} from './endpoints/cancel.js'
import {
  createAvailabilityHandler,
  createFormTokenHandler,
  createResourcesHandler,
} from './endpoints/read.js'
import { resolveServerOptions } from './options.js'

export * from './availability.js'
export * from './endpoints/book.js'
export * from './endpoints/cancel.js'
export * from './endpoints/read.js'
export * from './guards.js'
export * from './options.js'
export * from './resource.js'

/**
 * The plugin's endpoints, mounted under Payload's API route.
 *
 * Payload populates `req.user` on these but runs no access check of its own, so each
 * handler guards itself. Path parameters arrive on `req.routeParams`.
 */
export const buildBookingEndpoints = (options: BookingPluginOptions): Endpoint[] => {
  const server = resolveServerOptions(options)
  const base = server.apiBasePath.startsWith('/')
    ? server.apiBasePath
    : `/${server.apiBasePath}`

  return [
    { handler: createAvailabilityHandler(server), method: 'get', path: `${base}/availability` },
    { handler: createResourcesHandler(server), method: 'get', path: `${base}/resources` },
    { handler: createFormTokenHandler(server), method: 'get', path: `${base}/form-token` },
    { handler: createBookHandler(server), method: 'post', path: `${base}/book` },
    {
      handler: createAppointmentByTokenHandler(server),
      method: 'get',
      path: `${base}/appointment-by-token`,
    },
    {
      handler: createCancelByTokenHandler(server),
      method: 'post',
      path: `${base}/cancel-by-token`,
    },
    {
      handler: createBusinessCancelHandler(server),
      method: 'post',
      path: `${base}/appointments/:id/cancel`,
    },
    {
      handler: createMarkStatusHandler(server),
      method: 'post',
      path: `${base}/appointments/:id/status`,
    },
  ]
}
