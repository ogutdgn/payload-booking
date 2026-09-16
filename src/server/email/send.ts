import type { Payload, PayloadRequest } from 'payload'

import type { IcsMethod } from '../../core/ics.js'
import type { EmailEvent, EmailRendered, EmailViewModelFor } from '../../types.js'
import type { ResolvedServerOptions } from '../options.js'

import { icsContentType, icsFilename } from '../../core/ics.js'
import { CONTEXT_EMAIL_LOG } from '../../payload/access.js'
import { collectionSlug } from '../../payload/slugs.js'
import { defaultTemplates } from './templates.js'

export type EmailLogEntry = {
  error?: string
  event: string
  providerId?: string
  sentAt: string
  to: string
}

export type SendRequest<E extends EmailEvent = EmailEvent> = {
  attachment?: { content: string; method: IcsMethod }
  event: E
  to: string[]
  viewModel: EmailViewModelFor<E>
}

const render = async <E extends EmailEvent>(
  server: ResolvedServerOptions,
  request: SendRequest<E>,
): Promise<EmailRendered> => {
  const override = server.options.email.templates?.[request.event] as
    | ((vm: EmailViewModelFor<E>) => EmailRendered | Promise<EmailRendered>)
    | undefined

  if (override) {
    return await override(request.viewModel)
  }

  const fallback = defaultTemplates[request.event] as (vm: EmailViewModelFor<E>) => EmailRendered

  return fallback(request.viewModel)
}

/**
 * Payload never leaves `sendEmail` undefined: with no adapter configured it installs a
 * console one that only logs. Recording that as a success would tell the owner an email
 * went out when it never left the machine.
 */
const hasRealAdapter = (payload: Payload): boolean => payload.email?.name !== 'console'

/**
 * Send a batch of emails and return what happened.
 *
 * Sequential on purpose. A failure never propagates: a provider outage must not undo a
 * booking that is already committed, so every outcome becomes a log entry instead.
 */
export const sendEmails = async (args: {
  payload: Payload
  requests: SendRequest[]
  server: ResolvedServerOptions
}): Promise<EmailLogEntry[]> => {
  const { payload, requests, server } = args
  const entries: EmailLogEntry[] = []

  if (!hasRealAdapter(payload)) {
    payload.logger.warn(
      '[payload-booking] No email adapter is configured, so booking emails are not being sent. ' +
        'Add one to your Payload config (for example @payloadcms/email-nodemailer or @payloadcms/email-resend).',
    )

    for (const request of requests) {
      for (const to of request.to) {
        entries.push({
          error: 'no_email_adapter',
          event: request.event,
          sentAt: new Date().toISOString(),
          to,
        })
      }
    }

    return entries
  }

  for (const request of requests) {
    let rendered: EmailRendered

    try {
      rendered = await render(server, request)
    } catch (error) {
      for (const to of request.to) {
        entries.push({
          error: `template_failed: ${String(error)}`,
          event: request.event,
          sentAt: new Date().toISOString(),
          to,
        })
      }

      continue
    }

    for (const to of request.to) {
      try {
        const result = await payload.sendEmail({
          attachments: request.attachment
            ? [
                {
                  content: request.attachment.content,
                  contentType: icsContentType(request.attachment.method),
                  filename: icsFilename(request.attachment.method),
                },
              ]
            : undefined,
          from: server.options.email.from,
          html: rendered.html,
          replyTo: server.options.email.replyTo,
          subject: rendered.subject,
          text: rendered.text,
          to,
        })

        const providerId =
          result && typeof result === 'object' && 'messageId' in result
            ? String((result as { messageId: unknown }).messageId)
            : undefined

        entries.push({
          event: request.event,
          providerId,
          sentAt: new Date().toISOString(),
          to,
        })
      } catch (error) {
        payload.logger.error(
          `[payload-booking] Failed to send ${request.event} to ${to}: ${String(error)}`,
        )

        entries.push({
          error: String(error),
          event: request.event,
          sentAt: new Date().toISOString(),
          to,
        })
      }
    }
  }

  return entries
}

/**
 * Append the log in a single write.
 *
 * Arrays are replaced wholesale on both adapters, so two writes built from the same
 * starting value would lose one entry, and every write costs a version on a versioned
 * collection.
 */
export const appendEmailLog = async (args: {
  appointmentId: number | string
  entries: EmailLogEntry[]
  existing?: EmailLogEntry[]
  payload: Payload
  req?: PayloadRequest
  server: ResolvedServerOptions
}): Promise<void> => {
  const { appointmentId, entries, existing, payload, req, server } = args

  if (entries.length === 0) {
    return
  }

  try {
    await payload.update({
      id: appointmentId,
      collection: collectionSlug(server.slugs.appointments),
      context: { [CONTEXT_EMAIL_LOG]: true },
      data: { emailLog: [...(existing ?? []), ...entries] } as never,
      req,
    })
  } catch (error) {
    payload.logger.error(`[payload-booking] Could not record the email log: ${String(error)}`)
  }
}
