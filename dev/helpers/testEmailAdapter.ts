import type { EmailAdapter, SendEmailOptions } from 'payload'

type CapturedEmail = {
  attachments?: { contentType?: string; filename?: string }[]
  html?: string
  subject?: string
  text?: string
  to?: string
}

const store = (): CapturedEmail[] => {
  const globalStore = globalThis as { __bookingEmails__?: CapturedEmail[] }

  globalStore.__bookingEmails__ = globalStore.__bookingEmails__ ?? []

  return globalStore.__bookingEmails__
}

const toAddress = (message: SendEmailOptions): string => {
  if (typeof message.to === 'string') {
    return message.to
  }

  if (Array.isArray(message.to)) {
    return message.to
      .map((entry: { address?: string } | string) =>
        typeof entry === 'string' ? entry : (entry?.address ?? ''),
      )
      .join(', ')
  }

  return message.to?.address ?? ''
}

/**
 * Captures every email instead of sending it, and logs a one-line summary.
 *
 * Named something other than 'console' on purpose: the plugin treats Payload's built-in
 * console adapter as "no adapter configured" and skips sending entirely, which would make
 * every email assertion in the test suite vacuous.
 */
export const testEmailAdapter: EmailAdapter<{ messageId: string }> = ({ payload }) => ({
  name: 'booking-test-capture',
  defaultFromAddress: 'dev@payloadcms.com',
  defaultFromName: 'Payload Booking Dev',
  sendEmail: (message) => {
    const to = toAddress(message)

    store().push({
      attachments: (message.attachments ?? []).map((attachment: Record<string, unknown>) => ({
        contentType:
          typeof attachment.contentType === 'string' ? attachment.contentType : undefined,
        filename: typeof attachment.filename === 'string' ? attachment.filename : undefined,
      })),
      html: typeof message.html === 'string' ? message.html : undefined,
      subject: message.subject,
      text: typeof message.text === 'string' ? message.text : undefined,
      to,
    })

    payload.logger.info(`[email] to ${to}: ${message.subject ?? '(no subject)'}`)

    return Promise.resolve({ messageId: `test-${store().length}` })
  },
})
