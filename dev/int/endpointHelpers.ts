import type { Payload, PayloadHandler, PayloadRequest } from 'payload'

import config from '@payload-config'
import { createPayloadRequest } from 'payload'

export const API_BASE = 'http://localhost:3000/api/booking'

/**
 * Call a handler the way Payload would.
 *
 * `createPayloadRequest` builds the request and runs the auth strategies, but it never
 * matches a path, so `:id` routes get their parameters set explicitly.
 */
export const callEndpoint = async (args: {
  handler: PayloadHandler
  headers?: Record<string, string>
  method?: string
  path: string
  routeParams?: Record<string, unknown>
  token?: string
  body?: unknown
}): Promise<{ body: Record<string, unknown>; status: number }> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...args.headers,
  }

  if (args.token) {
    headers.Authorization = `JWT ${args.token}`
  }

  const serialised = args.body === undefined ? undefined : JSON.stringify(args.body)

  if (serialised !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(serialised))
  }

  const request = new Request(`${API_BASE}${args.path}`, {
    body: serialised,
    headers,
    method: args.method ?? (args.body === undefined ? 'GET' : 'POST'),
  })

  const req = await createPayloadRequest({ config, request })

  if (args.routeParams) {
    req.routeParams = args.routeParams
  }

  const response = await args.handler(req as PayloadRequest)

  return {
    body: (await response.json()) as Record<string, unknown>,
    status: response.status,
  }
}

/** A staff session, for the endpoints that require one. */
export const loginDevUser = async (payload: Payload): Promise<string> => {
  const { token } = await payload.login({
    collection: 'users',
    data: { email: 'dev@payloadcms.com', password: 'test' },
  } as Parameters<Payload['login']>[0])

  if (!token) {
    throw new Error('Expected a token for the seeded dev user.')
  }

  return token
}

/** Emails captured by the dev adapter, so tests can assert on what was sent. */
export type CapturedEmail = {
  attachments?: { contentType?: string; filename?: string }[]
  html?: string
  subject?: string
  text?: string
  to?: string
}

export const capturedEmails = (): CapturedEmail[] => {
  const store = (globalThis as { __bookingEmails__?: CapturedEmail[] }).__bookingEmails__

  return store ?? []
}

export const clearCapturedEmails = (): void => {
  ;(globalThis as { __bookingEmails__?: CapturedEmail[] }).__bookingEmails__ = []
}
