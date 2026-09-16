import { toUtcIso } from './time.js'

export type IcsMethod = 'CANCEL' | 'REQUEST'

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newlines are escaped in TEXT values. */
export const escapeIcsText = (value: string): string =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')

/** RFC 5545 §3.1: content lines are folded at 75 octets, continuations start with a space. */
export const foldIcsLine = (line: string): string => {
  const bytes = Buffer.from(line, 'utf8')

  if (bytes.length <= 75) {
    return line
  }

  const parts: string[] = []
  let offset = 0
  let limit = 75

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length)

    // Never split a multi-byte character across a fold.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1
    }

    parts.push(bytes.subarray(offset, end).toString('utf8'))
    offset = end
    limit = 74
  }

  return parts.join('\r\n ')
}

/** UTC basic form, e.g. 20260918T150000Z. */
export const toIcsStamp = (instant: Date | number | string): string =>
  toUtcIso(instant).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

export type IcsEventInput = {
  attendeeEmail?: string
  description?: string
  end: Date | number | string
  location?: string
  method: IcsMethod
  /** Wall-clock moment the file was produced. Injected so output is testable. */
  now: Date
  organizerEmail?: string
  sequence: number
  start: Date | number | string
  summary: string
  /** Stable across the confirmation and its cancellation: the appointment id. */
  uid: string
}

/**
 * Build an iTIP calendar file.
 *
 * REQUEST with an organizer, an attendee and a sequence number makes the confirmation a
 * real invitation, so a later CANCEL with the same UID removes the event from the
 * customer's calendar. A bare event file cannot be cancelled afterwards, and the format
 * could not be changed later without breaking everyone already booked (D12).
 */
export const buildIcs = (input: IcsEventInput): string => {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ogutdgn//payload-booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${toIcsStamp(input.now)}`,
    `DTSTART:${toIcsStamp(input.start)}`,
    `DTEND:${toIcsStamp(input.end)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ]

  if (input.location) {
    lines.push(`LOCATION:${escapeIcsText(input.location)}`)
  }

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`)
  }

  if (input.organizerEmail) {
    lines.push(`ORGANIZER:mailto:${input.organizerEmail}`)
  }

  if (input.attendeeEmail) {
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${input.attendeeEmail}`,
    )
  }

  lines.push(input.method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED')
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

/** The MIME type an iTIP attachment must carry; the parameter has to match the METHOD. */
export const icsContentType = (method: IcsMethod): string =>
  `text/calendar; charset=utf-8; method=${method}`

export const icsFilename = (method: IcsMethod): string =>
  method === 'CANCEL' ? 'cancellation.ics' : 'appointment.ics'

/**
 * "Add to Google Calendar" link, built server-side so the browser never does date maths.
 */
export const googleCalendarUrl = (input: {
  details?: string
  end: Date | number | string
  location?: string
  start: Date | number | string
  summary: string
}): string => {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${toIcsStamp(input.start)}/${toIcsStamp(input.end)}`,
    text: input.summary,
  })

  if (input.location) {
    params.set('location', input.location)
  }

  if (input.details) {
    params.set('details', input.details)
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
